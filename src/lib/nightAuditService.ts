/**
 * Night Audit Service
 * Implements real, persisted operations using localStorage-backed snapshots.
 * Steps: prepare/validate → post room & tax → transfer to City Ledger → date rollover → backup → report bundle
 * 
 * Includes automatic reconciliation fallback for handling variances and forced completion.
 */
import gl from './glAccounting';
import { 
   syncFolioChargeToDb, 
   syncNightAuditPostingToDb, 
   recordNightAuditRun, 
   recordReconciliationLog,
   recordVarianceJournalEntry,
   FolioChargeRecord,
   ReconciliationLogRecord,
   VarianceJournalEntryRecord
 } from './dbSync';
import { fetchApi } from '@/lib/api';

export interface NightAuditContext {
  rooms: any[];
  guests: any[];
  folioCharges: any[];
  userId: string;
}

const readJSON = <T>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// Today's date in the HOTEL timezone (Africa/Harare / CAT), formatted YYYY-MM-DD.
// Using toISOString() here returned the UTC date, which is a day off from the
// hotel's calendar for several hours each night and was a source of date drift
// (worse now the server is in US-East). en-CA formats as YYYY-MM-DD.
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(new Date());

// Add N calendar days to a YYYY-MM-DD string via pure UTC-anchored arithmetic.
const addDaysISO = (dateStr: string, n: number): string => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Returns true if a COMPLETED night audit already exists in the DB for the given
// business date. Used as an idempotency guard so the browser-side scheduler never
// double-runs a date that the backend cron already closed (which would advance
// the business date a second time and drift it ahead). Best-effort: on any error
// it returns false so a genuine audit is never silently blocked.
const auditAlreadyCompleted = async (businessDate: string): Promise<boolean> => {
  try {
    const res: any = await fetchApi('/api/db/query', {
      method: 'POST',
      body: JSON.stringify({
        sql: `SELECT 1 FROM night_audit_runs WHERE business_date = $1 AND status = 'completed' LIMIT 1`,
        params: [businessDate]
      })
    });
    const rows = res?.rows ?? res?.data?.rows ?? [];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
};

// ============================================================================
// VALIDATION SETTINGS
// ============================================================================

export interface ValidationOptions {
  forceReconciliation?: boolean;  // Force through reconciliation issues
  forceShiftClosure?: boolean;    // Force through active shift issues
  skipBackupCheck?: boolean;      // Skip backup validation
  autoReconcile?: boolean;        // Automatically reconcile variances
  autoReconcileTolerance?: number; // Maximum variance allowed for auto-reconciliation
}

export const prepareAndValidate = (ctx: NightAuditContext, options: ValidationOptions = {}) => {
  const issues: string[] = [];
  const warnings: string[] = [];
  const canForce: string[] = [];
  
  // Check for active POS shift
  const activeShift = readJSON<any | null>('corepms_activeShift', null);
  if (activeShift) {
    if (options.forceShiftClosure) {
      warnings.push('Active POS shift bypassed (force mode).');
    } else {
      issues.push('Active POS shift detected. End shift before Night Audit.');
      canForce.push('forceShiftClosure');
    }
  }
  
  // Check for backup
  const lastBackup = readJSON<any | null>('corepms_backup_last', null);
  if (!lastBackup) {
    if (options.skipBackupCheck) {
      warnings.push('Backup check bypassed (force mode).');
    } else {
      issues.push('No system backup found. Complete backup before Night Audit.');
      canForce.push('skipBackupCheck');
    }
  }
  
  // Check for reconciliation
  const reconciled = readJSON<boolean>('corepms_tx_reconciled', false);
  if (!reconciled) {
    if (options.forceReconciliation || options.autoReconcile) {
      warnings.push('Reconciliation bypassed (auto-reconcile mode enabled).');
    } else {
      issues.push('Daily transactions reconciliation not confirmed.');
      canForce.push('forceReconciliation');
    }
  }
  
  // Enhanced check for room occupancy data
  const occupiedRooms = ctx.rooms?.filter((r: any) => r.status === 'OC' || r.status === 'OD') || [];
  if (occupiedRooms.length === 0) {
    warnings.push('No occupied rooms found. Night audit will post zero room charges.');
  }
  
  // Check for essential data context
  if (!ctx.rooms || ctx.rooms.length === 0) {
    issues.push('Room data unavailable. Cannot process night audit.');
  }
  
  if (!ctx.guests || ctx.guests.length === 0) {
    warnings.push('Guest data unavailable. Room charges may be incomplete.');
  }
  
  // Check GL mappings
  try {
    const mapCheck = gl.validateMappingsComplete();
    if (!mapCheck.ok) issues.push(`Missing GL mappings: ${mapCheck.missing.join(', ')}`);
  } catch {}
  
  return { 
    ok: issues.length === 0, 
    issues, 
    warnings,
    canForce,
    canAutoReconcile: canForce.includes('forceReconciliation')
  };
};

export const postRoomAndTax = (ctx: NightAuditContext) => {
  const postings: any[] = [];
  const folioChargesNew: any[] = [];
  const businessDate = readJSON<string>('corepms_business_date', todayISO());
  // Read default rate plan and tax profile if available
  const ratePlan = readJSON<any>('corepms_rate_plan_default', { baseRate: 100 });
  // Accommodation tax profile set in FO Settings → Tax Setup. Default 15%
  // inclusive (the property's configured rate) — NOT the old 10% default that
  // silently ignored the configured value.
  const taxProfile = readJSON<any>('corepms_tax_profile_default', { taxRate: 0.15, inclusive: true });
  const taxInclusive = taxProfile?.inclusive !== false;
  // For each occupied room, create a posting entry. Use a placeholder rate if none available.
  const occupiedRooms = ctx.rooms.filter((r: any) => r.status === 'OC' || r.status === 'OD');
  occupiedRooms.forEach((room: any) => {
    const guest = ctx.guests.find((g: any) => String(g.roomNumber) === String(room.number));
    const roomRate = Number(guest?.dailyRate ?? room?.dailyRate ?? ratePlan?.baseRate ?? 100);
    const taxRate = Number(guest?.taxRate ?? taxProfile?.taxRate ?? 0.15);

    // Inclusive: the room rate already contains tax → back it out.
    // Exclusive: tax is added on top of the room rate.
    let tax: number, baseRate: number, totalAmount: number;
    if (taxInclusive) {
      tax = Number((roomRate * (taxRate / (1 + taxRate))).toFixed(2));
      baseRate = Number((roomRate - tax).toFixed(2));
      totalAmount = roomRate;
    } else {
      baseRate = roomRate;
      tax = Number((roomRate * taxRate).toFixed(2));
      totalAmount = Number((roomRate + tax).toFixed(2));
    }
    
    const guestId = guest?.id ?? null;
    const postingId = `POST_NA_${businessDate}_${room.number}_${Date.now()}`;
    
    const posting = { 
      id: postingId,
      type: 'ROOM_TAX', 
      roomNumber: room.number, 
      guestId, 
      baseRate, 
      tax, 
      amount: totalAmount, 
      date: businessDate 
    };
    postings.push(posting);
    
    // Also create folio charge entries for the guest's account
    if (guestId) {
      const chargeId = `CHG_NA_${businessDate}_${room.number}_${Date.now()}`;
      // Conference rooms bill to their own revenue stream — category 'Conference'
      // keeps the charge OUT of room revenue so ADR/RevPAR stay accurate.
      const isConference = /conference/i.test(String(room.type || ''));
      const roomCharge = {
        id: chargeId,
        guestId,
        roomNumber: room.number,
        description: `${isConference ? 'Conference Room Charge' : 'Room Charge'} - ${room.number}`,
        amount: baseRate,
        date: businessDate,
        category: isConference ? 'Conference' : 'Room',
        type: 'charge',
        source: 'night_audit'
      };
      folioChargesNew.push(roomCharge);
      
      // Tax charge
      if (tax > 0) {
        const taxCharge = {
          id: `${chargeId}_tax`,
          guestId,
          roomNumber: room.number,
          description: `Accommodation Tax - ${room.number}`,
          amount: tax,
          date: businessDate,
          category: 'Tax',
          type: 'charge',
          source: 'night_audit'
        };
        folioChargesNew.push(taxCharge);
      }
      
      // Sync room charge to database asynchronously
      const roomDbRecord: FolioChargeRecord = {
        id: chargeId,
        guest_id: guestId,
        room_number: room.number,
        charge_type: 'charge',
        category: 'Room',
        description: `Room Charge - ${room.number}`,
        amount: baseRate,
        tax_amount: 0,
        total_amount: baseRate,
        source: 'night_audit',
        source_reference: postingId,
        posting_date: businessDate,
        business_date: businessDate
      };
      syncFolioChargeToDb(roomDbRecord).catch(err => {
        console.warn('[nightAudit] Failed to sync room charge to DB:', err);
      });
      
      // Sync tax charge to database if applicable
      if (tax > 0) {
        const taxDbRecord: FolioChargeRecord = {
          id: `${chargeId}_tax`,
          guest_id: guestId,
          room_number: room.number,
          charge_type: 'charge',
          category: 'Tax',
          description: `Accommodation Tax - ${room.number}`,
          amount: tax,
          tax_amount: 0,
          total_amount: tax,
          source: 'night_audit',
          source_reference: postingId,
          posting_date: businessDate,
          business_date: businessDate
        };
        syncFolioChargeToDb(taxDbRecord).catch(err => {
          console.warn('[nightAudit] Failed to sync tax charge to DB:', err);
        });
      }
      
      // Sync night audit posting to database
      syncNightAuditPostingToDb({
        id: postingId,
        business_date: businessDate,
        room_number: room.number,
        guest_id: guestId,
        posting_type: 'ROOM_TAX',
        base_rate: baseRate,
        tax_amount: tax,
        total_amount: amount,
        status: 'posted',
        folio_charge_id: chargeId,
        posted_by: ctx.userId
      }).catch(err => {
        console.warn('[nightAudit] Failed to sync posting to DB:', err);
      });
    }
  });
  
  // Save postings to corepms_postings
  const prev = readJSON<any[]>('corepms_postings', []);
  writeJSON('corepms_postings', [...postings, ...prev].slice(0, 2000));
  
  // Save folio charges to corepms_folioCharges for persistence
  const existingCharges = readJSON<any[]>('corepms_folioCharges', []);
  writeJSON('corepms_folioCharges', [...folioChargesNew, ...existingCharges].slice(0, 5000));
  
  return { count: postings.length, postings, folioCharges: folioChargesNew };
};

export const transferCityLedger = (ctx: NightAuditContext) => {
  // Transfer folios with positive balance for checked-out guests to city ledger
  const cityLedger = readJSON<any[]>('corepms_city_ledger', []);
  const transfers: any[] = [];
  (ctx.guests || []).forEach((g: any) => {
    const balance = Number(g.folioBalance ?? 0);
    const checkedOut = String(g.status || '').toLowerCase() === 'checkedout' || g.checkedOut === true;
    if (checkedOut && balance > 0) {
      const entry = { guestId: g.id, guestName: g.fullName || g.name, amount: balance, date: todayISO(), reason: 'Night Audit transfer' };
      transfers.push(entry);
    }
  });
  writeJSON('corepms_city_ledger', [...transfers, ...cityLedger].slice(0, 2000));
  return { count: transfers.length, transfers };
};

export const rolloverBusinessDate = async () => {
  const prevDate = readJSON<string>('corepms_business_date', todayISO());
  // Guard invalid stored value
  if (isNaN(new Date(prevDate + 'T00:00:00Z').getTime())) {
    writeJSON('corepms_business_date', todayISO());
    return { previous: prevDate, next: todayISO() };
  }
  // Pure date arithmetic (no local/UTC mixing) then CLAMP to hotel-today (CAT).
  // The audit runs at 00:00 CAT, so the open business date should never lead the
  // real calendar date — cap at today, not today+1. This is the hard stop that
  // prevents the forward drift caused by multiple rollover paths advancing the
  // same date on one night. Day-by-day catch-up still works (advances by one,
  // stops at today).
  let nextISO = addDaysISO(prevDate, 1);
  const cap = todayISO();
  if (nextISO > cap) nextISO = cap;
  writeJSON('corepms_business_date', nextISO);

  // Sync new business date to backend so the scheduler stays in sync
  await fetchApi('/api/db/query', {
    method: 'POST',
    body: JSON.stringify({
      sql: `INSERT INTO system_configs (key, value, description, updated_at, updated_by)
            VALUES ('business_date', $1::jsonb, 'Current hotel business date', NOW(), 'frontend_rollover')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      params: [JSON.stringify({ date: nextISO, rolled_at: new Date().toISOString() })]
    })
  }).catch(() => {}); // non-blocking — best-effort

  return { previous: prevDate, next: nextISO };
};

export const backupSnapshot = (ctx: NightAuditContext) => {
  const snapshot = {
    date: todayISO(),
    rooms: ctx.rooms,
    guests: ctx.guests,
    folioCharges: ctx.folioCharges,
    audit: readJSON<any[]>('corepms_pos_audit', [])
  };
  writeJSON(`corepms_backup_${snapshot.date}`, snapshot);
  writeJSON('corepms_backup_last', snapshot);
  return { key: `corepms_backup_${snapshot.date}` };
};

export const generateReportsBundle = (ctx: NightAuditContext, auditBusinessDate?: string) => {
  // Conference rooms are EXCLUDED from all rooms KPIs (occupancy, ADR, RevPAR,
  // rooms available/sold) so conference space never distorts accommodation stats.
  const guestRooms = (ctx.rooms || []).filter((r: any) => !/conference/i.test(String(r.type || '')));
  const occupied = guestRooms.filter((r: any) => r.status === 'OC' || r.status === 'OD').length;
  const availableRooms = guestRooms.filter((r: any) => r.status !== 'OOO' && r.status !== 'OOS').length;
  const occupancy = availableRooms ? ((occupied / availableRooms) * 100) : 0;

  // CRITICAL FIX: Use the audit date (BEFORE rollover) not the current business date.
  // generateReportsBundle is called AFTER rolloverBusinessDate(), so reading business_date
  // from localStorage would give tomorrow's date — causing the filter to match nothing.
  // The caller must pass auditBusinessDate (the date BEFORE rollover).
  const reportDate = auditBusinessDate || todayISO();

  // Read from localStorage corepms_folioCharges (freshly written by postRoomAndTax)
  // instead of ctx.folioCharges (DataContext - stale, full history, unfilterable).
  const allLocalCharges = readJSON<any[]>('corepms_folioCharges', []);

  // Filter strictly to the audit business date to avoid cumulative revenue inflation.
  const todaysCharges = allLocalCharges.filter((c: any) => {
    const d = String(c.date || c.business_date || c.posting_date || '');
    return d.startsWith(reportDate);
  });

  // Also include charges from ctx.folioCharges that match the audit date
  // (in case DataContext has F&B charges not yet written to corepms_folioCharges)
  const ctxTodayCharges = (ctx.folioCharges || []).filter((c: any) => {
    const d = String(c.date || c.business_date || c.posting_date || '');
    return d.startsWith(reportDate);
  });

  // Merge, deduplicating by id
  const seenIds = new Set<string>();
  const mergedCharges: any[] = [];
  [...todaysCharges, ...ctxTodayCharges].forEach(c => {
    const id = String(c.id || '');
    if (!id || !seenIds.has(id)) {
      seenIds.add(id);
      mergedCharges.push(c);
    }
  });

  const roomRevenue = mergedCharges
    .filter((c: any) => c.category === 'Room')
    .reduce((s: number, c: any) => s + Number(c.amount || 0), 0);

  const fbCharges = mergedCharges.filter((c: any) => c.category === 'F&B');
  const fbRevenue = fbCharges.reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
  // Split F&B into Food vs Beverage revenue streams for the P&L. POS-originated
  // folio charges carry the outlet in the description ("Bar POS - bill-0012"),
  // so bar/beverage outlets classify as Beverage, everything else as Food.
  const beverageRevenue = fbCharges
    .filter((c: any) => /\b(bar|beverage|liquor|pub)\b/i.test(String(c.description || '')))
    .reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
  const foodRevenue = Number((fbRevenue - beverageRevenue).toFixed(2));

  // Conference/Events revenue — its own stream, NEVER in room revenue (so it
  // can't inflate ADR/RevPAR) but included in total revenue.
  const conferenceRevenue = mergedCharges
    .filter((c: any) => c.category === 'Conference')
    .reduce((s: number, c: any) => s + Number(c.amount || 0), 0);

  // Accommodation tax posted to folios — credited to Taxes Payable in the journal
  const taxRevenue = mergedCharges
    .filter((c: any) => c.category === 'Tax')
    .reduce((s: number, c: any) => s + Number(c.amount || 0), 0);

  const totalRevenue = roomRevenue + fbRevenue + conferenceRevenue;
  const avgDailyRate = occupied > 0 && roomRevenue > 0 ? roomRevenue / occupied : 0;

  // RevPAR = Total Room Revenue / Total Available Rooms
  let revPAR = 0;
  if (availableRooms > 0 && !isNaN(roomRevenue) && roomRevenue > 0) {
    revPAR = roomRevenue / availableRooms;
  }

  // Count only today's postings
  const todaysPostings = readJSON<any[]>('corepms_postings', [])
    .filter((p: any) => String(p.date || p.business_date || '').startsWith(reportDate));

  const bundle = {
    date: reportDate,
    occupancy: Number(occupancy.toFixed(2)),
    roomRevenue: Number(roomRevenue.toFixed(2)),
    fbRevenue: Number(fbRevenue.toFixed(2)),
    foodRevenue: Number(foodRevenue.toFixed(2)),
    beverageRevenue: Number(beverageRevenue.toFixed(2)),
    conferenceRevenue: Number(conferenceRevenue.toFixed(2)),
    taxRevenue: Number(taxRevenue.toFixed(2)),
    totalRevenue: Number(totalRevenue.toFixed(2)),
    avgDailyRate: Number(avgDailyRate.toFixed(2)),
    revPAR: Number(revPAR.toFixed(2)),
    cityLedgerCount: readJSON<any[]>('corepms_city_ledger', []).length,
    postingsCount: todaysPostings.length
  };

  // Persist under the audit date key AND as the "last" bundle
  writeJSON(`corepms_nightAudit_reports_${reportDate}`, bundle);
  writeJSON('corepms_nightAudit_lastReports', bundle);
  return bundle;
};

export const reconcileTotals = (ctx: NightAuditContext) => {
  // Folio totals — only today's business date to avoid cumulative inflation
  const bizDate = readJSON<string>('corepms_business_date', todayISO());
  const todayCharges = (ctx.folioCharges || []).filter((c: any) => {
    const d = c.date || c.business_date || c.posting_date || '';
    return d.startsWith(bizDate);
  });
  const folioTotal = todayCharges.reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
  // Shift sales totals (ended + active)
  const ended = readJSON<any[]>('corepms_endedShifts', []);
  const active = readJSON<any | null>('corepms_activeShift', null);
  const sumShift = (list: any[]) => list.reduce((acc: number, s: any) => acc + (Array.isArray(s.transactions) ? s.transactions.reduce((t: number, tx: any) => t + Number(tx.amount || 0), 0) : 0), 0);
  const shiftTotal = sumShift(ended) + (active ? sumShift([active]) : 0);
  // Room & tax postings for current business date
  const businessDate = readJSON<string>('corepms_business_date', todayISO());
  const postings = readJSON<any[]>('corepms_postings', []);
  const postingsTodayTotal = postings.filter(p => p.date === businessDate).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const varianceFolioVsShift = Number((folioTotal - shiftTotal).toFixed(2));
  const varianceFolioVsPostings = Number((folioTotal - postingsTodayTotal).toFixed(2));
  const totalVariance = Number((Math.abs(varianceFolioVsShift) + Math.abs(varianceFolioVsPostings)).toFixed(2));
  const hasVariance = varianceFolioVsShift !== 0 || varianceFolioVsPostings !== 0;
  
  const reconciliation = {
    date: businessDate,
    folioTotal: Number(folioTotal.toFixed(2)),
    shiftTotal: Number(shiftTotal.toFixed(2)),
    postingsTodayTotal: Number(postingsTodayTotal.toFixed(2)),
    varianceFolioVsShift,
    varianceFolioVsPostings,
    totalVariance,
    hasVariance
  };
  writeJSON('corepms_reconciliation_last', reconciliation);
  return reconciliation;
};

// ============================================================================
// AUTOMATIC RECONCILIATION FALLBACK
// ============================================================================

interface AutoReconcileResult {
  ok: boolean;
  forced: boolean;
  journalEntries: string[];
  affectedAccounts: Array<{ account: string; debit?: number; credit?: number }>;
  reconciliationLogId?: string;
  warnings: string[];
}

/**
 * Automatic reconciliation fallback that creates journal entries for variances
 * and forces the night audit to complete when manual reconciliation fails.
 */
export const performAutoReconciliation = async (
  ctx: NightAuditContext,
  reconciliation: ReturnType<typeof reconcileTotals>,
  userId?: string,
  options: ValidationOptions = {}
): Promise<AutoReconcileResult> => {
  const journalEntries: string[] = [];
  const affectedAccounts: Array<{ account: string; debit?: number; credit?: number }> = [];
  const warnings: string[] = [];
  
  // Check tolerance
  const tolerance = options.autoReconcileTolerance ?? 0;
  const totalVar = Math.abs(reconciliation.totalVariance);
  
  if (totalVar > tolerance && !options.forceReconciliation) {
    return {
      ok: false,
      forced: false,
      journalEntries: [],
      affectedAccounts: [],
      warnings: [`Variance (${totalVar.toFixed(2)}) exceeds tolerance (${tolerance.toFixed(2)}). Manual override required.`]
    };
  }

  const businessDate = readJSON<string>('corepms_business_date', todayISO());
  
  // Define GL accounts for variance adjustments
  const SUSPENSE_ACCOUNT = '9999-00';  // Suspense/Clearing Account
  const OVER_SHORT_ACCOUNT = '7600-00'; // Cash Over/Short Expense
  const REVENUE_VARIANCE_ACCOUNT = '4999-00'; // Revenue Variance
  
  // Handle Folio vs Shift variance
  if (reconciliation.varianceFolioVsShift !== 0) {
    const variance = reconciliation.varianceFolioVsShift;
    const entryId = `JE_RECON_SHIFT_${businessDate}_${Date.now()}`;
    
    let debitAcct: string;
    let creditAcct: string;
    let description: string;
    
    if (variance > 0) {
      // Folio > Shift means revenue understated in shifts
      debitAcct = SUSPENSE_ACCOUNT;
      creditAcct = REVENUE_VARIANCE_ACCOUNT;
      description = `Auto-reconcile: Folio exceeds Shift totals by ${variance.toFixed(2)}`;
    } else {
      // Shift > Folio means potential overage
      debitAcct = OVER_SHORT_ACCOUNT;
      creditAcct = SUSPENSE_ACCOUNT;
      description = `Auto-reconcile: Shift exceeds Folio totals by ${Math.abs(variance).toFixed(2)}`;
    }
    
    journalEntries.push(entryId);
    affectedAccounts.push(
      { account: debitAcct, debit: Math.abs(variance) },
      { account: creditAcct, credit: Math.abs(variance) }
    );
    
    warnings.push(`Created variance adjustment for Folio/Shift difference: ${variance.toFixed(2)}`);
    
    // Record to database
    try {
      await recordVarianceJournalEntry({
        journal_entry_id: entryId,
        business_date: businessDate,
        entry_type: 'variance_adjustment',
        debit_account: debitAcct,
        credit_account: creditAcct,
        amount: Math.abs(variance),
        description,
        reference: 'Night Audit Auto-Reconciliation',
        created_by: userId
      });
    } catch (err) {
      console.warn('[nightAudit] Failed to record variance journal entry to DB:', err);
    }
    
    // Create GL journal entry
    try {
      gl.appendLedger({
        id: entryId,
        date: businessDate,
        reference: description,
        lines: [
          { accountId: debitAcct, description: 'Variance Debit', debit: Math.abs(variance), credit: 0 },
          { accountId: creditAcct, description: 'Variance Credit', debit: 0, credit: Math.abs(variance) }
        ]
      });
    } catch (err) {
      console.warn('[nightAudit] Failed to post GL journal entry:', err);
    }
  }
  
  // Handle Folio vs Postings variance
  if (reconciliation.varianceFolioVsPostings !== 0) {
    const variance = reconciliation.varianceFolioVsPostings;
    const entryId = `JE_RECON_POST_${businessDate}_${Date.now()}`;
    
    let debitAcct: string;
    let creditAcct: string;
    let description: string;
    
    if (variance > 0) {
      debitAcct = SUSPENSE_ACCOUNT;
      creditAcct = REVENUE_VARIANCE_ACCOUNT;
      description = `Auto-reconcile: Folio exceeds Postings by ${variance.toFixed(2)}`;
    } else {
      debitAcct = OVER_SHORT_ACCOUNT;
      creditAcct = SUSPENSE_ACCOUNT;
      description = `Auto-reconcile: Postings exceed Folio by ${Math.abs(variance).toFixed(2)}`;
    }
    
    journalEntries.push(entryId);
    affectedAccounts.push(
      { account: debitAcct, debit: Math.abs(variance) },
      { account: creditAcct, credit: Math.abs(variance) }
    );
    
    warnings.push(`Created variance adjustment for Folio/Postings difference: ${variance.toFixed(2)}`);
    
    // Record to database
    try {
      await recordVarianceJournalEntry({
        journal_entry_id: entryId,
        business_date: businessDate,
        entry_type: 'variance_adjustment',
        debit_account: debitAcct,
        credit_account: creditAcct,
        amount: Math.abs(variance),
        description,
        reference: 'Night Audit Auto-Reconciliation',
        created_by: userId
      });
    } catch (err) {
      console.warn('[nightAudit] Failed to record variance journal entry to DB:', err);
    }
    
    // Create GL journal entry
    try {
      gl.appendLedger({
        id: entryId,
        date: businessDate,
        reference: description,
        lines: [
          { accountId: debitAcct, description: 'Variance Debit', debit: Math.abs(variance), credit: 0 },
          { accountId: creditAcct, description: 'Variance Credit', debit: 0, credit: Math.abs(variance) }
        ]
      });
    } catch (err) {
      console.warn('[nightAudit] Failed to post GL journal entry:', err);
    }
  }
  
  // Record reconciliation log
  let reconciliationLogId: string | undefined;
  try {
    const logResult = await recordReconciliationLog({
      business_date: businessDate,
      reconciliation_type: 'automatic',
      status: 'forced_complete',
      folio_total: reconciliation.folioTotal,
      shift_total: reconciliation.shiftTotal,
      postings_total: reconciliation.postingsTodayTotal,
      variance_folio_vs_shift: reconciliation.varianceFolioVsShift,
      variance_folio_vs_postings: reconciliation.varianceFolioVsPostings,
      total_variance: reconciliation.totalVariance,
      is_forced: true,
      force_reason: (Math.abs(reconciliation.totalVariance) > (options.autoReconcileTolerance ?? 0)) ? 'Manual override (exceeded tolerance)' : 'Automatic reconciliation within tolerance',
      journal_entry_ids: journalEntries,
      affected_accounts: affectedAccounts,
      performed_by: userId,
      notes: `Variances auto-reconciled: Folio/Shift=${reconciliation.varianceFolioVsShift}, Folio/Postings=${reconciliation.varianceFolioVsPostings}. Tolerance=${options.autoReconcileTolerance ?? 0}`,
      metadata: { timestamp: new Date().toISOString(), warnings, before: { ...reconciliation }, after: { resolved: true } }
    });
    reconciliationLogId = logResult.id;
  } catch (err) {
    console.warn('[nightAudit] Failed to record reconciliation log to DB:', err);
  }
  
  // Mark as reconciled in localStorage so future checks pass
  writeJSON('corepms_tx_reconciled', true);
  
  // Save auto-reconciliation record locally
  const autoReconRecord = {
    date: businessDate,
    timestamp: new Date().toISOString(),
    forced: true,
    variances: {
      folioVsShift: reconciliation.varianceFolioVsShift,
      folioVsPostings: reconciliation.varianceFolioVsPostings,
      total: reconciliation.totalVariance
    },
    journalEntries,
    affectedAccounts,
    performedBy: userId
  };
  
  const prevAutoRecons = readJSON<any[]>('corepms_auto_reconciliations', []);
  writeJSON('corepms_auto_reconciliations', [autoReconRecord, ...prevAutoRecons].slice(0, 365));
  
  return {
    ok: true,
    forced: true,
    journalEntries,
    affectedAccounts,
    reconciliationLogId,
    warnings
  };
};

/**
 * Helper function to automatically resolve common night audit blockers
 */
export const resolveCommonBlockers = (options: ValidationOptions = {}) => {
  const resolutions: string[] = [];
  
  // Auto-resolve active shift if force option is enabled
  if (options.forceShiftClosure) {
    try {
      const activeShift = readJSON<any | null>('corepms_activeShift', null);
      if (activeShift) {
        // Simulate ending the shift
        writeJSON('corepms_activeShift', null);
        resolutions.push('Active POS shift automatically ended');
        console.log('[nightAudit] Automatically resolved: Ended active POS shift');
      }
    } catch (err) {
      console.warn('[nightAudit] Failed to auto-resolve active shift:', err);
    }
  }
  
  // Auto-mark reconciliation as complete if auto-reconcile is enabled
  if (options.autoReconcile) {
    try {
      const reconciled = readJSON<boolean>('corepms_tx_reconciled', false);
      if (!reconciled) {
        writeJSON('corepms_tx_reconciled', true);
        resolutions.push('Transaction reconciliation automatically confirmed');
        console.log('[nightAudit] Automatically resolved: Marked transactions as reconciled');
      }
    } catch (err) {
      console.warn('[nightAudit] Failed to auto-resolve reconciliation:', err);
    }
  }
  
  // Create dummy backup record if skip backup check is enabled
  if (options.skipBackupCheck) {
    try {
      const lastBackup = readJSON<any | null>('corepms_backup_last', null);
      if (!lastBackup) {
        const dummyBackup = {
          timestamp: new Date().toISOString(),
          type: 'dummy_for_night_audit',
          note: 'Auto-generated for night audit bypass'
        };
        writeJSON('corepms_backup_last', dummyBackup);
        resolutions.push('System backup check bypassed with dummy record');
        console.log('[nightAudit] Automatically resolved: Created dummy backup record');
      }
    } catch (err) {
      console.warn('[nightAudit] Failed to auto-resolve backup check:', err);
    }
  }
  
  return resolutions;
};

export const runNightAudit = async (ctx: NightAuditContext, options: ValidationOptions = {}) => {
  // Automatically resolve common blockers before validation
  const autoResolutions = resolveCommonBlockers(options);
  
  // First validation pass
  let validation = prepareAndValidate(ctx, options);
  
  // If validation fails but we can auto-reconcile, try with auto-reconcile enabled
  if (!validation.ok && validation.canAutoReconcile && options.autoReconcile) {
    console.log('[nightAudit] Validation failed, attempting with auto-reconcile...');
    validation = prepareAndValidate(ctx, { ...options, autoReconcile: true });
  }
  
  // If still failing, check if we can force through
  if (!validation.ok) {
    // Check if all remaining issues can be forced
    const canForceAll = validation.canForce.every(f => 
      (f === 'forceReconciliation' && options.autoReconcile) ||
      (f === 'forceShiftClosure' && options.forceShiftClosure) ||
      (f === 'skipBackupCheck' && options.skipBackupCheck)
    );
    
    if (!canForceAll) {
      return { 
        ok: false, 
        step: 'prepare', 
        issues: validation.issues,
        warnings: validation.warnings,
        canForce: validation.canForce
      };
    }
  }
  
  const businessDateBefore = readJSON<string>('corepms_business_date', todayISO());

  // Idempotency: if the backend already recorded a completed audit for this
  // business date, do NOT post/roll again. This stops the browser-side scheduler
  // from racing the always-on backend cron and double-advancing the date (the
  // root cause of the business date drifting weeks ahead into the future).
  if (await auditAlreadyCompleted(businessDateBefore)) {
    console.log('[nightAudit] Already completed for', businessDateBefore, '— skipping (idempotent).');
    return { ok: true, step: 'skipped', skipped: true, businessDate: businessDateBefore };
  }

  const postings = postRoomAndTax(ctx);
  const transfers = transferCityLedger(ctx);
  const reconciliation = reconcileTotals(ctx);

  // If there are variances and auto-reconcile is enabled, perform automatic reconciliation
  let autoReconcileResult: AutoReconcileResult | null = null;
  if (reconciliation.hasVariance && options.autoReconcile) {
    console.log('[nightAudit] Variances detected, performing automatic reconciliation...');
    autoReconcileResult = await performAutoReconciliation(ctx, reconciliation, ctx.userId, options);
    
    if (!autoReconcileResult.ok) {
      // If auto-recon failed (e.g. tolerance exceeded), stop and return error
      return {
        ok: false,
        step: 'reconcile',
        issues: autoReconcileResult.warnings,
        canForce: ['forceReconciliation']
      };
    }
    
     console.log('[nightAudit] Auto-reconciliation complete:', autoReconcileResult);
   }
   
   // Await + capture: this result is referenced below (rollover.next / rollover).
   // It was previously fire-and-forget, leaving `rollover` undefined → a
   // ReferenceError that aborted the run AFTER the date had already advanced
   // (date moved with no matching audit record).
   const rollover = await rolloverBusinessDate();
   const backup = backupSnapshot(ctx);
   // Pass businessDateBefore (the AUDIT night) not rolled-forward date
   const reports = generateReportsBundle(ctx, businessDateBefore);

  // GL posting using the audit date (before rollover)
  try {
    const glResult = await gl.postDailyJournalFromNightAudit(businessDateBefore, reports);
    if (!glResult.ok) {
      console.warn('GL posting skipped:', glResult.error);
    }
  } catch (err) {
    console.warn('GL posting error', err);
  }

  // Record night audit run to database
  const occupied = ctx.rooms.filter((r: any) => r.status === 'OC' || r.status === 'OD').length;
  const availableRooms = ctx.rooms.filter((r: any) => r.status !== 'OOO' && r.status !== 'OOS').length;
  const taxRevenue = postings.postings.reduce((sum: number, p: any) => sum + Number(p.tax || 0), 0);
  
  recordNightAuditRun({
    business_date: businessDateBefore,
    next_business_date: rollover.next,
    rooms_posted: postings.count,
    room_revenue: reports.roomRevenue,
    tax_revenue: taxRevenue,
    total_revenue: reports.totalRevenue,
    city_ledger_transfers: transfers.count,
    city_ledger_amount: transfers.transfers.reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0),
    occupied_rooms: occupied,
    available_rooms: availableRooms,
    occupancy_percent: reports.occupancy,
    adr: reports.avgDailyRate,
    revpar: reports.revPAR,
    run_by: ctx.userId,
    reports_snapshot: reports
  }).catch(err => {
    console.warn('[nightAudit] Failed to record audit run to DB:', err);
  });
  
  const summary = {
    ok: true,
    step: 'complete',
    postings, 
    transfers, 
    reconciliation, 
    rollover, 
    backup, 
    reports,
    autoReconcile: autoReconcileResult,
    warnings: validation.warnings || [],
    forced: autoReconcileResult?.forced || false
  };
  writeJSON('corepms_nightAudit_lastRun', summary);
  return summary;
};

/**
 * Synchronous version of runNightAudit for backward compatibility.
 * Does not perform auto-reconciliation (use runNightAudit with options.autoReconcile for that).
 */
export const runNightAuditSync = async (ctx: NightAuditContext) => {
  const validation = prepareAndValidate(ctx);
  if (!validation.ok) {
    return { ok: false, step: 'prepare', issues: validation.issues };
  }
  
    const businessDateBefore = readJSON<string>('corepms_business_date', todayISO());

    // Idempotency: skip if the backend already recorded a completed audit for
    // this business date (prevents double-run / date drift — see runNightAudit).
    if (await auditAlreadyCompleted(businessDateBefore)) {
      console.log('[nightAudit] Already completed for', businessDateBefore, '— skipping (idempotent).');
      return { ok: true, step: 'skipped', skipped: true, businessDate: businessDateBefore };
    }

    const postings = postRoomAndTax(ctx);
    const transfers = transferCityLedger(ctx);
    const reconciliation = reconcileTotals(ctx);
    const rollover = await rolloverBusinessDate(); // await + capture (see runNightAudit note)
    const backup = backupSnapshot(ctx);
    // Pass businessDateBefore so reports reflect the AUDIT night (not rolled-forward next day)
    const reports = generateReportsBundle(ctx, businessDateBefore);

  // GL posting using the audit business date (before rollover)
  try {
    const glResult = await gl.postDailyJournalFromNightAudit(businessDateBefore, reports);
    if (!glResult.ok) {
      console.warn('GL posting skipped:', glResult.error);
    }
  } catch (err) {
    console.warn('GL posting error', err);
  }
  
  // Record night audit run to database
  const occupied = ctx.rooms.filter((r: any) => r.status === 'OC' || r.status === 'OD').length;
  const availableRooms = ctx.rooms.filter((r: any) => r.status !== 'OOO' && r.status !== 'OOS').length;
  const taxRevenue = postings.postings.reduce((sum: number, p: any) => sum + Number(p.tax || 0), 0);
  
  recordNightAuditRun({
    business_date: businessDateBefore,
    next_business_date: rollover.next,
    rooms_posted: postings.count,
    room_revenue: reports.roomRevenue,
    tax_revenue: taxRevenue,
    total_revenue: reports.totalRevenue,
    city_ledger_transfers: transfers.count,
    city_ledger_amount: transfers.transfers.reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0),
    occupied_rooms: occupied,
    available_rooms: availableRooms,
    occupancy_percent: reports.occupancy,
    adr: reports.avgDailyRate,
    revpar: reports.revPAR,
    run_by: ctx.userId,
    reports_snapshot: reports
  }).catch(err => {
    console.warn('[nightAudit] Failed to record audit run to DB:', err);
  });
  
  const summary = {
    ok: true,
    step: 'complete',
    postings, transfers, reconciliation, rollover, backup, reports
  };
  writeJSON('corepms_nightAudit_lastRun', summary);
  return summary;
};

export default {
  prepareAndValidate,
  postRoomAndTax,
  transferCityLedger,
  reconcileTotals,
  performAutoReconciliation,
  rolloverBusinessDate,
  backupSnapshot,
  generateReportsBundle,
  runNightAudit,
  runNightAuditSync
};
