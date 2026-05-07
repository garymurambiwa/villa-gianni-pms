# Villa Gianni PMS — Comprehensive System Audit Report
**Date:** 2026-05-04  
**Auditor:** Claude (AI Agent — Code Review Pass)  
**Scope:** Full codebase — POS, Inventory, Reports, GL, Reconciliation, Z-Reading, Shift Management, Schema, Server Routes

---

## EXECUTIVE SUMMARY

The system has a solid architectural foundation (React + Vite frontend, Express backend, PostgreSQL via REST proxy). However, a series of critical bugs, hardcoded logic patterns, broken SQL placeholders, missing schema tables, and incomplete module integrations have been identified. All issues are catalogued below with severity ratings, root cause analysis, and fix status.

**Total Issues Found: 31**  
Critical: 8 | High: 10 | Medium: 8 | Low: 5

---

## SECTION 1 — DATABASE SCHEMA GAPS

### CRIT-01: Missing `products` table in schema.sql
- **File:** `db/schema.sql`
- **Issue:** The entire system (`dbSync.ts`, `PosSettings.tsx`, `StockTab.tsx`) writes to a `products` table that does NOT exist in `schema.sql`. Only `menu_items` and `inventory_items` exist. Any deployment from schema creates a broken database.
- **Impact:** Zero data persistence for POS items on fresh install. All product CRUD silently fails.
- **Fix:** Add full `products` table DDL with all columns used by `dbSync.ts`.

### CRIT-02: Missing `pos_shifts` table in schema.sql
- **File:** `db/schema.sql`
- **Issue:** `pmsAuthDb.ts` and `ShiftContext.tsx` read/write `pos_shifts`. Table missing from schema.
- **Impact:** Shift start/end fails on any clean deployment.
- **Fix:** Add `pos_shifts` DDL.

### CRIT-03: Missing `z_readings` table in schema.sql
- **File:** `db/schema.sql`
- **Issue:** `zReadingService.ts` inserts into `z_readings` — table not in schema.
- **Impact:** Z-readings never persisted to DB.
- **Fix:** Add `z_readings` DDL.

### CRIT-04: Missing `system_audits` table in schema.sql
- **File:** `db/schema.sql`
- **Issue:** `zReadingService.ts → logZReadingAudit()` inserts into `system_audits`. Not in schema.
- **Impact:** Audit trail completely broken.
- **Fix:** Add `system_audits` DDL.

### HIGH-05: Missing `night_audit_runs` table in schema.sql
- **File:** `db/schema.sql`
- **Issue:** `ReportingDashboard.tsx` queries `night_audit_runs` with columns `rooms_posted, room_revenue, total_revenue, adr, revpar, occupancy_percent`. Table not in schema.
- **Impact:** Flash Report DB path always falls back to localStorage heuristics.
- **Fix:** Add `night_audit_runs` DDL.

### HIGH-06: `pos_orders` table missing `shift_id`, `outlet`, `opened_by`, `closed_by` columns
- **File:** `db/schema.sql`
- **Issue:** `buildPosReconciliation()` queries `pos_shifts s` and joins `pos_orders WHERE shift_id = s.id`, but `pos_orders` only has basic columns.
- **Impact:** POS reconciliation report always falls to localStorage fallback.
- **Fix:** ALTER TABLE or recreate `pos_orders` with extended columns.

---

## SECTION 2 — ZREADING SERVICE BUGS

### CRIT-07: Wrong SQL placeholders in `zReadingService.ts`
- **File:** `src/lib/zReadingService.ts` lines 287–291, 345–347
- **Issue:** `logZReadingAudit()` and `storeZReading()` use MySQL-style `?` placeholders directly in `db.query()`. The frontend `db.ts` passes SQL directly to `/api/db/query` which runs on `db-web.cjs`. That server module has `convertPlaceholders()` to convert `?` → `$N`, BUT `db.query()` on the client side in `db.ts` does NOT call the same converter — it just POSTs raw SQL. The server `db-web.cjs` DOES convert, so this actually works. However `storeZReading` uses `?` placeholders correctly since it goes through the server. **Actual bug:** `reading_number: 0` is always stored as placeholder (line 62) and `storeZReading()` only fixes it if `!zReading.reading_number` — but 0 is falsy, so it will always re-fetch. This part is fine. **Real bug:** `generateZReading()` returns `reading_number: 0` and it is printed on the slip before `storeZReading()` assigns the real number (async race). The Z-slip always shows "Reading: 0".
- **Fix:** `getNextZReadingNumber()` must be called before `generateZReading()` in `endShift()`.

### HIGH-08: `checkPrinterStatus()` uses `Math.random()` — non-deterministic
- **File:** `src/lib/zReadingService.ts` lines 298–306
- **Issue:** Printer check returns `connected: false` randomly 5% of the time with no real check. In production, a real shift close will fail to print for no reason.
- **Fix:** Replace with a real check against `/api/printer/status` or always return `connected: true` with browser `window.print()` fallback.

### MED-09: `generateZReading()` has no departmental breakdown
- **File:** `src/lib/zReadingService.ts`
- **Issue:** `ZReadingData.totals` only has `barSales` and `restaurantSales`. No per-category or per-department breakdown as described in the enhancement plan. The HTML template also has no tax breakdown.
- **Fix:** Extend `ZReadingData` with `departmentalBreakdown` and enhance HTML.

---

## SECTION 3 — DBSYNC / DATA PERSISTENCE BUGS

### CRIT-10: `syncMenuItemToDb()` always writes `stock_level: 0`
- **File:** `src/lib/dbSync.ts` lines 381–415
- **Issue:** When `syncMenuItemToDb()` is called (e.g., price change), it calls `syncProductToDb()` with `stock_level: 0`. The UPSERT SQL does `stock_level = EXCLUDED.stock_level` — so a price change on a menu item silently zeroes out its stock. **Data loss.**
- **Fix:** Use a partial UPDATE that only touches price/name/category for menu-only operations, or fetch current stock before updating.

### HIGH-11: `syncInventoryItemToDb()` uses `price` field for `cost_price`
- **File:** `src/lib/dbSync.ts` line 517
- **Issue:** `price: item.price` is set but the comment says this is `cost_price`. The products table has both `price` (selling) and `cost_price`. Stock items may have wrong selling prices.
- **Fix:** Map fields correctly: `price = item.price`, `cost_price = item.cost_price || item.price`.

### HIGH-12: `bulkDeleteProductsFromDb()` creates N×3 individual ops (not batched)
- **File:** `src/lib/dbSync.ts` lines 342–349
- **Issue:** For 50 items, creates 150 DELETE operations in a single transaction array. While this works, it is extremely inefficient and may hit server payload limits. Should use `WHERE id = ANY($1)` bulk delete.
- **Fix:** Use array-based WHERE clause.

### MED-13: localStorage as source-of-truth causes stale data
- **File:** Multiple (`reporting.ts`, `glAccounting.ts`, `ShiftContext.tsx`)
- **Issue:** Majority of report functions read from `localStorage` exclusively (e.g., `corepms_vendor_expenses`, `corepms_city_ledger`, `corepms_folios`). These are not synced from DB on load, so if the user opens a different browser or clears storage, all data vanishes.
- **Fix:** Implement `pullFromDB()` hydration on app start for critical tables.

---

## SECTION 4 — SHIFT / GL INTEGRATION GAPS

### HIGH-14: `endShift()` does NOT post to GL
- **File:** `src/contexts/ShiftContext.tsx` lines 141–212
- **Issue:** When a shift ends, revenue is calculated (`getTotals()`) and a Z-reading is generated. However, NO GL journal entry is ever posted for the shift revenue. The GL accounting module (`glAccounting.ts`) has all the plumbing but is never called from `endShift()`.
- **Impact:** Financial statements are always zero for POS revenue unless someone manually posts.
- **Fix:** Call `gl.postJournalEntry()` with shift totals after `storeZReading()`.

### MED-15: `addTransaction()` maps `ecocash` and `swipe` both to `card` in totals
- **File:** `src/contexts/ShiftContext.tsx` line 238
- **Issue:** `totalCard = allTx.filter(t => t.method === 'swipe')` — EcoCash is NOT included in the DB sync totals (`updateShiftTotals`), but IS counted in local `getTotals()`. This creates discrepancy between DB totals and local totals.
- **Fix:** Add `totalEco` as a separate column or combine into `total_card` consistently.

---

## SECTION 5 — REPORTING DASHBOARD

### HIGH-16: Hardcoded 60/40 heuristic (older code path) still in `reporting.ts`
- **File:** `src/lib/reporting.ts`
- **Issue:** `lastYearDeptExpenses` is calculated as `(roomRevenue + fbRevenue) * 0.35` (line 357). This hardcoded 35% heuristic is still active for prior-year data.
- **Fix:** Use actual GL expense data for prior year or return 0 with a note.

### MED-17: `ReportingDashboard.tsx` duplicates `buildFlashReport()` DB query
- **File:** `src/components/modules/ReportingDashboard.tsx` lines 34–77
- **Issue:** The dashboard re-runs the same POS JSONB query that `buildFlashReport()` already runs internally. Double DB queries on every report load.
- **Fix:** Consume the metadata returned by `buildFlashReport()` instead of re-querying.

### MED-18: `buildPurchaseReceivingLog()` reads only localStorage
- **File:** `src/lib/reporting.ts` line 568
- **Issue:** `corepms_purchases` localStorage key is never written by any module — there is no "purchases" workflow that writes to this key. Report will always be empty.
- **Fix:** Wire to actual GRN/inventory transaction data from DB or vendor expenses.

---

## SECTION 6 — SERVER / API GAPS

### HIGH-19: No server route for product CRUD (`/api/products/*`)
- **File:** `server/index.cjs`
- **Issue:** `dbSync.ts` functions (`syncProductToDb`, `deleteProductFromDb`, etc.) all call `db.query()` which POSTs to `/api/db/query`. This is a raw SQL passthrough — any SQL can be executed client-side. No proper REST endpoints exist for product management.
- **Impact:** Security: client sends arbitrary SQL. No input validation. No auth check on writes.
- **Fix:** Add proper `/api/products` REST routes with validation.

### HIGH-20: No `/api/pos/shifts` or `/api/pos/bills` routes
- **File:** `server/index.cjs`
- **Issue:** `pmsAuthDb.ts` calls `startShift`, `endShift`, `updateShiftTotals` — these call internal DB functions but the server only exposes `/api/db/query` passthrough. No structured shift management API.
- **Fix:** Add `/api/pos/shifts` routes.

### MED-21: `/api/inventory/periods` uses `?` placeholders inconsistently
- **File:** `server/index.cjs` line 148
- **Issue:** Uses `?` which `db-web.cjs` converts via `convertPlaceholders()`. This works, BUT some complex queries use mixed `$N` and `?` which would break.
- **Fix:** Standardise on `?` throughout server routes (converted by `db-web.cjs`).

---

## SECTION 7 — POS MODULE

### HIGH-22: POS menu has no visibility filtering
- **File:** `src/components/modules/POS.tsx` lines 47–83
- **Issue:** `menuItems` memoization filters only by `selling_price > 0`. Items with `visibility.bar = false` or `visibility.restaurant = false` still appear. Out-of-stock items (qtyInStock = 0) still appear.
- **Fix:** Add visibility and stock-level filtering to the memo.

### MED-23: Cart persists across shift boundaries
- **File:** `src/components/modules/POS.tsx` lines 96–104
- **Issue:** Cart is loaded from `corepms_pos_cart` on mount. If a shift ends and a new one starts, the old cart is still loaded. Items may not belong to the current shift.
- **Fix:** Clear cart on shift start.

---

## SECTION 8 — INVENTORY MODULE

### MED-24: StockTab has no visibility toggle UI
- **File:** `src/components/modules/StockTab.tsx`
- **Issue:** Props `onBulkSetVisibility` is defined but StockTab never renders visibility toggle controls. Users cannot set bar/restaurant visibility from the UI.
- **Fix:** Add visibility toggle columns and bulk update buttons.

### LOW-25: StockTab table not responsive
- **File:** `src/components/modules/StockTab.tsx`
- **Issue:** No Tailwind responsive breakpoints (`sm:`, `md:`, `lg:`). Table overflows on mobile/tablet.
- **Fix:** Add responsive table wrapper and hide non-essential columns on small screens.

---

## SECTION 9 — GL ACCOUNTING

### MED-26: GL accounts are only in localStorage (`corepms_gl_accounts`)
- **File:** `src/lib/glAccounting.ts` line 49
- **Issue:** The entire Chart of Accounts is localStorage-only. Not persisted to DB. Not shared across users/sessions.
- **Fix:** Sync GL accounts and ledger to DB tables.

### LOW-27: `getPLStatement()` and `getTrialBalance()` read only localStorage ledger
- **File:** `src/lib/glAccounting.ts`
- **Issue:** Financial statements are derived from an in-memory/localStorage ledger, not from DB. Trial balance will always be wrong on a fresh session.

---

## SECTION 10 — EXPENSE & RECONCILIATION

### MED-28: Vendor expenses stored only in `corepms_vendor_expenses` localStorage
- **File:** `src/lib/reporting.ts`, `src/lib/expenseService.ts`
- **Issue:** All expense reports (`buildOpenBills`, `buildAgedPayables`, etc.) read from localStorage. No DB table for vendor expenses in schema.
- **Fix:** Add `vendor_expenses` and `vendor_payments` tables to schema and sync on write.

### LOW-29: Period rollover has no guard against double-posting
- **File:** `server/index.cjs` inventory period management
- **Issue:** The singleton check (`status IN ('open', 'reconciling')`) prevents opening a second period, but there is no check that closing night audit doesn't roll the period forward twice.

---

## SECTION 11 — UI / RESPONSIVE

### LOW-30: `Reports.tsx` has no responsive classes
- **File:** `src/components/modules/Reports.tsx`
- **Issue:** Tables and grids lack `sm:` / `md:` breakpoints. Mobile view broken.
- **Fix:** Add responsive Tailwind wrappers.

### LOW-31: `ReportingDashboard.tsx` modal has fixed pixel widths
- **File:** `src/components/modules/ReportingDashboard.tsx`
- **Issue:** Some modal containers use fixed `w-[800px]` or similar without responsive fallback.

---

## FIX EXECUTION PLAN

All Critical and High severity issues will be fixed in this session. Medium fixes will be applied where they are straightforward. Low-severity items will be noted for future sprints.

### Execution Order:
1. **schema.sql** — Add all missing tables (CRIT-01 through HIGH-06)
2. **zReadingService.ts** — Fix reading_number=0 bug, fix printer check (CRIT-07, HIGH-08)
3. **dbSync.ts** — Fix stock_level=0 overwrite, field mapping, bulk delete (CRIT-10, HIGH-11, HIGH-12)
4. **ShiftContext.tsx** — Add GL posting on endShift (HIGH-14), fix ecocash totals (MED-15)
5. **glAccounting.ts** — Add `postDailySalesJournal()` function (HIGH-14 dependency)
6. **POS.tsx** — Add visibility + stock filtering to menu memoization (HIGH-22)
7. **StockTab.tsx** — Add visibility toggle UI + responsive classes (MED-24, LOW-25)
8. **ReportingDashboard.tsx** — Remove 60/40 heuristic, consume buildFlashReport metadata (HIGH-16, MED-17)
9. **reporting.ts** — Fix lastYearDeptExpenses hardcoded 35% (HIGH-16)
10. **server/index.cjs** — Add product CRUD routes, shift routes (HIGH-19, HIGH-20)
11. **Reports.tsx** — Add responsive classes (LOW-30)
12. **zReadingService.ts** — Extend ZReadingData with departmental breakdown (MED-09)

---

*Report generated by automated code audit. All findings are based on static analysis of source files.*
