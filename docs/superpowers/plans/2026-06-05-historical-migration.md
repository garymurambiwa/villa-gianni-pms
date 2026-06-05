# Historical GL Migration Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `scripts/migrate-gl-pending-batches.cjs` — a standalone Node.js script that scans `folio_charges` and `inv_stock_ledger` GRN rows with no matching `gl_pending_batches` entry, then inserts PENDING batch entries for each via the HTTP API.

**Architecture:** Script calls `POST /api/db/query` to scan source tables and `POST /api/gl/pending-batches` to create entries. Idempotent via `ON CONFLICT (origin_table, origin_id) DO NOTHING` on the create endpoint. Accepts `BASE_URL` as `process.argv[2]`. No direct DB access required.

**Tech Stack:** Node.js (CJS, no external deps beyond built-in `https`/`http`). Uses `fetch` (Node 18+) or falls back to `require('node:https')`.

---

## File Map

| File | Change |
|------|--------|
| `scripts/migrate-gl-pending-batches.cjs` | New standalone migration script |

---

### Task 1: Create the migration script

**Files:**
- Create: `scripts/migrate-gl-pending-batches.cjs`

- [ ] **Step 1: Create scripts/ directory if needed**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Write the script**

```js
#!/usr/bin/env node
/**
 * migrate-gl-pending-batches.cjs
 *
 * Scans folio_charges and inv_stock_ledger GRN rows that have no matching
 * gl_pending_batches entry, then inserts PENDING batch entries for each.
 *
 * Usage:
 *   node scripts/migrate-gl-pending-batches.cjs https://villa-gianni-pms.onrender.com
 *   node scripts/migrate-gl-pending-batches.cjs https://<your-project>.vercel.app
 *
 * Safe to re-run: uses ON CONFLICT DO NOTHING on the create endpoint.
 * Never modifies any source row.
 */
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

  let created = 0;
  let skipped = 0;
  let zeroAmount = 0;
  let failed = 0;

  // ── 1. folio_charges ────────────────────────────────────────────────────────
  console.log('\nScanning folio_charges...');
  const folioRows = await apiQuery(
    `SELECT fc.id, fc.charge_type, fc.amount, fc.description, fc.folio_id
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

    // Debit: 1200 in-house guest ledger (1300 for city-ledger would need folio type lookup — use 1200 for all)
    const debit  = '1200';
    const credit = ['food','beverage'].includes(fc.charge_type) ? '4100' : '4000';
    const desc   = `Historical folio charge migration — ${fc.description || fc.charge_type}`;

    const r = await createBatch({
      origin_table: 'folio_charges',
      origin_id: fc.id,
      description: desc,
      debit_gl_account: debit,
      credit_gl_account: credit,
      amount,
    });

    if (!r.ok) {
      console.error(`  ✗ folio_charges/${fc.id}: ${r.error}`);
      failed++;
    } else if (!r.created) {
      process.stdout.write(`  ~ folio_charges/${fc.id} (already existed)\n`);
      skipped++;
    } else {
      process.stdout.write(`  ✔ folio_charges/${fc.id}  DR ${debit} CR ${credit}  $${amount.toFixed(2)}\n`);
      created++;
    }
  }

  // ── 2. inv_stock_ledger GRN receipts ────────────────────────────────────────
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

    const desc = `Historical GRN migration — ${sl.reference_number || sl.id}`;
    const r = await createBatch({
      origin_table: 'inv_stock_ledger',
      origin_id: sl.id,
      description: desc,
      debit_gl_account: '1400',
      credit_gl_account: '2100',
      amount,
    });

    if (!r.ok) {
      console.error(`  ✗ inv_stock_ledger/${sl.id}: ${r.error}`);
      failed++;
    } else if (!r.created) {
      process.stdout.write(`  ~ inv_stock_ledger/${sl.id} (already existed)\n`);
      skipped++;
    } else {
      process.stdout.write(`  ✔ inv_stock_ledger/${sl.id}  DR 1400 CR 2100  $${amount.toFixed(2)}\n`);
      created++;
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(40) + ' Migration summary ' + '─'.repeat(3));
  console.log(`  Created                    : ${created}`);
  console.log(`  Skipped (already existed)  : ${skipped}`);
  console.log(`  Zero-amount (skipped)      : ${zeroAmount}`);
  console.log(`  Failed                     : ${failed}`);
  console.log('');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Mark executable**

```bash
# On Linux/Mac only — skip on Windows
chmod +x scripts/migrate-gl-pending-batches.cjs
```

- [ ] **Step 4: Smoke-test against local server (if running)**

```bash
# Start the dev server first, then:
node scripts/migrate-gl-pending-batches.cjs http://localhost:3001
```

Expected output (first run on empty tables):
```
Migrating GL pending batches via http://localhost:3001
────────────────────────────────────────────────────────────

Scanning folio_charges...
  Found 0 unlinked charges

Scanning inv_stock_ledger GRN...
  Found 0 unlinked receipts

──────────────────────────── Migration summary ───
  Created                    : 0
  Skipped (already existed)  : 0
  Zero-amount (skipped)      : 0
  Failed                     : 0
```

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-gl-pending-batches.cjs
git commit -m "feat: add historical GL pending batches migration script"
git push
```

---

### Task 2: Run against production (manual step, post-deploy)

This is a one-time operational step after the GL pending batches endpoints are deployed.

- [ ] **Step 1: Run against Villa Gianni (Render)**

```bash
node scripts/migrate-gl-pending-batches.cjs https://villa-gianni-pms.onrender.com
```

Review the output. If `Failed: 0`, the migration succeeded.

- [ ] **Step 2: Run against Baradzanwa (Vercel)**

```bash
node scripts/migrate-gl-pending-batches.cjs https://<baradzanwa-project>.vercel.app
```

Both runs are idempotent — re-running produces only `Skipped` rows, no duplicates.
