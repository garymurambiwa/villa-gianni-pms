# Stock Take Module — Design Spec

**Date:** 2026-06-06  
**Status:** Approved

---

## Overview

A **Stock Take** tab inside InventoryHub that lets staff generate a pre-filled count sheet per location/period, enter physical counts row-by-row, record manual wastage adjustments, and lock the period — triggering a GL pending batch for net variance.

---

## Entry Point

Standalone **"Stock Take"** tab inside InventoryHub (alongside Items, GRN, Transfers, Reports). No changes to the Month-End Closing Report.

---

## Workflow

```
Generate Sheet → Input Physical Counts (+ optional Adjust) → Lock Period
```

1. **Generate**: Staff selects location + period (month picker). POST to `/stock-take/generate` creates a `draft` sheet with all lines pre-filled from ledger. Idempotent — returns existing draft if one already exists.
2. **Count**: Staff enter physical quantities row by row. Each PATCH saves immediately. Variance auto-computes (`physical - theoretical`).
3. **Adjust** (optional): For known wastage (breakage, spillage), staff open a modal, enter qty + reason. Writes a `WASTAGE` ledger entry immediately and increments `adjustments_qty` on the line.
4. **Lock**: Only enabled when all `physical_qty` cells are filled. Confirmation dialog. On confirm: inserts `inv_variance_reports` + lines, creates `gl_pending_batches` entry for net shrinkage/surplus, sets sheet `status = 'locked'`.

---

## Database Schema

### `inv_stock_take_sheets`

```sql
CREATE TABLE inv_stock_take_sheets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     TEXT NOT NULL,  -- matches location_id TEXT used in inv_stock_ledger
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked')),
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  locked_by       TEXT,
  UNIQUE (location_id, period_start, period_end)
);
```

### `inv_stock_take_lines`

```sql
CREATE TABLE inv_stock_take_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id              UUID NOT NULL REFERENCES inv_stock_take_sheets(id) ON DELETE CASCADE,
  item_id               UUID NOT NULL REFERENCES inv_items(id),
  opening_qty           NUMERIC(12,4) NOT NULL DEFAULT 0,
  purchases_qty         NUMERIC(12,4) NOT NULL DEFAULT 0,
  transfers_in_qty      NUMERIC(12,4) NOT NULL DEFAULT 0,
  transfers_out_qty     NUMERIC(12,4) NOT NULL DEFAULT 0,
  theoretical_sales_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
  adjustments_qty       NUMERIC(12,4) NOT NULL DEFAULT 0,
  physical_qty          NUMERIC(12,4),           -- NULL until staff enters count
  unit_cost             NUMERIC(12,4) NOT NULL DEFAULT 0,
  -- variance_qty is computed: physical - (opening + purchases + transfers_in - transfers_out - theoretical_sales - adjustments)
  UNIQUE (sheet_id, item_id)
);
```

`variance_qty` is not stored — always computed on read as:  
`physical_qty - (opening_qty + purchases_qty + transfers_in_qty - transfers_out_qty - theoretical_sales_qty - adjustments_qty)`

---

## API Endpoints

All under `/api/v1/inventory/` in `server/routes/inventory-v11.cjs` (mirrored to `api/handler.js`).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/stock-take/generate` | Create draft sheet + pre-fill lines. Idempotent. |
| `GET` | `/stock-take/:id` | Return sheet header + all lines with computed variance. |
| `PATCH` | `/stock-take/lines/:lineId` | Update `physical_qty`. Rejects if sheet locked. |
| `POST` | `/stock-take/:id/adjust` | Write WASTAGE to `inv_stock_ledger`, increment `adjustments_qty`. |
| `POST` | `/stock-take/:id/lock` | Lock sheet, insert variance report + GL batch. |

### Generate — pre-fill logic per item (scoped to `location_id` + period)

- **Opening qty**: `physical_qty` from `inv_variance_lines` of the most recent locked sheet for the same location+item whose `period_end < period_start`. Fallback: cumulative `inv_stock_ledger` balance before `period_start`.
- **Purchases**: SUM of `quantity_change` from `inv_stock_ledger` WHERE `ledger_type = 'GRN'` AND `location_id` AND date in period.
- **Transfers in**: SUM WHERE `ledger_type = 'TRANSFER_IN'` AND date in period.
- **Transfers out**: ABS(SUM) WHERE `ledger_type = 'TRANSFER_OUT'` AND date in period.
- **Theoretical sales**: ABS(SUM) WHERE `ledger_type = 'SALE_DEPLETION'` AND date in period.
- **Unit cost**: Most recent `unit_cost` from `inv_stock_ledger` for that item.

### Lock — GL batch

- Net variance value = SUM over all lines of `variance_qty * unit_cost`
- If net < 0 (shrinkage): DR 5100 (COGS/Shrinkage), CR 1400 (Inventory)
- If net > 0 (surplus): DR 1400 (Inventory), CR 5100
- Insert into `gl_pending_batches` with `origin_table = 'inv_stock_take_sheets'`, `origin_id = sheet.id`
- Also inserts `inv_variance_reports` + `inv_variance_lines` (one per line with non-zero variance) for the existing reporting pipeline.

---

## Frontend

**File:** `src/components/modules/InventoryHub.tsx`

New inline component `StockTake` rendered when the Stock Take tab is active:

### State
- `location` (selected location id)
- `period` (YYYY-MM string → derive period_start/period_end)
- `sheet` (null | sheet object with lines array)
- `generating`, `locking` (loading flags)
- `adjustModal` (null | line object)

### Count Grid columns
Opening · Purchases · Transfers In · Transfers Out · Theo. Sales · Adjustments · **Physical Count** (editable) · Variance

### Visual rules
- Physical Count input: blue border normally, red border when variance ≠ 0
- Row background tinted red when variance < 0
- Variance column: green for 0, red for negative, amber for positive (surplus)
- Lock button: disabled until all `physical_qty` filled; shows count of remaining unfilled cells

### Adjust Modal
Fields: qty (number), reason (text). On submit: POST `/stock-take/:id/adjust` → refresh line in state.

---

## Error Handling

- Generate on already-locked period → 409, UI shows "Period already locked"
- PATCH on locked sheet → 409, UI shows "Sheet is locked"
- Lock with unfilled counts → 400, UI shows which items remain (Lock button pre-disabled anyway)
- Any network error → toast with message

---

## Out of Scope

- Multi-location sheets in a single take
- Partial lock (per-category)
- Mobile-optimised layout
- CSV export
