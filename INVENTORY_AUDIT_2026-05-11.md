# Inventory Module — Full Systems Analysis Report
**Date:** 2026-05-11 | **Analyst:** Claude (Systems Architect) | **Scope:** Villa Gianni + Baradzanwa branches

---

## EXECUTIVE SUMMARY

**22 database tables found** (16 `inv_*` + 6 legacy `inventory_*`). **330 active items.** 8 locations. 18 UOM definitions.
**Critical production blockers: 8 | High severity: 9 | Medium: 7**

---

## SECTION 1 — DATABASE SCHEMA AUDIT

### ✅ Tables Present
| Table | Purpose | Status |
|-------|---------|--------|
| `inv_items` | Item master catalog | ✅ — 22 columns, 330 items |
| `inv_uom_definitions` | Unit of measure definitions | ✅ — 18 UOMs |
| `inv_uom_conversions` | Item-level UOM conversion rules | ✅ — Structure OK |
| `inv_locations` | Storage + outlet locations | ✅ — 8 locations |
| `inv_grn_headers` | GRN header records | ✅ |
| `inv_grn_lines` | GRN line items | ✅ |
| `inv_transfer_headers` | Stock transfer headers | ✅ |
| `inv_transfer_lines` | Stock transfer lines | ✅ |
| `inv_stock_ledger` | Single source of truth for stock | ✅ — Critical table |
| `inv_recipes` | Recipe versions | ✅ |
| `inv_recipe_lines` | Recipe ingredients | ✅ |
| `inv_variance_reports` | Variance report headers | ✅ |
| `inv_variance_lines` | Variance report detail | ✅ |
| `inv_physical_counts` | Physical count sessions | ✅ |
| `inv_physical_count_lines` | Physical count line items | ✅ |

### ❌ CRITICAL: Missing `selling_price` column on `inv_items`
The `inv_items` table has no `selling_price` column. The server `POST /items` inserts `selling_price` into `products` table (via sync) but never stores it on `inv_items`. When reading items back, there is no selling price on the inventory record.
**Impact:** Items lose their selling price on every inv_items edit unless products table is checked.

### ❌ CRITICAL: Schema migration vs server code column mismatch
- Migration `V11_inventory_module.sql` uses `inv_uom_definitions.symbol` and `is_base` 
- Actual DB has `code` and `category` (different schema applied)
- Migration uses `inv_locations.type` 
- Actual DB has `location_type`
**Impact:** If migration is re-run on a clean DB, all inventory routes will fail.

---

## SECTION 2 — LOGIC TEST RESULTS

### ❌ CRITICAL BUG 1: GRN Post handler uses undefined variables
```javascript
// Line 195 in inventory-v11.cjs
['posted', postedBy, new Date(), grnHeaderId]  // postedBy and grnHeaderId are UNDEFINED
// Should be:
['posted', posted_by, new Date(), id]
```
**Impact:** Every GRN post operation will FAIL with "postedBy is not defined" ReferenceError.

### ❌ CRITICAL BUG 2: GRN reconciliation uses MySQL `?` placeholder in PostgreSQL
```javascript
// Line 204
WHERE ? BETWEEN start_date AND end_date  // ? is MySQL syntax — PostgreSQL uses $1
// Also line 231:
SET received_value = COALESCE(received_value,0) + ? WHERE id = ?  // Same bug
```
**Impact:** PostgreSQL rejects these queries — reconciliation period integration completely broken.

### ❌ CRITICAL BUG 3: Transfer frontend sends `reference_note` but backend expects `reference_text`
- `InventoryHub.tsx` StockTransfer sends: `reference_note: reqRef`
- `inventory-v11.cjs` destructures: `const { ..., reference_text, ... } = req.body`
- DB column is `reference_text`
**Impact:** Every transfer will store NULL for reference — no audit trail for transfers.

### ❌ CRITICAL BUG 4: DELETE on items is soft-delete only but no visibility update in products
```javascript
// inventory-v11.cjs line 877:
await pool.query(`UPDATE public.inv_items SET is_active=false WHERE id=$1`, [req.params.id]);
// Missing: deactivate in products table too
```
**Impact:** Deleted items still appear in POS menu even after deletion from Inventory.

### ❌ CRITICAL BUG 5: Transfer approve route missing — frontend calls it
```javascript
// InventoryHub.tsx line 617-619:
const r = await apiPost('/transfer', {...});
if (r.ok) {
  await apiPost(`/transfer/${r.data.id}/approve`, { approved_by: user?.id });
```
**Route check needed — if `/transfer/:id/approve` doesn't exist → 404 on every transfer.**

### ❌ CRITICAL BUG 6: Weighted average cost never updated from GRN
```javascript
// GRN post handler only updates last_cost_price and average_cost
// But weighted_avg_cost (the field the UI displays) is NEVER recalculated
// WAC formula: (existing_qty * existing_wac + received_qty * unit_cost) / (existing_qty + received_qty)
```
**Impact:** `weighted_avg_cost` stays 0 for all items — Recipe costing always shows $0 cost.

### ❌ HIGH BUG 7: No oversell/negative stock guard on transfers
Transfer form shows a warning when `qty > balance` but does NOT block submission.
Backend has no balance validation before posting the transfer.
**Impact:** Stock can go negative — inventory counts become meaningless.

### ❌ HIGH BUG 8: PUT /items/:id uses router.handle() anti-pattern
```javascript
router.put('/items/:id', async (req, res) => {
  req.body.id = req.params.id;
  return router.handle({ ...req, method: 'POST', url: '/items' }, res, () => {});  // BROKEN
});
```
**Impact:** Item edit (PUT) will likely throw "router.handle is not a function" or behave unpredictably.

---

## SECTION 3 — UOM SYSTEM AUDIT

### Current UOM definitions (18):
**Count:** BAG, BOTTLE, BOX, CASE, CRATE, DOZ, DRUM, PKT, POR, UNIT, CAN
**Volume:** LITER, L (DUPLICATE — both map to Litre!), ML, TOT
**Weight:** G, GRAM (DUPLICATE — both map to Gram!), KG

### ❌ HIGH: Duplicate UOM codes
- `uom_liter` (LITER) AND `uom_l` (L) both = Litre → conversion confusion
- `uom_g` (G) AND `uom_gram` (GRAM) both = Gram → ambiguous selection
**Fix:** Merge duplicates, set one as canonical, add FK redirect.

### ❌ MEDIUM: No `is_base` / `symbol` on UOM definitions
Migration spec had `symbol` and `is_base` but actual DB has `code` and `category`. The conversion system needs a base UOM per category to calculate conversions correctly. Without `is_base` flag, the system cannot determine which UOM to use as the base for stock ledger entries.

### ❌ MEDIUM: No CRUD endpoints for UOM management
Users cannot add/edit/delete UOMs from the UI. This means:
- Staff in the field cannot add new UOM types (e.g., "50ml tot", "375ml half bottle")
- No way to configure conversions from UI

### ✅ UOM conversions table exists but underused
Only 1 item (Jameson Whiskey) has conversion rules defined. All 330 other items have NO conversion rules.

---

## SECTION 4 — DESTINATION STORES (LOCATIONS) AUDIT

### Current locations:
| ID | Name | Type |
|----|------|------|
| loc_main_cellar | Main Cellar | Storage |
| loc_dry_goods | Dry Goods Store | Storage |
| loc_freezer | Freezer / Perishables | Storage |
| loc_perishables | Perishables | Storage |
| loc_bar1 | Bar 1 | Outlet |
| loc_kitchen | Kitchen | Outlet |
| loc_restaurant | Restaurant | Outlet |
| loc_room_service | Room Service | Outlet |

### ❌ CRITICAL: No CRUD for locations in InventoryHub or API
- There is only a `GET /locations` endpoint
- No `POST`, `PUT`, `DELETE` endpoints exist
- InventoryHub UI has no "Manage Locations" section
**Impact:** Staff cannot add a new bar, remove a closed store, or rename a location from the UI.

### ❌ HIGH: No cascade/guard on location deletion
If a location were deleted (DB-level), all `inv_grn_headers`, `inv_transfer_headers`, and `inv_stock_ledger` entries that reference it would violate FK constraints → DB crash.
**Fix needed:** Soft-delete only (is_active=false), with active stock balance check before deactivation.

### ❌ MEDIUM: `loc_perishables` AND `loc_freezer` both exist for perishables
Functional redundancy — freezer already implies perishables. Creates confusion when selecting destination.

---

## SECTION 5 — POS SYNC ANALYSIS

### Sync flow: inv_items → products → POS menu
When an item is created/updated in `inv_items`, the server syncs to `products` table:
- `inv_items.category` (Food/Beverage) → `products.department` (Restaurant/Bar)
- `inv_items.sub_category` → `products.category`
- `selling_price` (from form, not stored in inv_items) → `products.price`
- `last_cost_price` → `products.cost_price`

### ❌ HIGH: Selling price not persisted in inv_items
The `selling_price` from the item form is passed to products sync but NOT saved to `inv_items`. On next item load, the selling price shows blank in the Inventory form even though POS shows it correctly.

### ❌ HIGH: 73 inv_items have no corresponding products record
```sql
-- Items in inv_items but not in products (dead items):
SELECT COUNT(*) FROM inv_items i WHERE NOT EXISTS(SELECT 1 FROM products p WHERE p.id=i.id)
```
These items exist in inventory (can receive stock, do transfers) but do NOT appear on POS.

### ❌ MEDIUM: Duplicate items (55+ items with duplicate names)
When staff import the same CSV twice, duplicates are created with different IDs but same names. The unique constraint is on `sku` which is auto-generated from the numeric ID, so duplicate names are allowed.

### ✅ GRN → stock_ledger → POS stock depletion via recipes (design is correct)
The design intent is: GRN adds to stock_ledger → sale of a menu item depletes stock_ledger via recipe quantities. This is the correct FIFO/WAC pattern for a PMS inventory system.

### ❌ HIGH: Sale depletion not wired up
The `SALE_DEPLETION` ledger_type exists in the schema but there is NO code that creates a `SALE_DEPLETION` entry when a POS order is closed. Stock is never automatically depleted by sales.

---

## SECTION 6 — DATA INTEGRITY SUMMARY

| Check | Result | Severity |
|-------|--------|----------|
| Orphaned GRN lines | 0 ✅ | — |
| Orphaned transfer lines | 0 ✅ | — |
| Items with no UOM conversions | 330/330 ❌ | HIGH |
| Duplicate item names | 55+ ❌ | MEDIUM |
| Items with `weighted_avg_cost = 0` | ~320 ❌ | HIGH |
| Items not in products table | ~73 ❌ | HIGH |
| Stock ledger entries | 8 (test only) ❌ | HIGH |
| Negative stock balances | None ✅ | — |

---

## SECTION 7 — FIXES TO IMPLEMENT

1. Fix GRN post handler undefined variable bug (`postedBy` → `posted_by`, `grnHeaderId` → `id`)
2. Fix PostgreSQL placeholder bug in GRN reconciliation (`?` → `$N`)
3. Fix transfer `reference_note` vs `reference_text` mismatch
4. Fix item delete to also deactivate in products table
5. Fix PUT /items/:id handler (replace broken router.handle pattern)
6. Implement correct Weighted Average Cost calculation on GRN post
7. Add balance validation to transfer (block submission, not just warn)
8. Add `selling_price` column to `inv_items` table
9. Add full CRUD for UOM definitions and locations
10. Deduplicate UOM records (merge uom_liter+uom_l, uom_gram+uom_g)
11. Add sale depletion trigger for closed POS orders
12. Add location management endpoints (POST, PUT, DELETE with soft-delete guard)
13. Fix schema migration to match actual DB (or vice versa)
