# Interactive Inventory Reports Design

**Goal:** Add a Stock On Hand / Movement History report inside the existing `InventoryHub` Reports tab, powered by two new live-DB endpoints.

**Architecture:** Two new routes added to `server/routes/inventory-v11.cjs` (shared router). Frontend: replace the existing `VarianceReports` component rendered at `case 'reports'` with an enhanced `StockReports` component that adds stock-on-hand and movement tabs alongside the existing variance report. No new files for the router — one component file for the UI.

**Tech Stack:** Node.js/Express, PostgreSQL (pool.query), React/TypeScript, Tailwind, shadcn/ui.

---

## New API endpoints

### GET /api/v1/inventory/report/stock-on-hand
Query params: `location_id` (required), `as_of` (optional, defaults to NOW)

SQL:
```sql
SELECT i.id, i.name, i.category,
       COALESCE(SUM(sl.quantity_change), 0) AS balance,
       i.base_uom_id AS uom
FROM public.inv_items i
LEFT JOIN public.inv_stock_ledger sl
  ON sl.item_id = i.id
  AND sl.location_id = $1
  AND sl.inserted_at <= $2::timestamptz
GROUP BY i.id, i.name, i.category, i.base_uom_id
ORDER BY i.category, i.name
```

Response: `{ ok: true, rows: [{id, name, category, balance, uom}], location_id, as_of }`

### GET /api/v1/inventory/report/movement
Query params: `location_id` (required), `from` (YYYY-MM-DD), `to` (YYYY-MM-DD)

SQL:
```sql
SELECT sl.inserted_at::date AS date,
       i.name AS item_name,
       sl.ledger_type,
       sl.reference_number,
       sl.quantity_change,
       sl.base_uom_id AS uom,
       sl.posted_by,
       SUM(sl.quantity_change) OVER (
         PARTITION BY sl.item_id
         ORDER BY sl.inserted_at
         ROWS UNBOUNDED PRECEDING
       ) AS running_balance
FROM public.inv_stock_ledger sl
JOIN public.inv_items i ON i.id = sl.item_id
WHERE sl.location_id = $1
  AND sl.inserted_at >= $2::date
  AND sl.inserted_at < ($3::date + interval '1 day')
ORDER BY sl.inserted_at DESC
```

Response: `{ ok: true, rows: [{date, item_name, ledger_type, reference_number, quantity_change, uom, running_balance}] }`

Both endpoints: validate `location_id` present, return 400 if missing; use `pool.query` (no client needed, read-only).

---

## Frontend: StockReports component

**File:** `src/components/modules/InventoryHub.tsx` — add `StockReports` component (inline in InventoryHub.tsx, same pattern as other tab components). Replace `<VarianceReports data={data} />` with `<StockReports data={data} />`.

`StockReports` contains three sub-tabs:
- **Stock On Hand** — uses `/report/stock-on-hand`
- **Movement** — uses `/report/movement`
- **Variance** — preserves existing `VarianceReports` JSX inline

### Stock On Hand tab
- Filter bar: Location dropdown (from `data.locations`), As Of date (defaults to today)
- "Run Report" button → fetches endpoint
- Table: Item | Category | Balance | UOM
- Rows with balance = 0 shown in gray
- CSV export button (generates `stock-onhand-<location>-<date>.csv`)

### Movement tab
- Filter bar: Location dropdown, From date, To date (defaults: last 7 days)
- "Run Report" button → fetches endpoint
- Table: Date | Item | Type | Reference | Qty Change | Running Balance | Posted By
- Qty Change: red if negative (OUT/ADJUSTMENT), green if positive (IN/GRN)
- CSV export button

### CSV export
Helper function `downloadCSV(filename, rows, columns)` — creates a Blob, triggers `<a download>` click. No external lib.

---

## Routing note
Both new endpoints go in `server/routes/inventory-v11.cjs` only — shared router covers both deployments.
