# Stock Take & Period Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/v1/inventory/close-period` that records physical counts, calculates variance, auto-generates a GL pending batch, and locks the period against back-dated changes.

**Architecture:** ALTER TABLE adds `status`/`locked_at`/`locked_by` to `inventory_periods`. The close-period endpoint runs inside a single pg transaction on `server/routes/inventory-v11.cjs`. It reads theoretical balances from `inv_stock_ledger`, inserts `inv_variance_lines`, creates a `gl_pending_batches` entry for any variance, then locks the period. A `GET /api/v1/inventory/periods` endpoint lists lock state. Frontend: Close Period button added to `InventoryV11VarianceReport.tsx`.

**Tech Stack:** Node.js/Express, PostgreSQL (`pool.connect()` for transactions), React/TypeScript.

---

## File Map

| File | Change |
|------|--------|
| `server/routes/inventory-v11.cjs` | ALTER TABLE migration in init, GET /periods, POST /close-period |
| `src/components/modules/InventoryV11VarianceReport.tsx` | Add Close Period button |

---

### Task 1: ALTER TABLE migration — inventory-v11.cjs init block

**Files:**
- Modify: `server/routes/inventory-v11.cjs` (find the init/setup block near the top that runs `CREATE TABLE IF NOT EXISTS` for inventory tables)

- [ ] **Step 1: Locate the init block**

Search for `CREATE TABLE IF NOT EXISTS inventory_periods` or `ALTER TABLE inventory_periods` in `server/routes/inventory-v11.cjs`.

- [ ] **Step 2: Add column migration**

Add after the existing `inventory_periods` CREATE TABLE (or after any existing ALTER TABLE on that table):

```js
// Period close columns
await pool.query(`ALTER TABLE inventory_periods ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked'))`);
await pool.query(`ALTER TABLE inventory_periods ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ`);
await pool.query(`ALTER TABLE inventory_periods ADD COLUMN IF NOT EXISTS locked_by TEXT`);
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/inventory-v11.cjs
git commit -m "feat: add status/locked_at/locked_by to inventory_periods"
```

---

### Task 2: GET /api/v1/inventory/periods endpoint

**Files:**
- Modify: `server/routes/inventory-v11.cjs` (add new GET route)

- [ ] **Step 1: Add GET /periods route**

Add this route near the other inventory GET routes (before any dynamic `:id` routes to avoid conflicts):

```js
/**
 * GET /api/v1/inventory/periods
 * List all inventory periods with lock status
 */
router.get('/periods', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, location_id, start_date::text, end_date::text, status,
              locked_at, locked_by
       FROM inventory_periods
       ORDER BY start_date DESC`
    );
    res.json({ ok: true, rows: r.rows || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/inventory-v11.cjs
git commit -m "feat: add GET /api/v1/inventory/periods endpoint"
```

---

### Task 3: POST /api/v1/inventory/close-period endpoint

**Files:**
- Modify: `server/routes/inventory-v11.cjs`

This is the core transaction. It must be added BEFORE any `/periods/:id` dynamic route if one exists.

- [ ] **Step 1: Add the close-period route**

```js
/**
 * POST /api/v1/inventory/close-period
 * Record physical counts, calculate variance vs theoretical, lock period, post GL batch for variance.
 *
 * Body: { location_id, period_start, period_end, closed_by, counts: [{item_id, physical_qty, unit_cost}] }
 * Response: { ok, report_id, variance_lines, gl_batch_id, locked_period_id }
 */
router.post('/close-period', async (req, res) => {
  const { location_id, period_start, period_end, closed_by, counts } = req.body || {};
  if (!location_id || !period_start || !period_end || !Array.isArray(counts) || counts.length === 0)
    return res.status(400).json({ ok: false, error: 'location_id, period_start, period_end, counts[] required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Check for existing locked period covering this location/date range
    const lockCheck = await client.query(
      `SELECT id, status FROM inventory_periods
       WHERE location_id = $1
         AND start_date <= $2::date
         AND end_date >= $3::date
       LIMIT 1`,
      [location_id, period_end, period_start]
    );
    if (lockCheck.rows.length && lockCheck.rows[0].status === 'locked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Period already locked — back-dated changes are blocked' });
    }
    const existingPeriodId = lockCheck.rows[0]?.id || null;

    // 2. Generate variance report number
    const countRes = await client.query(`SELECT COUNT(*) FROM inv_variance_reports`);
    const reportNumber = `VAR-${String(Number(countRes.rows[0].count) + 1).padStart(5, '0')}`;

    // 3. Insert variance report header
    const reportInsert = await client.query(
      `INSERT INTO inv_variance_reports (report_number, location_id, period_start, period_end, created_by)
       VALUES ($1, $2, $3::date, $4::date, $5)
       RETURNING id`,
      [reportNumber, location_id, period_start, period_end, closed_by || 'system']
    );
    const reportId = reportInsert.rows[0].id;

    // 4. Per item: calculate theoretical balance, insert variance lines
    let totalVarianceValue = 0;
    let linesInserted = 0;

    for (const count of counts) {
      const { item_id, physical_qty, unit_cost = 0 } = count;
      if (!item_id || physical_qty == null) continue;

      // Theoretical = cumulative stock ledger up to end of period
      const theoreticalRes = await client.query(
        `SELECT COALESCE(SUM(quantity_change), 0)::numeric AS theoretical
         FROM inv_stock_ledger
         WHERE item_id = $1
           AND location_id = $2
           AND inserted_at <= $3::date + interval '1 day'`,
        [item_id, location_id, period_end]
      );
      const theoretical = Number(theoreticalRes.rows[0]?.theoretical || 0);
      const variance_qty = Number(physical_qty) - theoretical;
      const variance_value = variance_qty * Number(unit_cost || 0);
      totalVarianceValue += variance_value;

      await client.query(
        `INSERT INTO inv_variance_lines (report_id, item_id, physical_qty, theoretical_qty, variance_qty, unit_cost, variance_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [reportId, item_id, physical_qty, theoretical, variance_qty, unit_cost, variance_value]
      );
      linesInserted++;
    }

    // 5. GL pending batch for variance (only if non-zero)
    let glBatchId = null;
    const absVariance = Math.abs(totalVarianceValue);
    if (absVariance > 0.005) {
      // Shrinkage (negative): DR 5100 F&B Cost, CR 1400 Inventory
      // Surplus (positive):   DR 1400 Inventory, CR 5100 F&B Cost
      const debitAcct  = totalVarianceValue < 0 ? '5100' : '1400';
      const creditAcct = totalVarianceValue < 0 ? '1400' : '5100';
      const batchRes = await client.query(
        `INSERT INTO gl_pending_batches (origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount)
         VALUES ('inv_variance_reports', $1, $2, $3, $4, $5)
         ON CONFLICT (origin_table, origin_id) DO NOTHING
         RETURNING id`,
        [reportId, `Stock variance ${reportNumber}`, debitAcct, creditAcct, absVariance]
      );
      glBatchId = batchRes.rows[0]?.id || null;
    }

    // 6. Lock or create inventory period
    let lockedPeriodId = existingPeriodId;
    if (existingPeriodId) {
      await client.query(
        `UPDATE inventory_periods SET status='locked', locked_at=NOW(), locked_by=$1 WHERE id=$2`,
        [closed_by || 'system', existingPeriodId]
      );
    } else {
      const periodInsert = await client.query(
        `INSERT INTO inventory_periods (location_id, start_date, end_date, status, locked_at, locked_by)
         VALUES ($1, $2::date, $3::date, 'locked', NOW(), $4)
         RETURNING id`,
        [location_id, period_start, period_end, closed_by || 'system']
      );
      lockedPeriodId = periodInsert.rows[0].id;
    }

    await client.query('COMMIT');
    res.json({ ok: true, report_id: reportId, variance_lines: linesInserted, gl_batch_id: glBatchId, locked_period_id: lockedPeriodId });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/inventory-v11.cjs
git commit -m "feat: add POST /api/v1/inventory/close-period endpoint"
```

---

### Task 4: Close Period button in InventoryV11VarianceReport.tsx

**Files:**
- Modify: `src/components/modules/InventoryV11VarianceReport.tsx` (or wherever the variance report table is rendered inside InventoryHub)

First, find the file:
```bash
find src -name "*Variance*" -o -name "*variance*" | grep -i report
```

- [ ] **Step 1: Add state for close-period**

At the top of the component, add:

```tsx
const [closing, setClosing] = useState(false);
const [periodLocked, setPeriodLocked] = useState(false);
const [closeError, setCloseError] = useState('');
```

- [ ] **Step 2: Add handleClosePeriod function**

The variance report component receives `data` (from `useInventoryData`) and likely has `location_id`, `period_start`, `period_end` as props or derived from `data`. Check the actual prop shape and use whatever fields are available.

```tsx
const handleClosePeriod = async () => {
  setClosing(true);
  setCloseError('');
  try {
    // Build counts from the existing variance rows (item_id, physical_qty, unit_cost from report data)
    const counts = (data.varianceLines || []).map((line: any) => ({
      item_id: line.item_id,
      physical_qty: line.physical_qty,
      unit_cost: line.unit_cost || 0,
    }));

    const r = await fetch('/api/v1/inventory/close-period', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location_id: data.selectedLocation || data.location_id,
        period_start: data.periodStart || data.period_start,
        period_end: data.periodEnd || data.period_end,
        closed_by: 'manager',
        counts,
      }),
    }).then(r => r.json());

    if (!r.ok) {
      if (r.error?.includes('already locked')) setPeriodLocked(true);
      throw new Error(r.error || 'Close period failed');
    }
    setPeriodLocked(true);
  } catch (e) {
    setCloseError(e instanceof Error ? e.message : String(e));
  } finally {
    setClosing(false);
  }
};
```

- [ ] **Step 3: Add Close Period button below variance report table**

After the variance report table `</table>` (or at the end of the JSX), add:

```tsx
<div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
  {periodLocked ? (
    <span style={{ padding: '6px 16px', background: '#dcfce7', color: '#166534',
                   border: '1px solid #86efac', borderRadius: 6, fontWeight: 600 }}>
      🔒 Period LOCKED
    </span>
  ) : (
    <button
      onClick={handleClosePeriod}
      disabled={closing}
      style={{ padding: '8px 20px', background: '#dc2626', color: '#fff',
               border: 'none', borderRadius: 6, cursor: 'pointer',
               opacity: closing ? 0.6 : 1, fontWeight: 600 }}
    >
      {closing ? 'Closing…' : 'Close Period'}
    </button>
  )}
  {closeError && (
    <span style={{ color: '#dc2626', fontSize: 13 }}>{closeError}</span>
  )}
</div>
```

- [ ] **Step 4: Build check**

```bash
npm run build
```
Expected: no TypeScript errors.

- [ ] **Step 5: Commit and push**

```bash
git add src/components/modules/InventoryV11VarianceReport.tsx
git commit -m "feat: add Close Period button to variance report"
git push
```
