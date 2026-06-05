# Atomic Inventory Transfers Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the dedicated transfer screen so stock actually moves atomically — deductions from source and additions to destination commit together or roll back entirely.

**Architecture:** Add a single `POST /api/v1/inventory/transfer/execute` endpoint to the shared `server/routes/inventory-v11.cjs` router that creates the transfer header + lines AND posts TRANSFER_OUT + TRANSFER_IN ledger entries in one database transaction. Extract the per-line posting logic into a shared helper reused by both `execute` and the existing `/transfer/:id/approve`. Update `InventoryV11Transfer.tsx` to call the new endpoint.

**Tech Stack:** Node.js/Express, PostgreSQL (Neon), `db.query`/`db.transaction` returning `{ok, rows, rowCount}`, React/TypeScript frontend.

---

## Routing note

`server/routes/inventory-v11.cjs` is a shared Express router mounted by BOTH `api/handler.js` (Vercel) and `server/index.cjs` (Render). Adding the endpoint there means it is automatically available on both deployments — no dual-file update needed.

## New endpoint: POST /transfer/execute

**Request body:**
```json
{
  "source_location_id": "uuid",
  "destination_location_id": "uuid",
  "transfer_date": "YYYY-MM-DD",
  "notes": "optional string",
  "created_by": "user-id or 'system'",
  "items": [
    { "item_id": "uuid", "quantity": 5, "unit_cost": 12.50 }
  ]
}
```

**Validation (before transaction):**
- `items` must be a non-empty array
- `source_location_id` and `destination_location_id` must differ
- `quantity` must be > 0 for each line

**Transaction steps (single `db.transaction` call):**
1. Per item: `SELECT pg_advisory_xact_lock(hashtext($item_id || ':' || $source_location_id))` — prevents concurrent oversell
2. Per item: balance check — `SELECT COALESCE(SUM(quantity_change), 0) FROM inv_stock_ledger WHERE item_id=$1 AND location_id=$2` — return 409 if insufficient
3. INSERT `inv_transfer_headers` with `status='approved'`, `source_location_id`, `destination_location_id`
4. Per item: INSERT `inv_transfer_lines`
5. Per item: INSERT `inv_stock_ledger` (TRANSFER_OUT: `quantity_change = -quantity`, `location_id = source`)
6. Per item: INSERT `inv_stock_ledger` (TRANSFER_IN: `quantity_change = +quantity`, `location_id = destination`)
7. Per item: UOM breakdown conversion — if item has sub-units, call existing `syncPosVisibility` helper for destination location (or inline the POS sync query used by approve)

**Response on success:**
```json
{ "ok": true, "transfer_id": "uuid", "lines_moved": 3 }
```

**Response on insufficient stock:**
```json
{ "ok": false, "error": "Insufficient stock for item <id>: need 5, have 2" }
```

## Shared helper: `executeTransferLines`

Extract the per-line transaction operations (steps 1–7 above) into a local function:
```js
function buildTransferOps(items, headerId, sourceLocationId, destLocationId) { ... }
// Returns array of SQL operation objects suitable for db.transaction()
```

Reuse this in:
- New `POST /transfer/execute`
- Existing `POST /transfer/:id/approve` (replace duplicated SQL with the helper)

## Frontend change: InventoryV11Transfer.tsx

Replace the submit handler's `POST /transfer` call with `POST /transfer/execute`. Map existing form state to the new request shape. On success show the existing success toast. No new UI needed.

Current broken flow:
```
POST /transfer  →  pending header created, stock NEVER moves
```

Fixed flow:
```
POST /transfer/execute  →  atomic: header + lines + ledger entries in one tx
```

## Backward compatibility

Keep existing `POST /transfer` (create pending) and `POST /transfer/:id/approve` unchanged. Other callers (e.g. `InventoryHub.tsx` two-step pattern) continue to work.

## Error handling

- Validation errors → 400 with `{ok: false, error: "..."}`
- Insufficient stock → 409 with `{ok: false, error: "Insufficient stock for item X: need N, have M"}`
- DB error → 500 with `{ok: false, error: tx.error}`
- Transaction rolls back automatically on any step failure (db.transaction is all-or-nothing)

## Testing

After implementation, verify via the InventoryV11Transfer dedicated screen:
1. Transfer 1 unit of any item from Location A to Location B
2. Check `inv_stock_ledger` — should see TRANSFER_OUT for source, TRANSFER_IN for destination
3. Check balances on both location pages — source decremented, destination incremented
4. Attempt transfer of more than available — should get error toast, no stock moved
