/**
 * finance-core.cjs — shared financial-integrity primitives (CommonJS; the repo
 * is type:module so server helpers MUST be .cjs).
 *
 *  1. Accounting periods: close/reopen a month and BLOCK postings dated into a
 *     closed period (assertPeriodOpen). The controller's authoritative guard.
 *  2. Document sequences: short, human-readable, collision-free 5-digit ids per
 *     type — GRN-00001, JV-00001, PAY-00001, TRF-00001, EXP-00001, ADJ-00001.
 *
 * Both are lazy-initialised (CREATE TABLE IF NOT EXISTS) so no migration step is
 * required; safe to call on every request.
 */

let ready = false;
async function ensureFinanceTables(db) {
  if (ready) return;
  // Reuse the pre-existing accounting_periods table (period_year, period_month,
  // status, …). Add a unique index so we can upsert one row per month cleanly.
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_periods_ym
                  ON accounting_periods (period_year, period_month)`).catch(() => {});
  await db.query(`CREATE TABLE IF NOT EXISTS doc_sequences (
    doc_type TEXT PRIMARY KEY,            -- 'GRN','JV','PAY','TRF','EXP','ADJ'
    next_val BIGINT NOT NULL DEFAULT 1
  )`);
  ready = true;
}

/** {year, month, label 'YYYY-MM'} for a date-ish value, or null. */
function periodParts(dateLike) {
  const s = String(dateLike || '');
  const m = s.match(/^(\d{4})-(\d{2})/);
  let y, mo;
  if (m) { y = Number(m[1]); mo = Number(m[2]); }
  else { const d = new Date(dateLike); if (isNaN(d.getTime())) return null; y = d.getUTCFullYear(); mo = d.getUTCMonth() + 1; }
  return { year: y, month: mo, label: `${y}-${String(mo).padStart(2, '0')}` };
}
function periodOf(dateLike) { const p = periodParts(dateLike); return p ? p.label : null; }

/**
 * Throws { code:'PERIOD_CLOSED', period, message } when `date` falls in a closed
 * accounting period. Call inside a try/catch and surface the message to the user.
 */
async function assertPeriodOpen(db, date, action = 'post') {
  await ensureFinanceTables(db);
  const p = periodParts(date);
  if (!p) return; // unparseable date — don't block (never hide on bad input)
  const r = await db.query(
    `SELECT status FROM accounting_periods WHERE period_year=$1 AND period_month=$2`, [p.year, p.month]);
  if (r.rows && r.rows.length && String(r.rows[0].status).toLowerCase() === 'closed') {
    const err = new Error(`Accounting period ${p.label} is closed — cannot ${action} a transaction dated in it. Reopen the period (Accounting → Period Close) or use a date in an open period.`);
    err.code = 'PERIOD_CLOSED';
    err.period = p.label;
    throw err;
  }
}

/** Non-throwing check: returns { closed:boolean, period }. */
async function isPeriodClosed(db, date) {
  await ensureFinanceTables(db);
  const p = periodParts(date);
  if (!p) return { closed: false, period: null };
  const r = await db.query(
    `SELECT status FROM accounting_periods WHERE period_year=$1 AND period_month=$2`, [p.year, p.month]);
  return { closed: !!(r.rows && r.rows.length && String(r.rows[0].status).toLowerCase() === 'closed'), period: p.label };
}

/** Set a period's status ('open'|'closed'); upserts the month row. */
async function setPeriodStatus(db, label, status, actor, note) {
  await ensureFinanceTables(db);
  const p = periodParts(label + '-01');
  if (!p) throw new Error('period must be YYYY-MM');
  const startDate = `${p.label}-01`;
  const endDate = new Date(Date.UTC(p.year, p.month, 0)).toISOString().slice(0, 10); // last day of month
  const name = new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const isClose = status === 'closed';
  await db.query(
    `INSERT INTO accounting_periods
       (id, period_year, period_month, period_name, start_date, end_date, status,
        closed_by, closed_at, reopened_by, reopened_at, reopen_reason, inserted_at, updated_at)
     VALUES (gen_random_uuid()::text, $1,$2,$3,$4::date,$5::date,$6,
        CASE WHEN $6='closed' THEN $7 ELSE NULL END, CASE WHEN $6='closed' THEN NOW() ELSE NULL END,
        CASE WHEN $6='open' THEN $7 ELSE NULL END,  CASE WHEN $6='open' THEN NOW() ELSE NULL END,
        $8, NOW(), NOW())
     ON CONFLICT (period_year, period_month) DO UPDATE SET
        status=$6,
        closed_by=CASE WHEN $6='closed' THEN $7 ELSE accounting_periods.closed_by END,
        closed_at=CASE WHEN $6='closed' THEN NOW() ELSE accounting_periods.closed_at END,
        reopened_by=CASE WHEN $6='open' THEN $7 ELSE accounting_periods.reopened_by END,
        reopened_at=CASE WHEN $6='open' THEN NOW() ELSE accounting_periods.reopened_at END,
        reopen_reason=COALESCE($8, accounting_periods.reopen_reason),
        updated_at=NOW()`,
    [p.year, p.month, name, startDate, endDate, status, actor || 'controller', note || null]
  );
  return { period: p.label, status };
}

/**
 * Next 5-digit document id for a type, e.g. nextDocId(db,'JV') -> 'JV-00007'.
 * Atomic via an UPSERT that returns the incremented value.
 */
async function nextDocId(db, docType) {
  await ensureFinanceTables(db);
  const r = await db.query(
    `INSERT INTO doc_sequences (doc_type, next_val) VALUES ($1, 2)
     ON CONFLICT (doc_type) DO UPDATE SET next_val = doc_sequences.next_val + 1
     RETURNING next_val - 1 AS current`,
    [docType]
  );
  const n = Number(r.rows?.[0]?.current || 1);
  return `${docType}-${String(n).padStart(5, '0')}`;
}

/** Seed a sequence so new ids continue past existing records (idempotent). */
async function seedSequence(db, docType, startAtLeast) {
  await ensureFinanceTables(db);
  await db.query(
    `INSERT INTO doc_sequences (doc_type, next_val) VALUES ($1, $2)
     ON CONFLICT (doc_type) DO UPDATE SET next_val = GREATEST(doc_sequences.next_val, EXCLUDED.next_val)`,
    [docType, Number(startAtLeast) + 1]
  );
}

module.exports = { ensureFinanceTables, assertPeriodOpen, isPeriodClosed, setPeriodStatus, nextDocId, seedSequence, periodOf, periodParts };
