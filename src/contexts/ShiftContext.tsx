import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { ShiftReading } from '../types';
import pmsAuthDb from '../lib/pmsAuthDb';
import { useAuth } from '@/context/AuthContext';

export type PaymentMethod = 'cash' | 'ecocash' | 'swipe' | 'room-charge';

export interface ShiftTransaction {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference?: string; // e.g., BILL id
  createdAt: string; // ISO
  userId?: string;
  userName?: string;
  voided?: boolean;
  voidedAt?: string;
  voidReason?: string;
  outlet?: 'bar' | 'restaurant';
}

export interface Shift {
  id: string;
  startedAt: string;
  endedAt?: string;
  openedBy?: string; // userId
  userName?: string;
  stationId?: string;
  openingCash: number;
  closingCash?: number;
  status: 'open' | 'closed';
  transactions: ShiftTransaction[];
  voidedTransactions: ShiftTransaction[];
  zReadingId?: string;
}

interface ShiftContextType {
  activeShift: Shift | null;
  startShift: (openingCash: number, notes?: string, userId?: string, stationId?: string) => Promise<void>;
  endShift: (closingCash?: number) => Promise<{ success: boolean; zReading?: ShiftReading; error?: string }>;
  addTransaction: (method: PaymentMethod, amount: number, reference?: string, outlet?: 'bar' | 'restaurant') => ShiftTransaction | null;
  voidTransaction: (transactionId: string, reason: string) => boolean;
  getTotals: () => { cash: number; ecocash: number; card: number; roomCharge: number; count: number; voidedCount: number; voidedAmount: number; barSales: number; restaurantSales: number };
  /** DB-reconciled totals (per-bucket max of local + pos_orders + pos_shifts) — use for shift close so a wiped desktop can't under-report. */
  getReconciledTotals: () => Promise<{ cash: number; ecocash: number; card: number; roomCharge: number; count: number; voidedCount: number; voidedAmount: number; barSales: number; restaurantSales: number }>;
  getEndedShifts: () => Shift[];
  clearEndedShifts: () => void;
  clearActiveShift: () => void;
  generateXReading: () => ShiftReading | null;
  generateZReading: (closingCash?: number) => ShiftReading | null;
  getZReadings: () => ShiftReading[];
}

const ShiftContext = createContext<ShiftContextType | undefined>(undefined);

export const ShiftProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Capture user + active cost centre at context level — never call hooks inside functions.
  // costCentre drives the shift-restore effect: when a barman selects their station
  // (Bar/Restaurant/Conference), we rehydrate that station's open shift from the DB.
  const { user, costCentre } = useAuth();

  // Normalize a Shift object to ensure backward compatibility with older stored shapes
  const normalizeShift = (s: any): Shift => {
    const txs = Array.isArray(s?.transactions) ? s.transactions : [];
    const voided = Array.isArray(s?.voidedTransactions) ? s.voidedTransactions : [];
    return {
      id: String(s?.id || `SHIFT_${Date.now()}`),
      startedAt: String(s?.startedAt || new Date().toISOString()),
      endedAt: s?.endedAt ? String(s.endedAt) : undefined,
      openedBy: s?.openedBy ? String(s.openedBy) : undefined,
      openingCash: Number.isFinite(Number(s?.openingCash)) ? Number(s.openingCash) : 0,
      closingCash: Number.isFinite(Number(s?.closingCash)) ? Number(s.closingCash) : undefined,
      status: (s?.status === 'closed' ? 'closed' : 'open') as 'open' | 'closed',
      transactions: txs,
      voidedTransactions: voided,
      zReadingId: s?.zReadingId ? String(s.zReadingId) : undefined
    };
  };

  const [activeShift, setActiveShift] = useState<Shift | null>(() => {
    // Optionally restore from localStorage as a fast-path; the DB lookup below
    // takes over within ~1s of mount and is authoritative if a power-cut wiped
    // localStorage but the DB still has an open shift for this station.
    try {
      const raw = localStorage.getItem('corepms_activeShift');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const normalized = normalizeShift(parsed);
      localStorage.setItem('corepms_activeShift', JSON.stringify(normalized));
      return normalized;
    } catch {
      return null;
    }
  });

  // Restore open shift from DB — survives logout/login, device switches, and
  // power cuts that wipe localStorage. Critical for shared-terminal use where
  // several barmen rotate on one POS: whoever opens the Bar cost centre sees
  // the day's open shift WITH its full payment history, so they can always close.
  //
  // Re-runs whenever the selected cost centre changes (not just on mount) so a
  // mid-day station switch or a fresh login rehydrates correctly.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Prefer the live costCentre from AuthContext; fall back to localStorage keys.
        const stationId = costCentre
            || (() => {
                 try {
                   return localStorage.getItem('pms_selected_cost_centre')
                       || localStorage.getItem('corepms_active_cost_centre')
                       || '';
                 } catch { return ''; }
               })();

        if (!stationId) return; // no station selected → nothing to restore

        const dbShift = await pmsAuthDb.getActiveShift(stationId);
        if (cancelled || !dbShift) return;

        // Always rebuild transactions from pos_orders (the DB source of truth) so
        // the day's sales survive even when this browser's localStorage is empty
        // (different user, different device, or after a clear). Merge with any
        // local transactions by reference id so nothing is double-counted.
        const dbTxns = await pmsAuthDb.getShiftTransactions(dbShift.id);
        if (cancelled) return;

        const localTxns = (activeShift && activeShift.id === dbShift.id)
          ? (activeShift.transactions || [])
          : [];
        // De-dupe: prefer DB rows; add any local-only txns not present in DB.
        const seen = new Set(dbTxns.map(t => t.reference));
        const merged = [
          ...dbTxns,
          ...localTxns.filter((t: any) => !seen.has(t.reference)),
        ];

        const restored: Shift = normalizeShift({
          id: dbShift.id,
          startedAt: dbShift.opened_at,
          openedBy: dbShift.opened_by,
          openingCash: Number(dbShift.opening_cash || 0),
          status: 'open',
          transactions: merged,
          voidedTransactions: activeShift?.voidedTransactions || [],
        });
        setActiveShift(restored);
        try { localStorage.setItem('corepms_activeShift', JSON.stringify(restored)); } catch {}
        console.log(`[ShiftContext] Restored shift ${restored.id} from DB with ${merged.length} transactions (${dbTxns.length} from pos_orders).`);
      } catch (e) {
        console.warn('[ShiftContext] DB shift restore failed (non-fatal):', e);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costCentre, user?.id]);

  const [endedShifts, setEndedShifts] = useState<Shift[]>(() => {
    try {
      const raw = localStorage.getItem('corepms_endedShifts');
      if (!raw) return [];
      const arr = JSON.parse(raw);
      const normalized = Array.isArray(arr) ? arr.map(normalizeShift) : [];
      // Write back to fix legacy shapes
      localStorage.setItem('corepms_endedShifts', JSON.stringify(normalized));
      return normalized;
    } catch {
      return [];
    }
  });

  const [zReadings, setZReadings] = useState<ShiftReading[]>(() => {
    try {
      const raw = localStorage.getItem('corepms_zReadings');
      return raw ? JSON.parse(raw) as ShiftReading[] : [];
    } catch {
      return [];
    }
  });

  const persist = (shift: Shift | null) => {
    if (shift) localStorage.setItem('corepms_activeShift', JSON.stringify(shift));
    else localStorage.removeItem('corepms_activeShift');
  };

  const startShift = async (openingCash: number = 0, notes?: string, userId?: string, stationId?: string) => {
    try {
      const res = await pmsAuthDb.startShift(userId || 'unknown', stationId || 'unknown', openingCash);
      if (!res.ok) throw new Error(res.error || 'Failed to start shift in DB');

      const newShift: Shift = {
        id: res.id!,
        startedAt: new Date().toISOString(),
        openedBy: userId,
        openingCash,
        status: 'open',
        transactions: [],
        voidedTransactions: []
      };
      setActiveShift(newShift);
      persist(newShift);
    } catch (e: any) {
      console.error('Shift start error:', e);
      throw e;
    }
  };

  const endShift = async (closingCash?: number): Promise<{ success: boolean; zReading?: ShiftReading; error?: string }> => {
    if (!activeShift) {
      return { success: false, error: 'No active shift to end' };
    }

    try {
      // Sync to DB
      const dbRes = await pmsAuthDb.endShift(activeShift.id, closingCash || 0);
      if (!dbRes.ok) console.warn('Database endShift failed:', dbRes.error);

      // Import Z reading service functions
      const { generateZReading, printZReading, logZReadingAudit, storeZReading, getNextZReadingNumber } = await import('../lib/zReadingService');

      // Reconcile against the DB so a crash that wiped this desktop's local copy
      // can't make the Z-reading (and the GL posting below) under-report.
      const totals = await reconcileTotals(activeShift, getTotals());
      const ended: Shift = {
        ...activeShift,
        endedAt: new Date().toISOString(),
        closingCash,
        status: 'closed'
      };

      // IMPORTANT: Fetch the next reading number BEFORE generating the Z-reading
      // so the slip prints the correct number (not 0).
      const nextReadingNumber = await getNextZReadingNumber();

      // Generate Z reading with correct reading number
      const zReading = generateZReading(
        {
          shift: ended,
          totals,
          closingCash
        },
        nextReadingNumber
      );

      // Update shift with Z reading ID
      ended.zReadingId = zReading.id;

      // --- GL POSTING: Post daily POS revenue to General Ledger ---
      // Now posts 4 separate debit lines (Cash / EcoCash / Card / Room Charge)
      // so the chart of accounts reflects each payment method distinctly.
      // Errors are persisted to localStorage failure queue (not swallowed) so
      // a recovery run can replay them.
      try {
        const gl = await import('../lib/glAccounting');
        const businessDate = new Date().toISOString().slice(0, 10);
        const mappings = gl.getMappings();
        const totalSales = totals.cash + totals.ecocash + totals.card + totals.roomCharge;

        if (totalSales > 0 && mappings.FB_REVENUE) {
          // Read tax rate from DB first, falling back to localStorage
          let taxRate = 0;
          try {
            const resp = await fetch('/api/db/query', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sql: `SELECT value FROM system_configs WHERE key='tax_config'` }),
            });
            const data = await resp.json();
            if (data?.ok && data.rows?.length) {
              const cfg = JSON.parse(data.rows[0].value || '{}');
              taxRate = Number(cfg.pos_tax_rate || cfg.default_rate || 0);
            }
          } catch { /* fall through to localStorage */ }
          if (!taxRate) {
            try {
              const taxConfig = JSON.parse(localStorage.getItem('corepms_tax_config') || '{}');
              taxRate = Number(taxConfig.pos_tax_rate || taxConfig.default_rate || 0);
            } catch { /* use 0 */ }
          }

          const taxCollected = taxRate > 0
            ? parseFloat((totalSales * (taxRate / (100 + taxRate))).toFixed(2))
            : 0;
          const netRevenue = parseFloat((totalSales - taxCollected).toFixed(2));

          const lines: import('../lib/glAccounting').GLPostingLine[] = [];

          // Debit asset accounts — one per payment method
          if (totals.cash > 0 && mappings.CASH) {
            lines.push({ accountId: mappings.CASH, description: 'Cash POS Sales', debit: totals.cash, credit: 0 });
          }
          if (totals.ecocash > 0 && (mappings.ECOCASH || mappings.CARD)) {
            lines.push({ accountId: mappings.ECOCASH || mappings.CARD, description: 'EcoCash POS Sales', debit: totals.ecocash, credit: 0 });
          }
          if (totals.card > 0 && mappings.CARD) {
            lines.push({ accountId: mappings.CARD, description: 'Swipe / Card POS Sales', debit: totals.card, credit: 0 });
          }
          if (totals.roomCharge > 0 && mappings.ROOM_CHARGE) {
            lines.push({ accountId: mappings.ROOM_CHARGE, description: 'Room Charge POS', debit: totals.roomCharge, credit: 0 });
          }

          // Credit revenue account
          if (netRevenue > 0 && mappings.FB_REVENUE) {
            lines.push({ accountId: mappings.FB_REVENUE, description: `F&B Revenue — Shift ${ended.id}`, debit: 0, credit: netRevenue });
          }

          // Credit tax liability account
          if (taxCollected > 0 && mappings.TAX) {
            lines.push({ accountId: mappings.TAX, description: 'Tax Collected on POS', debit: 0, credit: taxCollected });
          }

          if (lines.length >= 2) {
            // postJournalEntry validates balance and throws on failure (no silent swallow)
            gl.postJournalEntry({
              id: `GLJE_POS_${ended.id}_${Date.now()}`,
              date: businessDate,
              lines,
              reference: `Shift Close — ${ended.id} — Z#${nextReadingNumber}`,
              attachments: { shiftId: ended.id, userId: ended.openedBy, userName: ended.userName }
            });
          }
        }
      } catch (glErr) {
        console.error('[ShiftContext] GL posting failed:', glErr);
        // Persist failure so a recovery process can replay it; do NOT block shift close
        try {
          const queue = JSON.parse(localStorage.getItem('corepms_gl_failures') || '[]');
          queue.unshift({
            shiftId: ended.id, error: String(glErr instanceof Error ? glErr.message : glErr),
            totals, occurredAt: new Date().toISOString(),
          });
          localStorage.setItem('corepms_gl_failures', JSON.stringify(queue.slice(0, 200)));
        } catch {}
      }

      // Attempt to print Z reading
      const printResult = await printZReading(zReading, ended);

      // Log audit trail regardless of print success
      logZReadingAudit(zReading, ended, printResult);

      // Store Z reading in DB (and localStorage fallback)
      storeZReading(zReading);
      setZReadings(prev => {
        const next = [zReading, ...prev];
        localStorage.setItem('corepms_zReadings', JSON.stringify(next));
        return next;
      });

      // Persist shift totals to localStorage for reports
      try {
        const existingTotals = JSON.parse(localStorage.getItem('corepms_shift_totals') || '{"cash":0,"card":0}');
        localStorage.setItem('corepms_shift_totals', JSON.stringify({
          cash: (existingTotals.cash || 0) + totals.cash,
          card: (existingTotals.card || 0) + totals.card
        }));
      } catch { /* non-fatal */ }

      // Store ended shift
      setEndedShifts(prev => {
        const next = [...prev, ended];
        localStorage.setItem('corepms_endedShifts', JSON.stringify(next));
        return next;
      });

      // ── Flush void log to DB for audit trail & Z-Reading stamp ──────────
      try {
        const rawVoidLog = localStorage.getItem('corepms_void_log');
        const voidEntries = rawVoidLog ? JSON.parse(rawVoidLog) : [];
        if (voidEntries.length > 0) {
          await fetch('/api/pos/voids', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries: voidEntries }),
          });
          localStorage.removeItem('corepms_void_log');
        }
      } catch { /* non-fatal — void log remains in localStorage */ }

      // ── Atomic table state cleanup on shift close ─────────────────────────
      // Three-layer wipe so no stale bill survives shift closure:
      //  1. localStorage — clear all occupied table entries
      //  2. DB pos_orders — close any orphaned open orders (shift_id=null or this shift)
      //  3. DB table_status — reset all 'open' rows to 'available'
      try {
        // Layer 1: wipe localStorage table states (all tables → available)
        localStorage.removeItem('corepms_pos_table_states');
      } catch { /* non-fatal */ }

      try {
        const { db: dbClean } = await import('../lib/db');
        // Layer 2: close all open orders regardless of shift association
        await dbClean.query(
          `UPDATE pos_orders SET status='closed' WHERE status='open'`
        );
        // Layer 3: reset table_status — orphaned 'open' rows mean no active bill
        await dbClean.query(
          `UPDATE table_status SET status='available', last_update=NOW() WHERE status='open'`
        );
      } catch (cleanErr) {
        console.warn('[ShiftContext] Table cleanup on shift end failed (non-fatal):', cleanErr);
      }

      // Clear active shift
      setActiveShift(null);
      persist(null);

      if (!printResult.success) {
        return {
          success: true,
          zReading,
          error: `Shift closed successfully but printing failed: ${printResult.error}`
        };
      }

      return { success: true, zReading };
    } catch (error) {
      console.error('Failed to end shift:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  };

   const addTransaction = (method: PaymentMethod, amount: number, reference?: string, outlet?: 'bar' | 'restaurant'): ShiftTransaction | null => {
     if (!activeShift) return null; // No shift — caller must start one first
     const tx: ShiftTransaction = {
       id: `SFTX_${Date.now()}`,
       method,
       amount: Number(amount.toFixed(2)),
       reference,
       outlet,
       createdAt: new Date().toISOString(),
       userId: user?.id,
       userName: user?.name || user?.username
     };

     setActiveShift(prev => {
       if (!prev) return null;
       const next = { ...prev, transactions: [...prev.transactions, tx] };
       persist(next);

       // Sync running totals to pos_shifts in DB (non-blocking)
       const allTx = next.transactions.filter(t => !t.voided);
       const totalSales  = allTx.reduce((s, t) => s + t.amount, 0);
       const totalCash   = allTx.filter(t => t.method === 'cash').reduce((s, t) => s + t.amount, 0);
       const totalCard   = allTx.filter(t => t.method === 'swipe').reduce((s, t) => s + t.amount, 0);
       const totalEco    = allTx.filter(t => t.method === 'ecocash').reduce((s, t) => s + t.amount, 0);
       const totalRoom   = allTx.filter(t => t.method === 'room-charge').reduce((s, t) => s + t.amount, 0);
       pmsAuthDb.updateShiftTotals(prev.id, {
         total_sales:   totalSales,
         total_cash:    totalCash,
         total_ecocash: totalEco,
         total_card:    totalCard,   // swipe only — EcoCash now has its own column
         total_room:    totalRoom,
         tx_count:      allTx.length,
       }).catch(e => console.warn('[ShiftContext] DB total sync failed:', e));

       return next;
     });
     return tx;
   };

  const voidTransaction = (transactionId: string, reason: string): boolean => {
    if (!activeShift) return false;
    
    const transactionIndex = activeShift.transactions.findIndex(tx => tx.id === transactionId);
    if (transactionIndex === -1) return false;

    const transaction = activeShift.transactions[transactionIndex];
    const voidedTransaction: ShiftTransaction = {
      ...transaction,
      voided: true,
      voidedAt: new Date().toISOString(),
      voidReason: reason
    };

    setActiveShift(prev => {
      if (!prev) return null;
      const next = {
        ...prev,
        transactions: prev.transactions.filter(tx => tx.id !== transactionId),
        voidedTransactions: [...prev.voidedTransactions, voidedTransaction]
      };
      persist(next);
      return next;
    });

    return true;
  };

   const getTotals = (): { cash: number; ecocash: number; card: number; roomCharge: number; count: number; voidedCount: number; voidedAmount: number; barSales: number; restaurantSales: number } => {
     if (!activeShift) return { cash: 0, ecocash: 0, card: 0, roomCharge: 0, count: 0, voidedCount: 0, voidedAmount: 0, barSales: 0, restaurantSales: 0 };
     const txs = Array.isArray(activeShift.transactions) ? activeShift.transactions : [];
     const voidedTxs = Array.isArray(activeShift.voidedTransactions) ? activeShift.voidedTransactions : [];

     const totals = txs.reduce((acc, t) => {
       // Four separate payment methods now. EcoCash gets its own bucket so
       // the GL and reports can debit the EcoCash clearing account distinctly.
       if (t.method === 'cash') acc.cash += t.amount;
       else if (t.method === 'ecocash') acc.ecocash += t.amount;
       else if (t.method === 'swipe') acc.card += t.amount;
       else if (t.method === 'room-charge') acc.roomCharge += t.amount;

       if (t.outlet === 'bar') acc.barSales += t.amount;
       else acc.restaurantSales += t.amount;

       acc.count += 1;
       return acc;
     }, { cash: 0, ecocash: 0, card: 0, roomCharge: 0, count: 0, voidedCount: 0, voidedAmount: 0, barSales: 0, restaurantSales: 0 });

     // Add voided transaction totals
     totals.voidedCount = voidedTxs.length;
     totals.voidedAmount = voidedTxs.reduce((sum, tx) => sum + tx.amount, 0);

     return totals;
   };

  type ShiftTotals = ReturnType<typeof getTotals>;

  // Reconcile in-memory shift totals against the database so a wiped or partial
  // localStorage (e.g. after a desktop power-cut) can NEVER make the Z-reading
  // under-report. We compute three INDEPENDENT views of the shift and take the
  // per-bucket maximum:
  //   1. local   — the in-memory transaction list (what the screen shows)
  //   2. recon   — rebuilt from pos_orders closed rows (survives a local wipe)
  //   3. agg     — the running pos_shifts totals synced to the server per sale
  // Per-bucket max means no single source can drag a total down, and because we
  // never SUM across sources, a transaction present in two of them is not
  // double-counted. Falls back to local totals if the DB lookups fail.
  const reconcileTotals = async (shift: Shift, local: ShiftTotals): Promise<ShiftTotals> => {
    try {
      const bucket = (txs: Array<{ method: string; amount: number; outlet?: string }>) =>
        txs.reduce((acc, t) => {
          const m = String(t.method);
          const amt = Number(t.amount) || 0;
          if (m === 'cash') acc.cash += amt;
          else if (m === 'ecocash') acc.ecocash += amt;
          else if (m === 'swipe') acc.card += amt;
          else if (m === 'room-charge') acc.roomCharge += amt;
          if (t.outlet === 'bar') acc.barSales += amt; else acc.restaurantSales += amt;
          acc.count += 1;
          return acc;
        }, { cash: 0, ecocash: 0, card: 0, roomCharge: 0, count: 0, barSales: 0, restaurantSales: 0 });

      const [dbTxns, agg] = await Promise.all([
        pmsAuthDb.getShiftTransactions(shift.id).catch(() => [] as any[]),
        pmsAuthDb.getShiftAggregates(shift.id).catch(() => null),
      ]);
      const recon = bucket(dbTxns as any);

      const max = (...n: number[]) => Math.max(...n.map(x => Number(x) || 0));
      // The DB aggregate now tracks EcoCash and Swipe in separate columns, so
      // each method reconciles independently (per-bucket max, no re-split).
      return {
        cash:            max(local.cash, recon.cash, agg?.total_cash ?? 0),
        ecocash:         max(local.ecocash, recon.ecocash, agg?.total_ecocash ?? 0),
        card:            max(local.card, recon.card, agg?.total_card ?? 0),
        roomCharge:      max(local.roomCharge, recon.roomCharge, agg?.total_room ?? 0),
        count:           max(local.count, recon.count, agg?.tx_count ?? 0),
        // pos_orders reconstruction excludes voids; keep the local void figures.
        voidedCount:     local.voidedCount,
        voidedAmount:    local.voidedAmount,
        // pos_shifts has no bar/restaurant split — reconcile against local + recon only.
        barSales:        max(local.barSales, recon.barSales),
        restaurantSales: max(local.restaurantSales, recon.restaurantSales),
      };
    } catch (e) {
      console.warn('[ShiftContext] totals reconciliation failed, using local totals:', e);
      return local;
    }
  };

  const getReconciledTotals = async (): Promise<ShiftTotals> => {
    if (!activeShift) return getTotals();
    return reconcileTotals(activeShift, getTotals());
  };

  const getEndedShifts = (): Shift[] => endedShifts;
  const clearEndedShifts = (): void => {
    setEndedShifts([]);
    localStorage.removeItem('corepms_endedShifts');
  };

  const clearActiveShift = (): void => {
    setActiveShift(null);
    persist(null);
  };

  const generateXReading = (): ShiftReading | null => {
    if (!activeShift) return null;
    
    const totals = getTotals();
    const totalSales = totals.cash + totals.ecocash + totals.card + totals.roomCharge;

    return {
      id: `X_READING_${Date.now()}`,
      reading_number: Math.floor(Math.random() * 1000) + 1, // Simple counter
      reading_type: 'X',
      shift_id: activeShift.id,
      total_sales: totalSales,
      total_transactions: totals.count,
      bar_sales: totals.barSales,
      restaurant_sales: totals.restaurantSales,
      cash_payments: totals.cash,
      ecocash_payments: totals.ecocash,
      card_payments: totals.card,
      room_charge_payments: totals.roomCharge,
      created_at: new Date().toISOString()
    };
  };

  const generateZReading = (closingCash?: number): ShiftReading | null => {
    if (!activeShift) return null;

    const totals = getTotals();
    const totalSales = totals.cash + totals.ecocash + totals.card + totals.roomCharge;
    const expectedCash = activeShift.openingCash + totals.cash;
    const cashDifference = closingCash !== undefined ? closingCash - expectedCash : 0;

    return {
      id: `Z_READING_${Date.now()}`,
      reading_number: zReadings.length + 1,
      reading_type: 'Z',
      shift_id: activeShift.id,
      total_sales: totalSales,
      total_transactions: totals.count,
      bar_sales: totals.barSales,
      restaurant_sales: totals.restaurantSales,
      cash_payments: totals.cash,
      ecocash_payments: totals.ecocash,
      card_payments: totals.card,
      room_charge_payments: totals.roomCharge,
      created_at: new Date().toISOString(),
      report_data: {
        expectedCash,
        closingCash: closingCash || expectedCash,
        cashDifference
      }
    };
  };

  const getZReadings = (): ShiftReading[] => zReadings;

  const value: ShiftContextType = {
    activeShift,
    startShift,
    endShift,
    addTransaction,
    voidTransaction,
    getTotals,
    getReconciledTotals,
    getEndedShifts,
    clearEndedShifts,
    clearActiveShift,
    generateXReading,
    generateZReading,
    getZReadings
  };

  return (
    <ShiftContext.Provider value={value}>
      {children}
    </ShiftContext.Provider>
  );
};

export const useShift = (): ShiftContextType => {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error('useShift must be used within ShiftProvider');
  return ctx;
};
