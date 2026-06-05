#!/usr/bin/env node
/**
 * scripts/backfill-gl-journals-remote.cjs
 *
 * Same one-time GL backfill as backfill-gl-journals.cjs, but driven entirely
 * through a deployment's PUBLIC HTTP API (/api/db/query + /api/db/transaction)
 * instead of a direct Postgres connection. Use this for deployments whose
 * DATABASE_URL you do not have locally (e.g. the Baradzanwa Vercel project).
 *
 * See backfill-gl-journals.cjs for the accounting rationale. Entry per audit:
 *   DR 1100 Accounts Receivable = room_revenue + fbRevenue
 *   CR 4000 Rooms Revenue       = room_revenue
 *   CR 4100 Food Revenue        = fbRevenue
 * Idempotent via deterministic id `na_bf_<YYYYMMDD>`.
 *
 * USAGE:
 *   node scripts/backfill-gl-journals-remote.cjs https://baradzanwa.vercel.app
 */

const BASE = process.argv[2];
if (!BASE) { console.error('Usage: node backfill-gl-journals-remote.cjs <BASE_URL>'); process.exit(1); }

const ACC_AR = '1100', ACC_ROOM = '4000', ACC_FB = '4100';
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

async function apiQuery(sql, params) {
  const r = await fetch(`${BASE}/api/db/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  return r.json();
}
async function apiTransaction(operations) {
  const r = await fetch(`${BASE}/api/db/transaction`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations })
  });
  return r.json();
}

async function main() {
  console.log(`Backfilling GL journals via ${BASE}`);
  const auditsRes = await apiQuery(
    `SELECT business_date::date::text AS date, room_revenue, total_revenue, reports_snapshot
     FROM night_audit_runs WHERE status = 'completed' ORDER BY business_date ASC`, []
  );
  if (!auditsRes.ok) { console.error('ERROR reading night_audit_runs:', auditsRes.error); process.exit(1); }
  const audits = auditsRes.rows || [];
  console.log(`Found ${audits.length} completed night_audit_runs.`);

  let created = 0, skipped = 0, zeroValue = 0, failed = 0;

  for (const a of audits) {
    const date = a.date;
    const entryId = `na_bf_${date.replace(/-/g, '')}`;
    const snap = a.reports_snapshot || {};
    const room = round2(a.room_revenue);
    let fb = snap.fbRevenue != null ? round2(snap.fbRevenue)
                                    : round2(Number(a.total_revenue || 0) - Number(a.room_revenue || 0));
    if (fb < 0) fb = 0;
    const total = round2(room + fb);
    if (total <= 0) { zeroValue++; continue; }

    const exists = await apiQuery(`SELECT 1 FROM gl_journal_entries WHERE id = $1 LIMIT 1`, [entryId]);
    if (exists.ok && (exists.rows || []).length > 0) { skipped++; continue; }

    const lines = [{ acc: ACC_AR, debit: total, credit: 0, desc: 'Daily revenue to Accounts Receivable' }];
    if (room > 0) lines.push({ acc: ACC_ROOM, debit: 0, credit: room, desc: 'Rooms Revenue (night audit)' });
    if (fb > 0)   lines.push({ acc: ACC_FB,   debit: 0, credit: fb,   desc: 'Food & Beverage Revenue (night audit)' });

    const ops = [{
      sql: `INSERT INTO gl_journal_entries
              (id, entry_date, business_date, description, reference, source,
               entry_type, status, total_debit, total_credit, is_balanced,
               is_voided, created_by, posted_by, posted_at, inserted_at, updated_at)
            VALUES ($1, $2::date, $2::date, $3, $4, 'night_audit',
                    'standard', 'posted', $5, $5, true,
                    false, 'gl_backfill', 'gl_backfill', NOW(), NOW(), NOW())`,
      params: [entryId, date, `Night Audit revenue journal — ${date}`, `NA-BF-${date}`, total]
    }];
    lines.forEach((l, i) => ops.push({
      sql: `INSERT INTO gl_journal_lines
              (id, journal_entry_id, line_number, gl_account_id, debit_amount, credit_amount, description, inserted_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      params: [`${entryId}_l${i + 1}`, entryId, i + 1, l.acc, l.debit, l.credit, l.desc]
    }));

    const tx = await apiTransaction(ops);
    if (tx.ok) { created++; console.log(`  ✔ ${date}  DR ${ACC_AR} ${total} | CR ${ACC_ROOM} ${room} CR ${ACC_FB} ${fb}`); }
    else       { failed++;  console.error(`  ✘ ${date}  FAILED: ${tx.error}`); }
  }

  console.log('\n──────────── Backfill summary ────────────');
  console.log(`  Created : ${created}`);
  console.log(`  Skipped (already existed) : ${skipped}`);
  console.log(`  Zero-revenue days (no entry): ${zeroValue}`);
  console.log(`  Failed  : ${failed}`);
  console.log('──────────────────────────────────────────');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
