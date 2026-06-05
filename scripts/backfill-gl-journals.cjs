#!/usr/bin/env node
/**
 * scripts/backfill-gl-journals.cjs
 *
 * ONE-TIME BACKFILL — populate gl_journal_entries / gl_journal_lines from the
 * historical night_audit_runs table.
 *
 * WHY: server-side night-audit catch-up (POST /api/night-audit/run) records
 * revenue stats into night_audit_runs but never posts a GL journal. As a result
 * the P&L and Trial Balance reports (which read gl_journal_lines) are blank even
 * though 42 audits exist. This script generates one balanced double-entry journal
 * per audit so those reports show historical figures.
 *
 * ENTRY SHAPE (per audit, USALI-aligned, using the existing chart of accounts):
 *   DR 1100 Accounts Receivable  = room_revenue + fbRevenue   (cash/guest ledger asset)
 *   CR 4000 Rooms Revenue        = room_revenue
 *   CR 4100 Food Revenue         = fbRevenue
 * Debits always equal credits by construction, so every entry balances.
 *
 * IDEMPOTENT: each entry id is deterministic (`na_bf_<YYYYMMDD>`). Re-running skips
 * audits whose entry already exists, so it is safe to run multiple times.
 *
 * USAGE (PowerShell):
 *   $env:DATABASE_URL = "<neon connection string>"; node scripts/backfill-gl-journals.cjs
 * The DATABASE_URL is the same value used by render.yaml / .env.
 */

const db = require('../server/db-web.cjs');

// GL account ids — confirmed present in the production gl_accounts table.
const ACC_AR   = '1100'; // Accounts Receivable (Asset)
const ACC_ROOM = '4000'; // Rooms Revenue (Revenue)
const ACC_FB   = '4100'; // Food Revenue (Revenue)

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  // 1. Pull every completed audit with its revenue figures.
  const auditsRes = await db.query(
    `SELECT business_date::date::text AS date,
            room_revenue,
            total_revenue,
            reports_snapshot
     FROM night_audit_runs
     WHERE status = 'completed'
     ORDER BY business_date ASC`
  );
  if (!auditsRes.ok) {
    console.error('ERROR reading night_audit_runs:', auditsRes.error);
    process.exit(1);
  }
  const audits = auditsRes.rows || [];
  console.log(`Found ${audits.length} completed night_audit_runs.`);

  let created = 0, skipped = 0, zeroValue = 0, failed = 0;

  for (const a of audits) {
    const date = a.date;
    const entryId = `na_bf_${date.replace(/-/g, '')}`;

    // Derive F&B revenue from the snapshot, falling back to (total - room).
    const snap = a.reports_snapshot || {};
    const room = round2(a.room_revenue);
    let fb = snap.fbRevenue != null
      ? round2(snap.fbRevenue)
      : round2(Number(a.total_revenue || 0) - Number(a.room_revenue || 0));
    if (fb < 0) fb = 0; // never post a negative revenue credit

    const total = round2(room + fb);
    if (total <= 0) { zeroValue++; continue; } // nothing to post for a no-revenue day

    // 2. Idempotency guard — skip if this backfill entry already exists.
    const exists = await db.query(
      `SELECT 1 FROM gl_journal_entries WHERE id = $1 LIMIT 1`, [entryId]
    );
    if (exists.ok && exists.rows.length > 0) { skipped++; continue; }

    // 3. Build the balanced line set.
    const lines = [{ acc: ACC_AR, debit: total, credit: 0, desc: 'Daily revenue to Accounts Receivable' }];
    if (room > 0) lines.push({ acc: ACC_ROOM, debit: 0, credit: room, desc: 'Rooms Revenue (night audit)' });
    if (fb > 0)   lines.push({ acc: ACC_FB,   debit: 0, credit: fb,   desc: 'Food & Beverage Revenue (night audit)' });

    // 4. Assemble the transaction: one entry + its lines, committed atomically.
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
    lines.forEach((l, i) => {
      ops.push({
        sql: `INSERT INTO gl_journal_lines
                (id, journal_entry_id, line_number, gl_account_id,
                 debit_amount, credit_amount, description, inserted_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        params: [`${entryId}_l${i + 1}`, entryId, i + 1, l.acc, l.debit, l.credit, l.desc]
      });
    });

    const tx = await db.transaction(ops);
    if (tx.ok) {
      created++;
      console.log(`  ✔ ${date}  DR ${ACC_AR} ${total}  | CR ${ACC_ROOM} ${room}  CR ${ACC_FB} ${fb}`);
    } else {
      failed++;
      console.error(`  ✘ ${date}  FAILED: ${tx.error}`);
    }
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
