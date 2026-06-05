/**
 * useResilientBill — canonical resilient bill state for the Service Total
 * lifecycle. This is the TARGET hook for the full OrderModal rewrite (Phase D).
 *
 * Phase B wires the lighter draft-mirror directly into the existing OrderModal
 * (so the live cart is untouched when the flag is off); this hook is the single
 * source of truth the rewrite will adopt. It is exercised/validated now so it
 * cannot become a Phase-D landmine.
 *
 * Model:
 *   • draft     — uncommitted lines, in React state AND mirrored to IndexedDB
 *                 on every change (survives a crash mid-entry).
 *   • committed — frozen lines read back from pos_check_lines.
 *   • serviceTotal() — atomic, idempotent commit via commitServiceTotal().
 *   • auto-commit on unmount / tab close — never discards uncommitted work.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '@/lib/db';
import { getDraft, putDraft, clearDraft } from '@/lib/billDraftStore';
import { commitServiceTotal, type ServiceTotalLine } from '@/lib/serviceTotal';

export type ResilientDraftLine = ServiceTotalLine;
export interface ResilientCommittedLine extends ServiceTotalLine { seq: number; frozen: true }
export interface UseResilientBillCtx { costCenter: string; shiftId?: string; userId?: string }

export function useResilientBill(tableNumber: string, ctx: UseResilientBillCtx) {
  const draftKey = `t${tableNumber}`;
  const [committed, setCommitted] = useState<ResilientCommittedLine[]>([]);
  const [draft, setDraft] = useState<ResilientDraftLine[]>([]);
  const checkIdRef = useRef<string | null>(null);
  const committing = useRef(false);

  // Rehydrate: committed lines from the DB + any draft that outlived a crash.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res: any = await db.query(
          `SELECT c.id AS check_id, l.* FROM pos_checks c
           JOIN pos_check_lines l ON l.check_id = c.id
           WHERE c.table_number=? AND c.cost_center=? AND c.status='open' AND l.state='committed'
           ORDER BY l.seq`,
          [String(tableNumber), ctx.costCenter]
        );
        const rows = (res && 'rows' in res ? res.rows : []) as any[];
        if (!cancelled) {
          if (rows.length) checkIdRef.current = rows[0].check_id;
          setCommitted(rows.map((r) => ({
            id: r.id, itemId: r.item_id, name: r.name, qty: Number(r.qty),
            unitPrice: Number(r.unit_price), station: r.route_station, seq: r.seq, frozen: true as const,
          })));
        }
      } catch {
        /* offline → committed stays empty until reconnect */
      }
      const d = await getDraft<ResilientDraftLine>(draftKey);
      if (!cancelled && d) setDraft(d);
    })();
    return () => { cancelled = true; };
  }, [tableNumber, ctx.costCenter, draftKey]);

  const persistDraft = useCallback((next: ResilientDraftLine[]) => { void putDraft(draftKey, next); }, [draftKey]);

  const addItem = useCallback((line: Omit<ResilientDraftLine, 'id'>) => {
    setDraft((prev) => {
      const next = [...prev, { ...line, id: `D_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }];
      persistDraft(next);
      return next;
    });
  }, [persistDraft]);

  // Guardrail: only DRAFT lines are removable here; committed lines need a void.
  const removeDraftLine = useCallback((id: string) => {
    setDraft((prev) => { const next = prev.filter((l) => l.id !== id); persistDraft(next); return next; });
  }, [persistDraft]);

  const serviceTotal = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (committing.current) return false;
    const pending = (await getDraft<ResilientDraftLine>(draftKey)) ?? draft;
    if (!pending.length) return true;
    committing.current = true;
    try {
      const res = await commitServiceTotal({
        checkId: checkIdRef.current, tableNumber: String(tableNumber), costCenter: ctx.costCenter,
        shiftId: ctx.shiftId, userId: ctx.userId, lines: pending,
      });
      if (res.success) {
        checkIdRef.current = res.checkId || checkIdRef.current;
        setCommitted((prev) => [...prev, ...pending.map((l, i) => ({ ...l, seq: prev.length + i + 1, frozen: true as const }))]);
        setDraft([]);
        await clearDraft(draftKey);
        return true;
      }
      return false;
    } finally {
      committing.current = false;
    }
  }, [draft, draftKey, tableNumber, ctx.costCenter, ctx.shiftId, ctx.userId]);

  // Auto-commit on unmount / tab close — partial bill is committed, never lost.
  useEffect(() => {
    const flush = () => { void getDraft(draftKey).then((d) => { if (d && d.length) void serviceTotal({ silent: true }); }); };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [draftKey, serviceTotal]);

  return {
    committed,
    draft,
    addItem,
    removeDraftLine,
    serviceTotal,
    // Staydown: silent micro-commit for high-volume bars (no nav, no logout).
    staydownCommit: () => serviceTotal({ silent: true }),
  };
}

export default useResilientBill;
