#!/usr/bin/env node
'use strict';

const BASE = process.argv[2];
if (!BASE) {
  console.error('Usage: node scripts/migrate-gl-pending-batches.cjs <BASE_URL>');
  process.exit(1);
}

const base = BASE.replace(/\/$/, '');

async function apiQuery(sql, params = []) {
  const res = await fetch(`${base}/api/db/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`DB query failed: ${json.error}`);
  return json.rows || [];
}

async function createBatch(body) {
  const res = await fetch(`${base}/api/gl/pending-batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  console.log(`\nMigrating GL pending batches via ${base}`);
  console.log('─'.repeat(60));

  let created = 0, skipped = 0, zeroAmount = 0, failed = 0;

  console.log('\nScanning folio_charges...');
  const folioRows = await apiQuery(
    `SELECT fc.id, fc.charge_type, fc.amount, fc.description
     FROM folio_charges fc
     WHERE fc.charge_type IN ('room','food','beverage','incidental')
       AND NOT EXISTS (
         SELECT 1 FROM gl_pending_batches
         WHERE origin_table = 'folio_charges' AND origin_id = fc.id
       )`
  );
  console.log(`  Found ${folioRows.length} unlinked charges`);

  for (const fc of folioRows) {
    const amount = Number(fc.amount || 0);
    if (amount === 0) { zeroAmount++; continue; }
    const debit  = '1200';
    const credit = ['food','beverage'].includes(fc.charge_type) ? '4100' : '4000';
    const r = await createBatch({
      origin_table: 'folio_charges', origin_id: fc.id,
      description: `Historical folio charge migration — ${fc.description || fc.charge_type}`,
      debit_gl_account: debit, credit_gl_account: credit, amount,
    });
    if (!r.ok) { console.error(`  ✗ folio_charges/${fc.id}: ${r.error}`); failed++; }
    else if (!r.created) { process.stdout.write(`  ~ folio_charges/${fc.id} (already existed)\n`); skipped++; }
    else { process.stdout.write(`  ✔ folio_charges/${fc.id}  DR ${debit} CR ${credit}  $${amount.toFixed(2)}\n`); created++; }
  }

  console.log('\nScanning inv_stock_ledger GRN...');
  const grnRows = await apiQuery(
    `SELECT sl.id, sl.quantity_change, sl.unit_cost, sl.reference_number
     FROM inv_stock_ledger sl
     WHERE sl.ledger_type = 'GRN'
       AND NOT EXISTS (
         SELECT 1 FROM gl_pending_batches
         WHERE origin_table = 'inv_stock_ledger' AND origin_id = sl.id
       )`
  );
  console.log(`  Found ${grnRows.length} unlinked receipts`);

  for (const sl of grnRows) {
    const amount = Math.abs(Number(sl.quantity_change || 0)) * Number(sl.unit_cost || 0);
    if (amount === 0) { zeroAmount++; continue; }
    const r = await createBatch({
      origin_table: 'inv_stock_ledger', origin_id: sl.id,
      description: `Historical GRN migration — ${sl.reference_number || sl.id}`,
      debit_gl_account: '1400', credit_gl_account: '2100', amount,
    });
    if (!r.ok) { console.error(`  ✗ inv_stock_ledger/${sl.id}: ${r.error}`); failed++; }
    else if (!r.created) { process.stdout.write(`  ~ inv_stock_ledger/${sl.id} (already existed)\n`); skipped++; }
    else { process.stdout.write(`  ✔ inv_stock_ledger/${sl.id}  DR 1400 CR 2100  $${amount.toFixed(2)}\n`); created++; }
  }

  console.log('\n' + '─'.repeat(40) + ' Migration summary ' + '─'.repeat(3));
  console.log(`  Created                    : ${created}`);
  console.log(`  Skipped (already existed)  : ${skipped}`);
  console.log(`  Zero-amount (skipped)      : ${zeroAmount}`);
  console.log(`  Failed                     : ${failed}`);
  console.log('');
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
