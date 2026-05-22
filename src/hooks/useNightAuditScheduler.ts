/**
 * useNightAuditScheduler
 * ─────────────────────
 * Schedules the automatic Night Audit to run at exactly 00:00:00 local time.
 *
 * Algorithm:
 *   1. Compute milliseconds until the next local midnight.
 *   2. Set a one-shot setTimeout for that duration.
 *   3. When it fires, run the audit (best-effort, non-blocking).
 *   4. After completion, schedule the NEXT midnight (24 h later) via setInterval.
 *
 * Safety guards:
 *   - Only runs if the app is open at midnight (works as a browser-side scheduler).
 *   - Stores the last auto-run date in localStorage so it never runs twice for the same date.
 *   - Does NOT block the UI — runs asynchronously in the background.
 *   - All options match the existing "Force Reconciliation" mode so it clears blockers automatically.
 */

import { useEffect, useRef, useCallback } from 'react';

const LS_LAST_AUTO_RUN = 'corepms_nightAudit_autoRun_lastDate';

/** Returns milliseconds until the next local midnight (00:00:00.000). */
function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // next midnight
  return midnight.getTime() - now.getTime();
}

/** ISO date string for today (local timezone). */
function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export interface NightAuditSchedulerOptions {
  /** Called when the auto-run is about to start. */
  onStart?: (date: string) => void;
  /** Called when the auto-run completes (result may be ok or not). */
  onComplete?: (date: string, result: any) => void;
  /** Called when the auto-run fails with an error. */
  onError?: (date: string, error: unknown) => void;
  /** Set to false to disable the scheduler entirely (e.g. during manual audit). */
  enabled?: boolean;
}

export function useNightAuditScheduler(options: NightAuditSchedulerOptions = {}) {
  const { onStart, onComplete, onError, enabled = true } = options;
  const intervalRef  = useRef<ReturnType<typeof setInterval>  | null>(null);
  const timeoutRef   = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const runningRef   = useRef(false);

  /** Run the night audit non-interactively with full auto-reconcile + force flags. */
  const runAutoAudit = useCallback(async () => {
    if (runningRef.current) return; // prevent concurrent runs

    const auditDate = todayLocal();

    // Guard: don't run twice for the same calendar date
    const lastRun = localStorage.getItem(LS_LAST_AUTO_RUN);
    if (lastRun === auditDate) {
      console.log('[AutoNightAudit] Already ran for', auditDate, '— skipping.');
      return;
    }

    runningRef.current = true;
    onStart?.(auditDate);
    console.log('[AutoNightAudit] Starting automatic night audit for', auditDate);

    try {
      // Dynamically import service and data to avoid circular deps
      const [{ db }, nightAuditServiceMod] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/nightAuditService'),
      ]);

      const nightAuditService = nightAuditServiceMod.default;

      // Fetch live data from DB for the audit context
      const [roomsRes, guestsRes, folioRes] = await Promise.all([
        db.query('SELECT * FROM rooms'),
        db.query(`SELECT g.*, r.room_id, ro.number as room_number
                  FROM guests g
                  LEFT JOIN reservations r ON r.guest_id = g.id AND r.status = 'checked-in'
                  LEFT JOIN rooms ro ON ro.id = r.room_id`),
        db.query(`SELECT * FROM folio_charges WHERE posting_date >= CURRENT_DATE - INTERVAL '1 day'`),
      ]);

      const rooms        = 'rows' in roomsRes  ? roomsRes.rows  : [];
      const guests       = 'rows' in guestsRes ? guestsRes.rows : [];
      const folioCharges = 'rows' in folioRes  ? folioRes.rows  : [];

      const result = await nightAuditService.runNightAudit(
        { rooms, guests, folioCharges, userId: 'auto_scheduler' },
        {
          autoReconcile:          true,
          forceShiftClosure:      true,
          skipBackupCheck:        true,
          forceReconciliation:    true,
          autoReconcileTolerance: 9999, // accept any variance in auto mode
        }
      );

      // Persist so we don't re-run today
      localStorage.setItem(LS_LAST_AUTO_RUN, auditDate);
      console.log('[AutoNightAudit] Completed for', auditDate, '— ok:', result.ok);
      onComplete?.(auditDate, result);
    } catch (err) {
      console.error('[AutoNightAudit] Error during automatic night audit:', err);
      onError?.(auditDate, err);
    } finally {
      runningRef.current = false;
    }
  }, [onStart, onComplete, onError]);

  useEffect(() => {
    if (!enabled) return;

    // ── Catch-up: if midnight passed while no browser was open, run the audit now.
    // Compares last-run date in localStorage; if it's before today, the system
    // missed at least one rollover. Fires immediately rather than waiting for
    // the next midnight (which would skip yet another day).
    const lastRun = localStorage.getItem(LS_LAST_AUTO_RUN);
    if (lastRun !== todayLocal()) {
      console.log('[AutoNightAudit] Catch-up run — last completed:', lastRun || 'never');
      // Small delay so the app has time to mount data contexts before audit reads them
      setTimeout(() => runAutoAudit(), 8000);
    }

    const scheduleNext = () => {
      // Clear any previous timer
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);

      const delay = msUntilMidnight();
      console.log(
        `[AutoNightAudit] Next automatic audit scheduled in ${Math.round(delay / 60000)} min (at local midnight).`
      );

      // Fire at midnight
      timeoutRef.current = setTimeout(() => {
        runAutoAudit();

        // Then repeat every 24 hours in case the browser session stays open for multiple nights
        intervalRef.current = setInterval(() => {
          runAutoAudit();
        }, 24 * 60 * 60 * 1000);
      }, delay);
    };

    scheduleNext();

    return () => {
      if (timeoutRef.current)  clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, runAutoAudit]);
}
