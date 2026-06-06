# Stock Take Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Stock Take tab to InventoryHub that lets staff generate a pre-filled count sheet per location/period, enter physical counts, record wastage adjustments, and lock the period — auto-generating a GL pending batch for net variance.

**Architecture:** Two new PostgreSQL tables (`inv_stock_take_sheets`, `inv_stock_take_lines`) are bootstrapped in `inventory-v11.cjs`'s `ensureInventoryTables` function and mirrored to `api/handler.js`. Five new Express routes are added to `inventory-v11.cjs` only — `api/handler.js` already mounts that router at `/api/v1/inventory/*` so no endpoint duplication is needed. The frontend adds an inline `StockTake` component and `AdjustModal` to `InventoryHub.tsx`.

**Tech Stack:** Node.js/Express (CJS), PostgreSQL via `pool.query` / `pool.connect`, React with hooks, Tailwind CSS.

---

## Codebase Context (read before starting any task)

- **`server/routes/inventory-v11.cjs`** — shared inventory router mounted by both backends. All 5 new routes go here. Uses `pool.query()` for reads and `pool.connect()` → `BEGIN`/`COMMIT`/`ROLLBACK` for multi-statement transactions. Returns `res.json({ ok, ... })`. `pool` is the module-level `pg.Pool`.
- **`api/handler.js`** — Vercel backend. Uses `db.query()` (not `pool`). Mounts the inventory router at line 33. DDL for new tables must also be added here in the `POST /api/gl/accounts/seed` handler (after the `gl_pending_batches` CREATE TABLE at line ~410).
- **`src/components/modules/InventoryHub.tsx`** — All tab components are inline functions in this single large file. `TABS` array at line 2473, `renderTab` switch at line 2501. New tab and component are added here.
- **`inv_stock_ledger` `ledger_type` CHECK**: only `'GRN','TRANSFER_IN','TRANSFER_OUT','SALE_DEPLETION','ADJUSTMENT','WASTE'` are valid. The adjust endpoint must use **`'WASTE'`** (not `'WASTAGE'`).
- **`inv_variance_lines` column names**: Use `report_id` (not `variance_report_id`) to match the existing `/close-period` endpoint pattern.
- **Primary key pattern**: All inventory tables use `TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text`.
- **`inv_variance_reports` `generated_by` column** (not `created_by`) — see DDL at line 363 of inventory-v11.cjs.

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `server/routes/inventory-v11.cjs` | Modify | DDL + 5 new routes |
| `api/handler.js` | Modify | DDL mirror only (routes auto-inherit via router mount) |
| `src/components/modules/InventoryHub.tsx` | Modify | Add Stock Take tab + `StockTake` + `AdjustModal` components |

---

## Task 1: DDL — Add stock-take tables to inventory-v11.cjs

**Files:**
- Modify: `server/routes/inventory-v11.cjs`

- [ ] **Step 1: Locate the insertion point**

Open `server/routes/inventory-v11.cjs`. Find line ~392 — after the two `CREATE INDEX IF NOT EXISTS idx_inv_ledger_*` lines and before `await seedUomDefinitions(client)`. This is inside the `if (check.rows.length > 0)` branch of `ensureInventoryTables`.

- [ ] **Step 2: Add the two CREATE TABLE statements in the "tables exist" branch**

Insert after the last `CREATE INDEX` line (after `idx_inv_ledger_type`), still inside the `if (check.rows.length > 0)` block:

```javascript
      // Stock Take tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_stock_take_sheets (
          id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          location_id   TEXT NOT NULL REFERENCES public.inv_locations(id),
          period_start  DATE NOT NULL,
          period_end    DATE NOT NULL,
          status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked')),
          created_by    TEXT,
          created_at    TIMESTAMPTZ DEFAULT now(),
          locked_at     TIMESTAMPTZ,
          locked_by     TEXT,
          UNIQUE (location_id, period_start, period_end)
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_stock_take_lines (
          id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          sheet_id              TEXT NOT NULL REFERENCES public.inv_stock_take_sheets(id) ON DELETE CASCADE,
          item_id               TEXT NOT NULL REFERENCES public.inv_items(id),
          opening_qty           NUMERIC(12,4) NOT NULL DEFAULT 0,
          purchases_qty         NUMERIC(12,4) NOT NULL DEFAULT 0,
          transfers_in_qty      NUMERIC(12,4) NOT NULL DEFAULT 0,
          transfers_out_qty     NUMERIC(12,4) NOT NULL DEFAULT 0,
          theoretical_sales_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
          adjustments_qty       NUMERIC(12,4) NOT NULL DEFAULT 0,
          physical_qty          NUMERIC(12,4),
          unit_cost             NUMERIC(12,4) NOT NULL DEFAULT 0,
          item_name             TEXT,
          UNIQUE (sheet_id, item_id)
        )`);
```

Note: `item_name` is stored as a convenience — the GET endpoint joins `inv_items` anyway but this avoids JOIN on PATCH responses.

- [ ] **Step 3: Add same tables in the first-boot branch**

In the same file, find the first-boot section (starts ~line 402 with `console.log('[inv-v11] First boot detected...')`). Locate where `inv_variance_lines` is created (~line 376). After that `await client.query(...)` call, add the same two CREATE TABLE blocks (identical SQL, no `IF NOT EXISTS` needed in first boot but it's harmless to include it):

```javascript
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_stock_take_sheets (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        location_id   TEXT NOT NULL REFERENCES public.inv_locations(id),
        period_start  DATE NOT NULL,
        period_end    DATE NOT NULL,
        status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked')),
        created_by    TEXT,
        created_at    TIMESTAMPTZ DEFAULT now(),
        locked_at     TIMESTAMPTZ,
        locked_by     TEXT,
        UNIQUE (location_id, period_start, period_end)
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_stock_take_lines (
        id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        sheet_id              TEXT NOT NULL REFERENCES public.inv_stock_take_sheets(id) ON DELETE CASCADE,
        item_id               TEXT NOT NULL REFERENCES public.inv_items(id),
        opening_qty           NUMERIC(12,4) NOT NULL DEFAULT 0,
        purchases_qty         NUMERIC(12,4) NOT NULL DEFAULT 0,
        transfers_in_qty      NUMERIC(12,4) NOT NULL DEFAULT 0,
        transfers_out_qty     NUMERIC(12,4) NOT NULL DEFAULT 0,
        theoretical_sales_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
        adjustments_qty       NUMERIC(12,4) NOT NULL DEFAULT 0,
        physical_qty          NUMERIC(12,4),
        unit_cost             NUMERIC(12,4) NOT NULL DEFAULT 0,
        item_name             TEXT,
        UNIQUE (sheet_id, item_id)
      )`);
```

- [ ] **Step 4: Verify the file saves without syntax errors**

Run: `node -e "require('./server/routes/inventory-v11.cjs')" 2>&1 | head -5`

Expected: No output or just a pool connection warning. If you see a SyntaxError, fix the bracket/parenthesis mismatch before continuing.

- [ ] **Step 5: Commit**

```bash
git add server/routes/inventory-v11.cjs
git commit -m "feat: add inv_stock_take_sheets + inv_stock_take_lines DDL"
```

---

## Task 2: Mirror DDL to api/handler.js

**Files:**
- Modify: `api/handler.js`

- [ ] **Step 1: Locate the insertion point**

Open `api/handler.js`. Find the `POST /api/gl/accounts/seed` handler (~line 378). Inside it, find the `CREATE INDEX IF NOT EXISTS idx_glpb_origin` line (~line 410) — this is the last DDL statement before the USALI accounts loop.

- [ ] **Step 2: Add the CREATE TABLE statements after the GL pending batches DDL**

Immediately after the `idx_glpb_origin` CREATE INDEX line, add:

```javascript
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_stock_take_sheets (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        location_id   TEXT NOT NULL,
        period_start  DATE NOT NULL,
        period_end    DATE NOT NULL,
        status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked')),
        created_by    TEXT,
        created_at    TIMESTAMPTZ DEFAULT now(),
        locked_at     TIMESTAMPTZ,
        locked_by     TEXT,
        UNIQUE (location_id, period_start, period_end)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_stock_take_lines (
        id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        sheet_id              TEXT NOT NULL REFERENCES inv_stock_take_sheets(id) ON DELETE CASCADE,
        item_id               TEXT NOT NULL,
        opening_qty           NUMERIC(12,4) NOT NULL DEFAULT 0,
        purchases_qty         NUMERIC(12,4) NOT NULL DEFAULT 0,
        transfers_in_qty      NUMERIC(12,4) NOT NULL DEFAULT 0,
        transfers_out_qty     NUMERIC(12,4) NOT NULL DEFAULT 0,
        theoretical_sales_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
        adjustments_qty       NUMERIC(12,4) NOT NULL DEFAULT 0,
        physical_qty          NUMERIC(12,4),
        unit_cost             NUMERIC(12,4) NOT NULL DEFAULT 0,
        item_name             TEXT,
        UNIQUE (sheet_id, item_id)
      )
    `);
```

Note: `api/handler.js` omits the `REFERENCES public.inv_locations(id)` FK on `location_id` and `REFERENCES public.inv_items(id)` on `item_id` — the Baradzanwa DB may not have those tables present. This matches the pattern used elsewhere in handler.js for standalone tables.

- [ ] **Step 3: Verify no syntax errors**

Run: `node -e "require('./api/handler.js')" 2>&1 | head -5`

Expected: No SyntaxError. Connection errors are fine (no DB running locally).

- [ ] **Step 4: Commit**

```bash
git add api/handler.js
git commit -m "feat: mirror stock-take DDL to api/handler.js seed endpoint"
```

---

## Task 3: Five stock-take routes in inventory-v11.cjs

**Files:**
- Modify: `server/routes/inventory-v11.cjs` (add before `module.exports = router` at line 2985)

All five routes go in a new section inserted just before `module.exports = router`. Add the section header and all five route handlers at once.

- [ ] **Step 1: Add the full routes block**

Find `module.exports = router;` at the bottom of `server/routes/inventory-v11.cjs`. Insert the following block immediately before it:

```javascript
// ============================================================================
// STOCK TAKE
// ============================================================================

/**
 * POST /api/v1/inventory/stock-take/generate
 * Body: { location_id, period_start, period_end, created_by? }
 * Idempotent: returns existing draft if one exists. 409 if already locked.
 */
router.post('/stock-take/generate', async (req, res) => {
  const { location_id, period_start, period_end, created_by } = req.body || {};
  if (!location_id || !period_start || !period_end)
    return res.status(400).json({ ok: false, error: 'location_id, period_start, period_end required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotent: return existing sheet if present
    const existing = await client.query(
      `SELECT id, status FROM public.inv_stock_take_sheets
       WHERE location_id = $1 AND period_start = $2::date AND period_end = $3::date`,
      [location_id, period_start, period_end]
    );
    if (existing.rows.length) {
      if (existing.rows[0].status === 'locked') {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'Period already locked' });
      }
      const existingLines = await client.query(
        `SELECT stl.*, i.name AS item_name FROM public.inv_stock_take_lines stl
         JOIN public.inv_items i ON i.id = stl.item_id
         WHERE stl.sheet_id = $1 ORDER BY i.name`,
        [existing.rows[0].id]
      );
      await client.query('ROLLBACK');
      return res.json({ ok: true, sheet: existing.rows[0], lines: existingLines.rows });
    }

    // Create sheet header
    const sheetRes = await client.query(
      `INSERT INTO public.inv_stock_take_sheets (location_id, period_start, period_end, created_by)
       VALUES ($1, $2::date, $3::date, $4) RETURNING *`,
      [location_id, period_start, period_end, created_by || 'system']
    );
    const sheet = sheetRes.rows[0];

    // Get all items that have ANY ledger activity at this location up to period_end,
    // with in-period aggregations computed in one query.
    const itemsRes = await client.query(`
      SELECT
        sl.item_id,
        MAX(i.name) AS item_name,
        COALESCE(SUM(CASE WHEN sl.ledger_type = 'GRN'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END), 0) AS purchases_qty,
        COALESCE(SUM(CASE WHEN sl.ledger_type = 'TRANSFER_IN'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END), 0) AS transfers_in_qty,
        COALESCE(ABS(SUM(CASE WHEN sl.ledger_type = 'TRANSFER_OUT'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END)), 0) AS transfers_out_qty,
        COALESCE(ABS(SUM(CASE WHEN sl.ledger_type = 'SALE_DEPLETION'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END)), 0) AS theoretical_sales_qty,
        (SELECT COALESCE(cost_per_unit, 0)
         FROM public.inv_stock_ledger
         WHERE item_id = sl.item_id AND cost_per_unit IS NOT NULL
         ORDER BY inserted_at DESC LIMIT 1) AS unit_cost
      FROM public.inv_stock_ledger sl
      JOIN public.inv_items i ON i.id = sl.item_id
      WHERE sl.location_id = $1
        AND sl.inserted_at < $3::date + interval '1 day'
      GROUP BY sl.item_id
    `, [location_id, period_start, period_end]);

    const lines = [];
    for (const item of itemsRes.rows) {
      // Opening: physical_qty from the most recent locked sheet for this location+item
      const openingRes = await client.query(`
        SELECT stl.physical_qty
        FROM public.inv_stock_take_lines stl
        JOIN public.inv_stock_take_sheets sts ON sts.id = stl.sheet_id
        WHERE stl.item_id = $1
          AND sts.location_id = $2
          AND sts.status = 'locked'
          AND sts.period_end < $3::date
        ORDER BY sts.period_end DESC
        LIMIT 1
      `, [item.item_id, location_id, period_start]);

      let opening_qty;
      if (openingRes.rows.length) {
        opening_qty = Number(openingRes.rows[0].physical_qty);
      } else {
        // Fallback: cumulative ledger balance before period_start
        const cumRes = await client.query(`
          SELECT COALESCE(SUM(quantity_change), 0) AS balance
          FROM public.inv_stock_ledger
          WHERE item_id = $1 AND location_id = $2 AND inserted_at < $3::date
        `, [item.item_id, location_id, period_start]);
        opening_qty = Number(cumRes.rows[0].balance);
      }

      const lineRes = await client.query(`
        INSERT INTO public.inv_stock_take_lines
          (sheet_id, item_id, item_name, opening_qty, purchases_qty, transfers_in_qty,
           transfers_out_qty, theoretical_sales_qty, unit_cost)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        sheet.id, item.item_id, item.item_name, opening_qty,
        item.purchases_qty, item.transfers_in_qty,
        item.transfers_out_qty, item.theoretical_sales_qty,
        item.unit_cost || 0
      ]);
      lines.push(lineRes.rows[0]);
    }

    await client.query('COMMIT');
    res.json({ ok: true, sheet, lines });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/inventory/stock-take/:sheetId
 * Returns sheet header + all lines with computed variance_qty.
 */
router.get('/stock-take/:sheetId', async (req, res) => {
  try {
    const sheetRes = await pool.query(
      `SELECT * FROM public.inv_stock_take_sheets WHERE id = $1`,
      [req.params.sheetId]
    );
    if (!sheetRes.rows.length)
      return res.status(404).json({ ok: false, error: 'Sheet not found' });

    const linesRes = await pool.query(`
      SELECT stl.*,
        COALESCE(stl.item_name, i.name) AS item_name,
        CASE WHEN stl.physical_qty IS NOT NULL THEN
          stl.physical_qty - (stl.opening_qty + stl.purchases_qty + stl.transfers_in_qty
            - stl.transfers_out_qty - stl.theoretical_sales_qty - stl.adjustments_qty)
        END AS variance_qty
      FROM public.inv_stock_take_lines stl
      JOIN public.inv_items i ON i.id = stl.item_id
      WHERE stl.sheet_id = $1
      ORDER BY COALESCE(stl.item_name, i.name)
    `, [req.params.sheetId]);

    res.json({ ok: true, sheet: sheetRes.rows[0], lines: linesRes.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /api/v1/inventory/stock-take/lines/:lineId
 * Body: { physical_qty }
 * Updates physical count on a single line. Rejects if sheet is locked.
 */
router.patch('/stock-take/lines/:lineId', async (req, res) => {
  const { physical_qty } = req.body || {};
  if (physical_qty == null)
    return res.status(400).json({ ok: false, error: 'physical_qty required' });
  try {
    const checkRes = await pool.query(
      `SELECT sts.status FROM public.inv_stock_take_sheets sts
       JOIN public.inv_stock_take_lines stl ON stl.sheet_id = sts.id
       WHERE stl.id = $1`,
      [req.params.lineId]
    );
    if (!checkRes.rows.length)
      return res.status(404).json({ ok: false, error: 'Line not found' });
    if (checkRes.rows[0].status === 'locked')
      return res.status(409).json({ ok: false, error: 'Sheet is locked' });

    const r = await pool.query(
      `UPDATE public.inv_stock_take_lines SET physical_qty = $1 WHERE id = $2
       RETURNING *,
         physical_qty - (opening_qty + purchases_qty + transfers_in_qty
           - transfers_out_qty - theoretical_sales_qty - adjustments_qty) AS variance_qty`,
      [physical_qty, req.params.lineId]
    );
    res.json({ ok: true, line: r.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/inventory/stock-take/:sheetId/adjust
 * Body: { item_id, qty, reason?, adjusted_by? }
 * Writes a WASTE entry to inv_stock_ledger and increments adjustments_qty on the line.
 */
router.post('/stock-take/:sheetId/adjust', async (req, res) => {
  const { item_id, qty, reason, adjusted_by } = req.body || {};
  if (!item_id || qty == null)
    return res.status(400).json({ ok: false, error: 'item_id and qty required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sheetRes = await client.query(
      `SELECT * FROM public.inv_stock_take_sheets WHERE id = $1`,
      [req.params.sheetId]
    );
    if (!sheetRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Sheet not found' });
    }
    if (sheetRes.rows[0].status === 'locked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Sheet is locked' });
    }
    const sheet = sheetRes.rows[0];

    // Write WASTE ledger entry (negative quantity_change = stock out)
    const ledgerId = `waste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await client.query(
      `INSERT INTO public.inv_stock_ledger
         (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
       VALUES ($1, $2, $3, 'WASTE', $4, $5, 'uom_unit', $6)`,
      [ledgerId, item_id, sheet.location_id,
       `STOCKTAKE-ADJ-${req.params.sheetId}`, -Math.abs(Number(qty)),
       adjusted_by || 'system']
    );

    // Increment adjustments_qty on the line
    const lineRes = await client.query(
      `UPDATE public.inv_stock_take_lines
       SET adjustments_qty = adjustments_qty + $1
       WHERE sheet_id = $2 AND item_id = $3
       RETURNING *,
         CASE WHEN physical_qty IS NOT NULL THEN
           physical_qty - (opening_qty + purchases_qty + transfers_in_qty
             - transfers_out_qty - theoretical_sales_qty - adjustments_qty)
         END AS variance_qty`,
      [Math.abs(Number(qty)), req.params.sheetId, item_id]
    );
    if (!lineRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Line not found for item' });
    }

    await client.query('COMMIT');
    res.json({ ok: true, line: lineRes.rows[0], ledger_id: ledgerId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/inventory/stock-take/:sheetId/lock
 * Body: { locked_by? }
 * Requires all physical_qty filled. Inserts variance report + GL pending batch. Locks sheet.
 */
router.post('/stock-take/:sheetId/lock', async (req, res) => {
  const { locked_by } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sheetRes = await client.query(
      `SELECT * FROM public.inv_stock_take_sheets WHERE id = $1`,
      [req.params.sheetId]
    );
    if (!sheetRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Sheet not found' });
    }
    if (sheetRes.rows[0].status === 'locked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Sheet already locked' });
    }
    const sheet = sheetRes.rows[0];

    const linesRes = await client.query(
      `SELECT * FROM public.inv_stock_take_lines WHERE sheet_id = $1`,
      [req.params.sheetId]
    );
    const lines = linesRes.rows;
    const unfilled = lines.filter(l => l.physical_qty == null);
    if (unfilled.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        ok: false,
        error: `${unfilled.length} item(s) still missing physical count`,
      });
    }

    // Generate variance report number
    const countRes = await client.query(`SELECT COUNT(*) FROM public.inv_variance_reports`);
    const reportNumber = `VAR-${String(Number(countRes.rows[0].count) + 1).padStart(5, '0')}`;

    // Insert variance report header
    const reportRes = await client.query(
      `INSERT INTO public.inv_variance_reports
         (id, report_number, location_id, period_start, period_end, generated_by)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5) RETURNING id`,
      [reportNumber, sheet.location_id, sheet.period_start, sheet.period_end, locked_by || 'system']
    );
    const reportId = reportRes.rows[0].id;

    // Insert variance lines and accumulate net GL value
    let netVarianceValue = 0;
    for (const line of lines) {
      const theoreticalQty = Number(line.opening_qty) + Number(line.purchases_qty)
        + Number(line.transfers_in_qty) - Number(line.transfers_out_qty)
        - Number(line.theoretical_sales_qty) - Number(line.adjustments_qty);
      const varianceQty = Number(line.physical_qty) - theoreticalQty;
      const varianceValue = varianceQty * Number(line.unit_cost);
      netVarianceValue += varianceValue;

      if (Math.abs(varianceQty) < 0.0005) continue; // skip zero-variance lines
      await client.query(
        `INSERT INTO public.inv_variance_lines
           (id, report_id, item_id, physical_qty, theoretical_qty, variance_qty, unit_cost, variance_value)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7)`,
        [reportId, line.item_id, line.physical_qty, theoreticalQty, varianceQty,
         line.unit_cost, varianceValue]
      );
    }

    // GL pending batch for net variance (skip if immaterial)
    let glBatchId = null;
    if (Math.abs(netVarianceValue) > 0.005) {
      const isShrinkage = netVarianceValue < 0;
      const glRes = await client.query(
        `INSERT INTO public.gl_pending_batches
           (origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount)
         VALUES ('inv_stock_take_sheets', $1, $2, $3, $4, $5)
         ON CONFLICT (origin_table, origin_id) DO NOTHING
         RETURNING id`,
        [
          sheet.id,
          `Stock Take ${reportNumber} — ${isShrinkage ? 'shrinkage' : 'surplus'}`,
          isShrinkage ? '5100' : '1400',
          isShrinkage ? '1400' : '5100',
          Math.abs(netVarianceValue),
        ]
      );
      glBatchId = glRes.rows[0]?.id || null;
    }

    // Lock the sheet
    await client.query(
      `UPDATE public.inv_stock_take_sheets
       SET status = 'locked', locked_at = now(), locked_by = $1 WHERE id = $2`,
      [locked_by || 'system', req.params.sheetId]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      report_id: reportId,
      report_number: reportNumber,
      net_variance_value: netVarianceValue,
      gl_batch_id: glBatchId,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node -e "require('./server/routes/inventory-v11.cjs')" 2>&1 | head -5
```

Expected: No SyntaxError.

- [ ] **Step 3: Quick smoke test (optional but recommended)**

If you have a local DB or the dev server running, hit the generate endpoint:

```bash
curl -s -X POST http://localhost:3001/api/v1/inventory/stock-take/generate \
  -H "Content-Type: application/json" \
  -d '{"location_id":"loc_bar","period_start":"2026-05-01","period_end":"2026-05-31"}' | head -c 200
```

Expected: `{"ok":true,"sheet":{...},"lines":[...]}` (lines may be empty if no ledger data).

- [ ] **Step 4: Commit**

```bash
git add server/routes/inventory-v11.cjs
git commit -m "feat: add 5 stock-take API routes to inventory-v11.cjs"
```

---

## Task 4: StockTake tab + component in InventoryHub.tsx

**Files:**
- Modify: `src/components/modules/InventoryHub.tsx`

- [ ] **Step 1: Add 'stock-take' to the TABS array**

Find the `TABS` array at line 2473. Add a new entry after `'uom'`:

```typescript
const TABS = [
  { id: 'items',      label: '📦 Items',       desc: 'Item master & stock codes'       },
  { id: 'suppliers',  label: '🏢 Suppliers',    desc: 'Vendor management'               },
  { id: 'grn',        label: '📥 GRN',          desc: 'Goods received notes'            },
  { id: 'transfer',   label: '🔄 Transfer',     desc: 'Stock transfers'                 },
  { id: 'recipes',    label: '🍽 Recipes',      desc: 'Recipe builder & costing'        },
  { id: 'reports',    label: '📊 Reports',      desc: 'Variance & stock reports'        },
  { id: 'locations',  label: '🏪 Stores',       desc: 'Storage & outlet locations'      },
  { id: 'uom',        label: '⚖ UOM',           desc: 'Units of measure'                },
  { id: 'stock-take', label: '📋 Stock Take',   desc: 'Monthly physical count sheets'   },
] as const;
```

- [ ] **Step 2: Add case 'stock-take' to renderTab**

Find the `renderTab` switch at line 2501. Add a new case:

```typescript
  const renderTab = () => {
    switch (activeTab) {
      case 'items':      return <ItemMaster      data={data} />;
      case 'suppliers':  return <Suppliers       data={data} />;
      case 'grn':        return <GRNModule       data={data} />;
      case 'transfer':   return <StockTransfer   data={data} />;
      case 'recipes':    return <RecipeBuilder   data={data} />;
      case 'reports':    return <StockReports    data={data} />;
      case 'locations':  return <LocationsManager data={data} />;
      case 'uom':        return <UOMManager      data={data} />;
      case 'stock-take': return <StockTake />;
    }
  };
```

- [ ] **Step 3: Add the AdjustModal component**

Find the `InventoryHub` export at line 2485. Insert the following two components BEFORE it (they are standalone functional components, not nested):

```typescript
// ── Adjust Modal ──────────────────────────────────────────────────────────────
const AdjustModal: React.FC<{
  itemName: string;
  onSubmit: (qty: number, reason: string) => void;
  onClose: () => void;
}> = ({ itemName, onSubmit, onClose }) => {
  const [qty, setQty] = React.useState('');
  const [reason, setReason] = React.useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 space-y-4 shadow-xl">
        <h3 className="font-semibold text-lg">Record Adjustment — {itemName}</h3>
        <p className="text-sm text-gray-500">Writes a WASTE entry to the stock ledger immediately.</p>
        <label className="block text-sm font-medium text-gray-700">
          Qty to write off
          <input type="number" step="0.01" min="0" value={qty} onChange={e => setQty(e.target.value)}
            className="mt-1 block w-full border rounded px-3 py-1.5 text-sm" placeholder="e.g. 2.5" />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Reason
          <input type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. breakage, spillage"
            className="mt-1 block w-full border rounded px-3 py-1.5 text-sm" />
        </label>
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose}
            className="text-sm px-4 py-1.5 border rounded hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => { const n = parseFloat(qty); if (!isNaN(n) && n > 0) onSubmit(n, reason); }}
            disabled={!qty || parseFloat(qty) <= 0}
            className="text-sm px-4 py-1.5 bg-amber-600 text-white rounded disabled:opacity-50">
            Record Adjustment
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Add the StockTake component**

Insert the following component immediately after `AdjustModal` and before the `export const InventoryHub` line:

```typescript
// ── Stock Take ────────────────────────────────────────────────────────────────
const StockTake: React.FC = () => {
  const [locations, setLocations] = React.useState<{ id: string; name: string }[]>([]);
  const [locationId, setLocationId] = React.useState('');
  const [period, setPeriod] = React.useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [sheet, setSheet] = React.useState<any>(null);
  const [lines, setLines] = React.useState<any[]>([]);
  const [generating, setGenerating] = React.useState(false);
  const [locking, setLocking] = React.useState(false);
  const [adjustModal, setAdjustModal] = React.useState<any>(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    fetch('/api/v1/inventory/locations')
      .then(r => r.json())
      .then(d => { if (d.ok) setLocations(d.data || []); })
      .catch(() => {});
  }, []);

  const periodStart = `${period}-01`;
  const periodEnd = (() => {
    const [y, m] = period.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
  })();

  const attachVariance = (ls: any[]) =>
    ls.map(l => ({
      ...l,
      variance_qty:
        l.physical_qty != null
          ? Number(l.physical_qty) -
            (Number(l.opening_qty) + Number(l.purchases_qty) + Number(l.transfers_in_qty) -
              Number(l.transfers_out_qty) - Number(l.theoretical_sales_qty) - Number(l.adjustments_qty))
          : null,
    }));

  const handleGenerate = async () => {
    if (!locationId) return setError('Select a location first');
    setGenerating(true);
    setError('');
    try {
      const r = await fetch('/api/v1/inventory/stock-take/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: locationId, period_start: periodStart, period_end: periodEnd }),
      }).then(r => r.json());
      if (!r.ok) return setError(r.error || 'Generate failed');
      setSheet(r.sheet);
      setLines(attachVariance(r.lines));
    } catch {
      setError('Network error');
    } finally {
      setGenerating(false);
    }
  };

  const handlePhysicalQty = async (lineId: string, value: string) => {
    const qty = parseFloat(value);
    if (isNaN(qty)) return;
    try {
      const r = await fetch(`/api/v1/inventory/stock-take/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physical_qty: qty }),
      }).then(r => r.json());
      if (r.ok) setLines(prev => prev.map(l => l.id === lineId ? { ...l, ...r.line } : l));
      else setError(r.error || 'Save failed');
    } catch {
      setError('Network error');
    }
  };

  const handleLock = async () => {
    if (!window.confirm('Lock this period? Physical counts will be frozen and a GL batch created. This cannot be undone.')) return;
    setLocking(true);
    setError('');
    try {
      const r = await fetch(`/api/v1/inventory/stock-take/${sheet.id}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked_by: 'staff' }),
      }).then(r => r.json());
      if (!r.ok) return setError(r.error || 'Lock failed');
      setSheet((s: any) => ({ ...s, status: 'locked' }));
    } catch {
      setError('Network error');
    } finally {
      setLocking(false);
    }
  };

  const handleAdjust = async (qty: number, reason: string) => {
    if (!adjustModal || !sheet) return;
    try {
      const r = await fetch(`/api/v1/inventory/stock-take/${sheet.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: adjustModal.item_id, qty, reason }),
      }).then(r => r.json());
      if (r.ok) {
        setLines(prev => prev.map(l => l.id === r.line.id ? { ...l, ...r.line } : l));
        setAdjustModal(null);
      } else {
        setError(r.error || 'Adjust failed');
      }
    } catch {
      setError('Network error');
    }
  };

  const locked = sheet?.status === 'locked';
  const unfilledCount = lines.filter(l => l.physical_qty == null).length;

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={locationId} onChange={e => setLocationId(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm">
          <option value="">Select location…</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm" />
        <button onClick={handleGenerate} disabled={generating || !locationId}
          className="bg-indigo-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50">
          {generating ? 'Generating…' : 'Generate Sheet'}
        </button>
        {sheet && (
          <div className="ml-auto flex items-center gap-3">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              locked ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
            }`}>
              {locked ? '🔒 LOCKED' : 'DRAFT'}
            </span>
            {!locked && (
              <button
                onClick={handleLock}
                disabled={locking || unfilledCount > 0}
                title={unfilledCount > 0 ? `${unfilledCount} item(s) still need a count` : 'Lock this period'}
                className="bg-green-700 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50">
                {locking ? 'Locking…' : `Lock Period${unfilledCount > 0 ? ` (${unfilledCount} remaining)` : ''}`}
              </button>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded">{error}</p>}

      {lines.length === 0 && !sheet && (
        <p className="text-gray-400 text-sm">Select a location and period, then click Generate Sheet.</p>
      )}
      {lines.length === 0 && sheet && (
        <p className="text-gray-400 text-sm">No inventory movements found for this location and period.</p>
      )}

      {/* Count grid */}
      {lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Item</th>
                <th className="text-right px-3 py-2.5 font-medium">Opening</th>
                <th className="text-right px-3 py-2.5 font-medium">Purchases</th>
                <th className="text-right px-3 py-2.5 font-medium">Trans. In</th>
                <th className="text-right px-3 py-2.5 font-medium">Trans. Out</th>
                <th className="text-right px-3 py-2.5 font-medium">Theo. Sales</th>
                <th className="text-right px-3 py-2.5 font-medium">Adjustments</th>
                <th className="text-right px-3 py-2.5 font-medium text-indigo-600">Physical Count</th>
                <th className="text-right px-3 py-2.5 font-medium">Variance</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map(line => {
                const v = line.variance_qty as number | null;
                const rowBg = v != null && v < 0 ? 'bg-red-50' : '';
                const varColor =
                  v == null ? 'text-gray-300' :
                  v < 0 ? 'text-red-600 font-semibold' :
                  v > 0 ? 'text-amber-600' :
                  'text-green-600';
                const inputBorder = v != null && v !== 0 ? 'border-red-400 focus:border-red-500' : 'border-indigo-300 focus:border-indigo-500';
                return (
                  <tr key={line.id} className={rowBg}>
                    <td className="px-3 py-2 font-medium text-gray-800">{line.item_name}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.opening_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.purchases_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.transfers_in_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.transfers_out_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.theoretical_sales_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.adjustments_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2">
                      {locked ? (
                        <span className="text-gray-700">{line.physical_qty != null ? Number(line.physical_qty).toFixed(2) : '—'}</span>
                      ) : (
                        <input
                          type="number" step="0.01"
                          defaultValue={line.physical_qty ?? ''}
                          placeholder="—"
                          onBlur={e => { if (e.target.value !== '') handlePhysicalQty(line.id, e.target.value); }}
                          className={`w-20 text-right border rounded px-2 py-1 text-sm outline-none ${inputBorder}`}
                        />
                      )}
                    </td>
                    <td className={`text-right px-3 py-2 ${varColor}`}>
                      {v != null ? v.toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {!locked && line.physical_qty != null && (
                        <button
                          onClick={() => setAdjustModal(line)}
                          className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-0.5 hover:bg-gray-100">
                          Adjust
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer summary */}
          <div className="flex gap-4 px-3 py-2 border-t bg-gray-50 text-xs text-gray-500">
            <span>{lines.length} items</span>
            {unfilledCount > 0 && <span className="text-amber-600">{unfilledCount} not yet counted</span>}
            {lines.some(l => l.variance_qty != null && l.variance_qty < 0) && (
              <span className="ml-auto text-red-600 font-medium">
                Total shrinkage: {lines
                  .filter(l => l.variance_qty != null && l.variance_qty < 0)
                  .reduce((s, l) => s + Math.abs(l.variance_qty) * Number(l.unit_cost), 0)
                  .toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}

      {adjustModal && (
        <AdjustModal
          itemName={adjustModal.item_name}
          onSubmit={handleAdjust}
          onClose={() => setAdjustModal(null)}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors. If you see `Type 'string | number' is not assignable`, the defaultValue for the physical count input may need a cast — change `defaultValue={line.physical_qty ?? ''}` to `defaultValue={line.physical_qty != null ? String(line.physical_qty) : ''}`.

- [ ] **Step 6: Build check**

```bash
npx vite build 2>&1 | tail -10
```

Expected: `✓ built in` with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/modules/InventoryHub.tsx
git commit -m "feat: add Stock Take tab and components to InventoryHub"
```

---

## Task 5: Push and verify

**Files:** None (push + live test)

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Trigger DDL bootstrap on Baradzanwa (Vercel)**

Call the seed endpoint to ensure the new tables exist on the Baradzanwa database:

```bash
curl -s -X POST https://<baradzanwa-url>/api/gl/accounts/seed | python -m json.tool
```

Expected: `{"ok":true,...}` with no errors mentioning `inv_stock_take`.

- [ ] **Step 3: Trigger DDL bootstrap on Villa Gianni (Render)**

```bash
curl -s "https://<villa-gianni-url>/api/v1/inventory/init?key=confirm" | python -m json.tool
```

Expected: `{"ok":true}`.

- [ ] **Step 4: Smoke test generate endpoint on Villa Gianni**

```bash
curl -s -X POST https://<villa-gianni-url>/api/v1/inventory/stock-take/generate \
  -H "Content-Type: application/json" \
  -d '{"location_id":"loc_bar","period_start":"2026-05-01","period_end":"2026-05-31"}' | python -m json.tool
```

Expected: `{"ok":true,"sheet":{...},"lines":[...]}`.

- [ ] **Step 5: Open the app in browser and navigate to InventoryHub → Stock Take**

Verify:
- Tab appears in the nav bar
- Location dropdown loads
- Generate Sheet creates lines
- Physical count inputs save on blur
- Adjust modal opens and writes
- Lock Period is disabled until all counts filled; enables once done

- [ ] **Step 6: Final commit if any hotfixes were needed**

```bash
git add -A && git commit -m "fix: stock take UI tweaks from smoke test"
git push origin main
```

---

## Self-Review Notes

- **Spec coverage check**: Generate ✅, Get ✅, Patch ✅, Adjust ✅, Lock ✅, GL batch on lock ✅, variance report on lock ✅, UI count grid ✅, Adjust modal ✅, Lock button disabled logic ✅, error handling for locked/unfilled ✅.
- **`ledger_type = 'WASTE'`** (not `'WASTAGE'`) — confirmed against DDL CHECK constraint.
- **`item_name TEXT`** column added to `inv_stock_take_lines` — avoids JOIN on every PATCH response.
- **Route ordering**: `PATCH /stock-take/lines/:lineId` uses a different HTTP method from `GET /stock-take/:sheetId` — no ordering conflict. `POST /stock-take/generate` and `POST /stock-take/:sheetId/adjust|lock` differ by path segment count, no conflict.
- **api/handler.js DDL** omits FK references since the Baradzanwa DB may not have `inv_locations`/`inv_items` tables — matches existing handler.js pattern.
