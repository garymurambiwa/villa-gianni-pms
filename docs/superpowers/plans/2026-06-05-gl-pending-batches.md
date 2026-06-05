# GL Pending Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `gl_pending_batches` holding layer that captures sub-ledger events as unposted journal entries, with API endpoints, three write interceptors, and a frontend management UI.

**Architecture:** Two new DB tables (`gl_account_mappings`, `gl_pending_batches`) created in both backend init blocks. Four REST endpoints in both `api/handler.js` and `server/index.cjs`. Interceptors at GRN approval (inventory-v11.cjs), city-ledger settlement (api/handler.js), and AP invoice creation (src/lib/ap.ts frontend). `PendingBatchesLedger.tsx` component wired into Accounting navigation.

**Tech Stack:** Node.js/Express, PostgreSQL (`db.query` returns `{ok,rows,error}` — never throws), React/TypeScript.

---

## File Map

| File | Change |
|------|--------|
| `api/handler.js` | Add table DDL in init block; add 5 GL pending-batch endpoints |
| `server/index.cjs` | Mirror same DDL + endpoints |
| `server/routes/inventory-v11.cjs` | Add SAVEPOINT-guarded GL batch insert after GRN COMMIT (~line 1114) |
| `src/lib/ap.ts` | Add fire-and-forget `fetch('/api/gl/pending-batches', ...)` inside `createInvoice` |
| `src/components/modules/PendingBatchesLedger.tsx` | New component — table, flush button, per-row Post/Ignore |
| `src/components/AppLayout.tsx` | Add `case 'pending-batches'` |
| `src/components/modules/AccountingDom.tsx` | Add button + case dispatch |

---

### Task 1: DB tables — api/handler.js init block

**Files:**
- Modify: `api/handler.js` (init block near top of file where other `CREATE TABLE IF NOT EXISTS` statements live)

The init block is around line 90+. Find where the existing `gl_accounts` ALTER TABLE runs and add the two new tables after it.

- [ ] **Step 1: Locate the init block**

Search for `CREATE TABLE IF NOT EXISTS gl_journal_entries` or `ALTER TABLE gl_accounts` in `api/handler.js` to find the right location.

- [ ] **Step 2: Add DDL for gl_account_mappings and gl_pending_batches**

Add immediately after the `gl_accounts` DDL block:

```js
// ── GL Pending Batches tables ─────────────────────────────────────────────────
await db.query(`
  CREATE TABLE IF NOT EXISTS gl_account_mappings (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    source_type     TEXT NOT NULL CHECK (source_type IN ('SUPPLIER','CUSTOMER_CREDIT','STOCK_CATEGORY')),
    source_ref_id   TEXT NOT NULL,
    target_gl_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_type, source_ref_id)
  )
`);
await db.query(`
  CREATE TABLE IF NOT EXISTS gl_pending_batches (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    origin_table      TEXT NOT NULL,
    origin_id         TEXT NOT NULL,
    description       TEXT,
    debit_gl_account  TEXT NOT NULL,
    credit_gl_account TEXT NOT NULL,
    amount            NUMERIC(12,2) NOT NULL,
    status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','POSTED','IGNORED')),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    posted_at         TIMESTAMPTZ,
    posted_journal_id TEXT REFERENCES gl_journal_entries(id),
    UNIQUE (origin_table, origin_id)
  )
`);
await db.query(`CREATE INDEX IF NOT EXISTS idx_glpb_status ON gl_pending_batches(status)`);
await db.query(`CREATE INDEX IF NOT EXISTS idx_glpb_origin ON gl_pending_batches(origin_table, origin_id)`);
```

- [ ] **Step 3: Verify server starts without error**

Run: `node api/handler.js` (or start the dev server). Expected: no error about `gl_pending_batches`.

- [ ] **Step 4: Commit**

```bash
git add api/handler.js
git commit -m "feat: add gl_pending_batches DDL to api/handler.js init block"
```

---

### Task 2: GL Pending Batches API endpoints — api/handler.js

**Files:**
- Modify: `api/handler.js` (add 5 endpoints after the existing GL accounts endpoints, around line 460)

- [ ] **Step 1: Add GET /api/gl/pending-batches**

```js
// ── GL Pending Batches ────────────────────────────────────────────────────────
app.get('/api/gl/pending-batches', async (req, res) => {
  const { status } = req.query;
  const st = status || 'PENDING';
  try {
    const r = await db.query(
      `SELECT id, origin_table, origin_id, description, debit_gl_account, credit_gl_account,
              amount, status, created_at
       FROM gl_pending_batches
       WHERE status = $1
       ORDER BY created_at DESC`,
      [st]
    );
    safeJson(res, { ok: true, rows: r.rows || [] });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});
```

- [ ] **Step 2: Add POST /api/gl/pending-batches (create)**

```js
app.post('/api/gl/pending-batches', async (req, res) => {
  const { origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount } = req.body || {};
  if (!origin_table || !origin_id || !debit_gl_account || !credit_gl_account || amount == null)
    return safeJson(res, { ok: false, error: 'origin_table, origin_id, debit_gl_account, credit_gl_account, amount required' });
  try {
    const r = await db.query(
      `INSERT INTO gl_pending_batches (origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (origin_table, origin_id) DO NOTHING
       RETURNING id`,
      [origin_table, origin_id, description || null, debit_gl_account, credit_gl_account, Number(amount)]
    );
    const id = r.rows?.[0]?.id || null;
    safeJson(res, { ok: true, id, created: !!id });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});
```

- [ ] **Step 3: Add PATCH /api/gl/pending-batches/:id**

```js
app.patch('/api/gl/pending-batches/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!['POSTED','IGNORED'].includes(status))
    return safeJson(res, { ok: false, error: 'status must be POSTED or IGNORED' });
  try {
    const extra = status === 'POSTED' ? ', posted_at = NOW()' : '';
    const r = await db.query(
      `UPDATE gl_pending_batches SET status=$1${extra} WHERE id=$2 RETURNING id`,
      [status, id]
    );
    if (!r.rows?.length) return safeJson(res, { ok: false, error: 'Not found' });
    safeJson(res, { ok: true });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});
```

- [ ] **Step 4: Add POST /api/gl/pending-batches/flush**

**Important:** This route must be registered BEFORE the `/:id` PATCH to avoid Express matching `flush` as the `:id` parameter.

```js
app.post('/api/gl/pending-batches/flush', async (req, res) => {
  try {
    const pending = await db.query(
      `SELECT * FROM gl_pending_batches WHERE status='PENDING' ORDER BY created_at`
    );
    const rows = pending.rows || [];
    if (!rows.length) return safeJson(res, { ok: true, flushed: 0, errors: [] });

    let flushed = 0;
    const errors = [];

    for (const batch of rows) {
      try {
        const entryId = `GLJE_BATCH_${batch.id}`;
        const ops = [
          {
            sql: `INSERT INTO gl_journal_entries
                    (id, entry_date, business_date, description, source, status,
                     total_debit, total_credit, is_balanced, created_by, posted_by, posted_at, inserted_at)
                  VALUES ($1, NOW()::date, NOW()::date, $2, 'pending_batch', 'posted', $3, $3, true, 'system', 'system', NOW(), NOW())
                  ON CONFLICT (id) DO NOTHING
                  RETURNING id`,
            params: [entryId, batch.description || `Batch ${batch.origin_table}/${batch.origin_id}`, Number(batch.amount)]
          },
          {
            sql: `INSERT INTO gl_journal_lines (id, journal_entry_id, gl_account_id, debit_amount, credit_amount, description, inserted_at)
                  VALUES ($1, $2, $3, $4, 0, $5, NOW())`,
            params: [`${entryId}_DR`, entryId, batch.debit_gl_account, Number(batch.amount), batch.description || null]
          },
          {
            sql: `INSERT INTO gl_journal_lines (id, journal_entry_id, gl_account_id, debit_amount, credit_amount, description, inserted_at)
                  VALUES ($1, $2, $3, 0, $4, $5, NOW())`,
            params: [`${entryId}_CR`, entryId, batch.credit_gl_account, Number(batch.amount), batch.description || null]
          },
          {
            sql: `UPDATE gl_pending_batches SET status='POSTED', posted_at=NOW(), posted_journal_id=$1 WHERE id=$2`,
            params: [entryId, batch.id]
          }
        ];
        const txResult = await db.transaction(ops);
        if (!txResult.ok) throw new Error(txResult.error || 'Transaction failed');
        flushed++;
      } catch (batchErr) {
        errors.push({ id: batch.id, error: batchErr.message });
      }
    }

    safeJson(res, { ok: true, flushed, errors });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});
```

- [ ] **Step 5: Verify GET returns empty array when no rows**

```bash
curl http://localhost:3000/api/gl/pending-batches
```
Expected: `{"ok":true,"rows":[]}`

- [ ] **Step 6: Commit**

```bash
git add api/handler.js
git commit -m "feat: add GL pending-batches API endpoints to api/handler.js"
```

---

### Task 3: Mirror DDL + endpoints in server/index.cjs

**Files:**
- Modify: `server/index.cjs` (find the matching init block and GL section)

The pattern is identical to Task 1+2 but in `server/index.cjs`. In `server/index.cjs` the DB module is `require('./db.cjs')` and routes are registered on `app` the same way.

- [ ] **Step 1: Add DDL to server/index.cjs init block**

Find where `gl_accounts` ALTER TABLE runs in `server/index.cjs` and add the same DDL as Task 1 Step 2.

- [ ] **Step 2: Add the same 5 endpoints to server/index.cjs**

Copy the four endpoint blocks from Task 2 Steps 1–4 verbatim. The only difference: the DB import variable may be `db` or `pool` — check the top of the file and use whatever is used for other GL endpoints.

- [ ] **Step 3: Commit**

```bash
git add server/index.cjs
git commit -m "feat: mirror gl_pending_batches DDL + endpoints in server/index.cjs"
```

---

### Task 4: GRN approval interceptor — inventory-v11.cjs

**Files:**
- Modify: `server/routes/inventory-v11.cjs` (after the COMMIT on line ~1114, before `res.json(...)`)

The existing GRN post handler uses a pg `client` (from `pool.connect()`). After `client.query('COMMIT')` succeeds, insert a `gl_pending_batches` row using a SAVEPOINT so a batch insert failure never blocks the GRN response.

- [ ] **Step 1: Add GL batch insert after COMMIT in /grn/:id/post**

Find the block (around line 1114):
```js
    await client.query('COMMIT');
    res.json({ ok: true, message: `GRN ${grn.grn_number} posted successfully` });
```

Replace with:
```js
    await client.query('COMMIT');

    // ── GL Pending Batch (post-commit, SAVEPOINT-guarded) ──────────────────────
    // totalGrnValue was computed in the period update block above.
    // Re-compute here in case the period block was skipped.
    const glGrnValue = linesRes.rows.reduce((s, l) => s + Number(l.qty_received) * Number(l.unit_cost), 0);
    if (glGrnValue > 0) {
      try {
        await pool.query(
          `INSERT INTO gl_pending_batches (origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount)
           VALUES ('inv_grn_headers', $1, $2, '1400', '2100', $3)
           ON CONFLICT (origin_table, origin_id) DO NOTHING`,
          [id, `GRN ${grn.grn_number} — stock receipt`, glGrnValue]
        );
      } catch (glErr) {
        console.warn('[inv-v11] gl_pending_batches insert skipped for GRN:', glErr.message);
      }
    }

    res.json({ ok: true, message: `GRN ${grn.grn_number} posted successfully` });
```

Note: We use `pool.query` (not `client`) here because the transaction is already committed. `client` is released in the `finally` block below.

- [ ] **Step 2: Commit**

```bash
git add server/routes/inventory-v11.cjs
git commit -m "feat: insert gl_pending_batches on GRN approval"
```

---

### Task 5: AP invoice interceptor — src/lib/ap.ts

**Files:**
- Modify: `src/lib/ap.ts` (inside `createInvoice`, after the `writeJSON` calls)

`createInvoice` is entirely localStorage-backed. After the localStorage write, fire-and-forget a `fetch` to create a pending batch. This is async but we don't await it — the invoice is already saved.

- [ ] **Step 1: Add fire-and-forget GL batch call in createInvoice**

Find in `src/lib/ap.ts` the `createInvoice` function. After the `writeJSON(K_INVOICES, ...)` call, add:

```ts
  // Fire-and-forget GL pending batch — don't await, don't block invoice save
  fetch('/api/gl/pending-batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin_table: 'ap_invoices',
      origin_id: id,
      description: `AP Invoice ${header.invoice_number}`,
      debit_gl_account: '5300',
      credit_gl_account: '2100',
      amount: total,
    }),
  }).catch(() => {/* network failure is non-fatal — invoice already saved */});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ap.ts
git commit -m "feat: fire-and-forget gl_pending_batches on AP invoice create"
```

---

### Task 6: PendingBatchesLedger.tsx component

**Files:**
- Create: `src/components/modules/PendingBatchesLedger.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React, { useEffect, useState } from 'react';

type Status = 'PENDING' | 'POSTED' | 'IGNORED' | 'ALL';

interface Batch {
  id: string;
  origin_table: string;
  origin_id: string;
  description: string;
  debit_gl_account: string;
  credit_gl_account: string;
  amount: number;
  status: string;
  created_at: string;
}

export function PendingBatchesLedger() {
  const [rows, setRows] = useState<Batch[]>([]);
  const [filter, setFilter] = useState<Status>('PENDING');
  const [loading, setLoading] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [toast, setToast] = useState('');

  const load = async (st: Status) => {
    setLoading(true);
    try {
      const url = st === 'ALL' ? '/api/gl/pending-batches?status=PENDING&status=POSTED&status=IGNORED'
                               : `/api/gl/pending-batches?status=${st}`;
      // For ALL, we need a different approach — fetch each status and merge
      if (st === 'ALL') {
        const [p, po, ig] = await Promise.all([
          fetch('/api/gl/pending-batches?status=PENDING').then(r => r.json()),
          fetch('/api/gl/pending-batches?status=POSTED').then(r => r.json()),
          fetch('/api/gl/pending-batches?status=IGNORED').then(r => r.json()),
        ]);
        setRows([...(p.rows||[]), ...(po.rows||[]), ...(ig.rows||[])]);
      } else {
        const r = await fetch(`/api/gl/pending-batches?status=${st}`).then(r => r.json());
        setRows(r.rows || []);
      }
    } catch (e) {
      setToast('Failed to load batches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(filter); }, [filter]);

  const updateStatus = async (id: string, status: 'POSTED' | 'IGNORED') => {
    try {
      const r = await fetch(`/api/gl/pending-batches/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Update failed');
      load(filter);
      setToast(`Batch ${status.toLowerCase()}`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  };

  const flushAll = async () => {
    setFlushing(true);
    try {
      const r = await fetch('/api/gl/pending-batches/flush', { method: 'POST' }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Flush failed');
      setToast(`Flushed ${r.flushed} batch(es)${r.errors?.length ? ` — ${r.errors.length} error(s)` : ''}`);
      load(filter);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setFlushing(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>GL Pending Batches</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['PENDING','POSTED','IGNORED','ALL'] as Status[]).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{ padding: '4px 12px', background: filter === s ? '#2563eb' : '#e5e7eb',
                       color: filter === s ? '#fff' : '#111', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              {s}
            </button>
          ))}
          <button
            onClick={flushAll}
            disabled={flushing || filter !== 'PENDING'}
            style={{ padding: '4px 16px', background: '#16a34a', color: '#fff',
                     border: 'none', borderRadius: 4, cursor: 'pointer', opacity: flushing ? 0.6 : 1 }}
          >
            {flushing ? 'Flushing…' : 'Flush All Pending'}
          </button>
        </div>
      </div>

      {toast && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef9c3', border: '1px solid #ca8a04',
                      borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
          {toast}
          <button onClick={() => setToast('')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>
      )}

      {loading ? <div>Loading…</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              {['Description','Debit Acct','Credit Acct','Amount','Status','Date','Actions'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>No batches</td></tr>
            ) : rows.map(b => (
              <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px' }}>{b.description || `${b.origin_table}/${b.origin_id}`}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{b.debit_gl_account}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{b.credit_gl_account}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>${Number(b.amount).toFixed(2)}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11,
                    background: b.status==='PENDING'?'#fef9c3':b.status==='POSTED'?'#dcfce7':'#f3f4f6',
                    color: b.status==='PENDING'?'#854d0e':b.status==='POSTED'?'#166534':'#374151' }}>
                    {b.status}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>
                  {new Date(b.created_at).toLocaleDateString()}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {b.status === 'PENDING' && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => updateStatus(b.id, 'POSTED')}
                        style={{ padding: '2px 8px', background: '#16a34a', color: '#fff',
                                 border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}>
                        Post
                      </button>
                      <button onClick={() => updateStatus(b.id, 'IGNORED')}
                        style={{ padding: '2px 8px', background: '#6b7280', color: '#fff',
                                 border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}>
                        Ignore
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/modules/PendingBatchesLedger.tsx
git commit -m "feat: add PendingBatchesLedger component"
```

---

### Task 7: Wire PendingBatchesLedger into navigation

**Files:**
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/components/modules/AccountingDom.tsx`

- [ ] **Step 1: Add import and case in AppLayout.tsx**

Find the existing `import { ChartOfAccounts }` line. Add:
```tsx
import { PendingBatchesLedger } from '@/components/modules/PendingBatchesLedger';
```

Find the `case 'chart-of-accounts':` block in the switch. Add after it:
```tsx
case 'pending-batches':
  return <div className="flex-1 overflow-y-auto"><PendingBatchesLedger /></div>;
```

- [ ] **Step 2: Add button in AccountingDom.tsx**

Find the `<button ... data-action="chart-of-accounts"` button. Add after it:
```tsx
<button type="button" data-action="pending-batches" className="acct-btn">📋 Pending GL Batches</button>
```

Find the `case 'chart-of-accounts':` in the switch/dispatch block. Add after it:
```tsx
case 'pending-batches':
  window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'pending-batches' } } as any));
  break;
```

- [ ] **Step 3: Build check**

```bash
npm run build
```
Expected: no TypeScript errors.

- [ ] **Step 4: Commit and push**

```bash
git add src/components/AppLayout.tsx src/components/modules/AccountingDom.tsx
git commit -m "feat: wire PendingBatchesLedger into Accounting navigation"
git push
```
