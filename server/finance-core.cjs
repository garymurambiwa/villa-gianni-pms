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
  await db.query(`CREATE TABLE IF NOT EXISTS accounting_periods (
    period TEXT PRIMARY KEY,              -- 'YYYY-MM'
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_by TEXT,
    closed_at TIMESTAMPTZ,
    reopened_by TEXT,
    reopened_at TIMESTAMPTZ,
    note TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS doc_sequences (
    doc_type TEXT PRIMARY KEY,            -- 'GRN','JV','PAY','TRF','EXP','ADJ'
    next_val BIGINT NOT NULL DEFAULT 1
  )`);
  ready = true;
}

/** 'YYYY-MM' for a date-ish value. */
function periodOf(dateLike) {
  const s = String(dateLike || '');
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Throws { code:'PERIOD_CLOSED', period, message } when `date` falls in a closed
 * accounting period. Call inside a try/catch and surface the message to the user.
 */
async function assertPeriodOpen(db, date, action = 'post') {
  await ensureFinanceTables(db);
  const period = periodOf(date);
  if (!period) return; // unparseable date — don't block (never hide on bad input)
  const r = await db.query(`SELECT status FROM accounting_periods WHERE period = $1`, [period]);
  if (r.rows && r.rows.length && r.rows[0].status === 'closed') {
    const err = new Error(`Accounting period ${period} is closed — cannot ${action} a transaction dated in it. Reopen the period (Accounting → Period Close) or use a date in an open period.`);
    err.code = 'PERIOD_CLOSED';
    err.period = period;
    throw err;
  }
}

/** Non-throwing check: returns { closed:boolean, period }. */
async function isPeriodClosed(db, date) {
  await ensureFinanceTables(db);
  const period = periodOf(date);
  if (!period) return { closed: false, period: null };
  const r = await db.query(`SELECT status FROM accounting_periods WHERE period = $1`, [period]);
  return { closed: !!(r.rows && r.rows.length && r.rows[0].status === 'closed'), period };
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

module.exports = { ensureFinanceTables, assertPeriodOpen, isPeriodClosed, nextDocId, seedSequence, periodOf };
