/**
 * useNightAuditScheduler
 * ─────────────────────
 * Schedules the automatic Night Audit to run at 00:00 HOTEL time (Africa/Harare).
 *
 * HISTORY — why the guards below exist:
 * On 2026-07-14 the old "catch-up" logic fired the audit at 10:55 IN THE MORNING
 * on a browser whose localStorage lacked the last-run marker (fresh session).
 * It audited TODAY's date with zero revenue, the server cron then found the
 * date "already completed" and skipped, and the day's real sales never made a
 * night-audit journal. Three defects: (1) catch-up trusted a per-browser
 * localStorage marker instead of the DATABASE, (2) it audited today instead of
 * the stale business date, (3) it used the device timezone.
 *
 * Now:
 *   - The DB is the only idempotency source: before any auto run we check
 *     night_audit_runs for a completed row (localStorage is just a fast hint).
 *   - Catch-up fires ONLY when the DB business_date is genuinely behind the
 *     hotel calendar date — and it audits THAT stale business date.
 *   - A scheduled (midnight) run audits the business date being closed.
 *   - Daytime runs are refused outside the 23:30–06:00 hotel-time window unless
 *     a genuine business-date lag exists.
 *   - EVERY decision (run, skip, block + reason) is written to the
 *     night_audit_scheduler_log audit table for forensic review.
 */

import { useEffect, useRef, useCallback } from 'react';

const LS_LAST_AUTO_RUN = 'corepms_nightAudit_autoRun_lastDate';
const HOTEL_TZ = 'Africa/Harare';

/** Hotel-calendar date (YYYY-MM-DD) — NOT the device timezone. */
function todayHotel(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: HOTEL_TZ }).format(new Date());
}

/** Hotel-time hour+minute as minutes-since-midnight. */
function hotelMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: HOTEL_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const [h, m] = parts.split(':').map(Number);
  return h * 60 + m;
}

/** ms until the next 00:00 HOTEL time. */
function msUntilHotelMidnight(): number {
  const mins = hotelMinutes();
  const remaining = (24 * 60 - mins) * 60 * 1000;
  return Math.max(remaining, 30_000);
}

/** Append a row to the scheduler audit log (best-effort, never throws). */
async function logScheduler(event: string, detail: string, businessDate?: string | null) {
  try {
    const { db } = await import('@/lib/db');
    await db.query(
      `CREATE TABLE IF NOT EXISTS night_audit_scheduler_log (
         id BIGSERIAL PRIMARY KEY,
         event TEXT NOT NULL,
         detail TEXT,
         business_date DATE,
         hotel_date DATE,
         device_time TEXT,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`
    );
    await db.query(
      `INSERT INTO night_audit_scheduler_log (event, detail, business_date, hotel_date, device_time)
       VALUES (?, ?, ?, ?, ?)`,
      [event, detail, businessDate || null, todayHotel(), new Date().toString().slice(0, 33)]
    );
  } catch { /* audit log is best-effort */ }
}

/** DB truth: has a completed audit row for this business date? */
async function auditCompletedInDB(businessDate: string): Promise<boolean> {
  try {
    const { db } = await import('@/lib/db');
    const r = await db.query<any>(
      `SELECT 1 FROM night_audit_runs WHERE business_date::date = ?::date AND status = 'completed' LIMIT 1`,
      [businessDate]
    );
    return 'rows' in r && r.rows.length > 0;
  } catch { return false; }
}

/** DB truth: the current hotel business date from system_configs. */
async function currentBusinessDate(): Promise<string | null> {
  try {
    const { db } = await import('@/lib/db');
    const r = await db.query<any>(`SELECT value FROM system_configs WHERE key = 'business_date'`);
    if ('rows' in r && r.rows.length) {
      const v = typeof r.rows[0].value === 'string' ? JSON.parse(r.rows[0].value) : r.rows[0].value;
      const d = v?.date || v;
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    }
  } catch { /* fall through */ }
  return null;
}

export interface NightAuditSchedulerOptions {
  onStart?: (date: string) => void;
  onComplete?: (date: string, result: any) => void;
  onError?: (date: string, error: unknown) => void;
  enabled?: boolean;
}

export function useNightAuditScheduler(options: NightAuditSchedulerOptions = {}) {
  const { onStart, onComplete, onError, enabled = true } = options;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef  = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const runningRef  = useRef(false);

  /**
   * Run the audit for a SPECIFIC business date, guarded by the DB.
   * trigger: 'midnight' (scheduled) | 'catch-up' (business date lag detected)
   */
  const runAutoAudit = useCallback(async (auditDate: string, trigger: string) => {
    if (runningRef.current) return;

    // ── Guard 1: DB idempotency (localStorage is only a per-browser hint) ────
    if (await auditCompletedInDB(auditDate)) {
      localStorage.setItem(LS_LAST_AUTO_RUN, auditDate);
      await logScheduler('skipped_already_completed', `trigger=${trigger}; DB already has a completed run`, auditDate);
      return;
    }

    // ── Guard 2: time-of-day window. A scheduled run may only close the day
    // around hotel midnight (23:30–06:00). Outside that window ONLY a genuine
    // business-date lag (catch-up) may run — never "today" in the middle of
    // the trading day (the 2026-07-14 failure mode).
    const mins = hotelMinutes();
    const inNightWindow = mins >= 23 * 60 + 30 || mins <= 6 * 60;
    if (trigger !== 'catch-up' && !inNightWindow) {
      await logScheduler('blocked_out_of_window', `trigger=${trigger}; hotel time ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')} outside 23:30–06:00`, auditDate);
      return;
    }
    if (auditDate === todayHotel() && !inNightWindow) {
      await logScheduler('blocked_today_midday', `trigger=${trigger}; refusing to close TODAY (${auditDate}) during trading hours`, auditDate);
      return;
    }

    runningRef.current = true;
    onStart?.(auditDate);
    await logScheduler('run_started', `trigger=${trigger}`, auditDate);

    try {
      const [{ db }, nightAuditServiceMod] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/nightAuditService'),
      ]);
      const nightAuditService = nightAuditServiceMod.default;

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
        { rooms, guests, folioCharges, userId: `auto_scheduler:${trigger}` },
        {
          autoReconcile:          true,
          forceShiftClosure:      true,
          skipBackupCheck:        true,
          forceReconciliation:    true,
          autoReconcileTolerance: 9999,
        }
      );

      localStorage.setItem(LS_LAST_AUTO_RUN, auditDate);
      await logScheduler(result?.ok ? 'run_completed' : 'run_failed', `trigger=${trigger}; ok=${result?.ok}`, auditDate);
      onComplete?.(auditDate, result);
    } catch (err: any) {
      await logScheduler('run_error', `trigger=${trigger}; ${err?.message || err}`, auditDate);
      onError?.(auditDate, err);
    } finally {
      runningRef.current = false;
    }
  }, [onStart, onComplete, onError]);

  useEffect(() => {
    if (!enabled) return;

    // ── Catch-up: ONLY when the DB business date is genuinely behind the hotel
    // calendar (a missed midnight) — and it audits THAT stale business date,
    // never today. Runs after a short delay so data contexts mount first.
    const t = setTimeout(async () => {
      const bizDate = await currentBusinessDate();
      const hotelToday = todayHotel();
      if (bizDate && bizDate < hotelToday) {
        await logScheduler('catchup_triggered', `business_date ${bizDate} is behind hotel date ${hotelToday}`, bizDate);
        runAutoAudit(bizDate, 'catch-up');
      }
    }, 8000);

    const scheduleNext = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
      const delay = msUntilHotelMidnight();
      console.log(`[AutoNightAudit] Next automatic audit in ${Math.round(delay / 60000)} min (00:00 hotel time).`);
      timeoutRef.current = setTimeout(async () => {
        // At hotel midnight we close the business date that is ENDING.
        const bizDate = (await currentBusinessDate()) || todayHotel();
        runAutoAudit(bizDate, 'midnight');
        intervalRef.current = setInterval(async () => {
          const d = (await currentBusinessDate()) || todayHotel();
          runAutoAudit(d, 'midnight');
        }, 24 * 60 * 60 * 1000);
      }, delay);
    };

    scheduleNext();

    return () => {
      clearTimeout(t);
      if (timeoutRef.current)  clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, runAutoAudit]);
}
