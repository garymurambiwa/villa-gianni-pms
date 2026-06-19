-- ============================================================================
-- One-shot remediation: Night-Audit business-date drift
-- ============================================================================
-- CONTEXT
--   Multiple independent rollover paths (always-on backend cron, browser-side
--   scheduler, manual + catch-up triggers) each advanced the shared
--   `business_date` on the same night. The old clamp only capped at today+1, so
--   over weeks the date drifted ~8-14 days AHEAD of the real (Africa/Harare)
--   calendar and stamped FUTURE business dates onto audit runs and folio charges.
--   The 00:00 schedule was never removed. GL journal entries were unaffected
--   (zero future-dated), so the P&L / financial statements were always intact.
--
--   The recurrence is now prevented in code (idempotency guard + cap-at-today in
--   nightAuditRunner.cjs / nightAuditService.ts, commit 6df5c7c) and at the DB
--   layer (guard_audit_run_date trigger, commit d9bd6a3). This script performs
--   the ONE-TIME correction of the data that drift already created.
--
-- GUARANTEES (matches what was run live on Villa Gianni 2026-06-19)
--   * NON-DESTRUCTIVE: no financial rows are deleted.
--       - Future-dated folio charges are REVERSED via is_voided (row preserved
--         with full void metadata), not removed.
--       - Phantom future-dated audit runs are ARCHIVED to
--         night_audit_runs_drift_archive before being removed from the live
--         table (the live table has a UNIQUE(business_date) + status CHECK +
--         guard trigger that make an in-place "voided" flag impossible).
--   * OPEN folios only have their balance corrected (closed folios are settled).
--   * IDEMPOTENT: re-running is a no-op (guards on is_voided / NOT IN archive).
--
-- USAGE
--   Run against the target database (e.g. Baradzanwa's Neon DB) once. "today" is
--   always derived in-SQL as the Africa/Harare (CAT) calendar date, so the
--   script is correct regardless of the server's OS timezone.
-- ============================================================================

BEGIN;

-- 1. Reverse future-dated night-audit folio charges (preserve rows) and correct
--    ONLY open-folio balances by the reversed amount. Closed folios are settled
--    and keep their historical balance untouched.
WITH tovoid AS (
  UPDATE folio_charges
     SET is_voided   = true,
         voided_at   = NOW(),
         voided_by   = 'drift_remediation',
         void_reason = 'Reversed: erroneous future-dated night-audit posting (business-date drift remediation)',
         updated_at  = NOW()
   WHERE business_date > (NOW() AT TIME ZONE 'Africa/Harare')::date
     AND source = 'night_audit'
     AND COALESCE(is_voided, false) = false
  RETURNING folio_id, total_amount
)
UPDATE folios fo
   SET balance    = balance - agg.amt,
       updated_at = NOW()
  FROM (SELECT folio_id, SUM(total_amount) AS amt FROM tovoid GROUP BY folio_id) agg
 WHERE fo.id = agg.folio_id
   AND fo.status = 'open';

-- 2. Preserve phantom future-dated audit runs in an archive table.
--    (CREATE ... AS WHERE false clones the column structure without the live
--    table's UNIQUE constraint / guard trigger, so the archive accepts them.)
CREATE TABLE IF NOT EXISTS night_audit_runs_drift_archive AS
  SELECT * FROM night_audit_runs WHERE false;

INSERT INTO night_audit_runs_drift_archive
  SELECT * FROM night_audit_runs
   WHERE business_date > (NOW() AT TIME ZONE 'Africa/Harare')::date
     AND status = 'completed'
     AND id NOT IN (SELECT id FROM night_audit_runs_drift_archive);

-- 3. Remove the phantom rows from the live table (now safely archived).
DELETE FROM night_audit_runs
 WHERE business_date > (NOW() AT TIME ZONE 'Africa/Harare')::date
   AND status = 'completed';

-- 4. Belt-and-braces: ensure the business_date pointer is not left ahead of
--    today. (The code/DB clamps already enforce this; harmless if already correct.)
UPDATE system_configs
   SET value = jsonb_set(value, '{date}',
               to_jsonb((NOW() AT TIME ZONE 'Africa/Harare')::date::text)),
       updated_at = NOW()
 WHERE key = 'business_date'
   AND (value->>'date')::date > (NOW() AT TIME ZONE 'Africa/Harare')::date;

COMMIT;

-- ── Verification (run after COMMIT; all should report clean) ─────────────────
-- SELECT COUNT(*) AS future_runs_remaining
--   FROM night_audit_runs
--  WHERE business_date > (NOW() AT TIME ZONE 'Africa/Harare')::date;            -- expect 0
-- SELECT COUNT(*) AS active_future_charges
--   FROM folio_charges
--  WHERE business_date > (NOW() AT TIME ZONE 'Africa/Harare')::date
--    AND COALESCE(is_voided,false) = false;                                     -- expect 0
-- SELECT COUNT(*) AS open_negative_balances
--   FROM folios WHERE status='open' AND balance < 0;                           -- expect 0
-- SELECT COUNT(*) AS archived_runs FROM night_audit_runs_drift_archive;        -- preserved
