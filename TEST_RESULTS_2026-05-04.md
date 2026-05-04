# Villa Gianni PMS — Browser Dev Test Results
**Date:** 2026-05-04 | **Build:** v0.3.1 · commit 76c25a5
**Env:** http://localhost:8082 (Vite) + http://localhost:3001 (Express) | **DB:** PostgreSQL via Render

---

## EXECUTIVE SUMMARY — 13 Bugs Fixed This Session

| Module | Status | Notes |
|--------|--------|-------|
| Login / Auth | ✅ PASS | Session 5min bug fixed → 8hrs |
| Dashboard | ✅ FIXED | RevPAR $NaN + ADR $0 (string rate) fixed |
| Front Office | ✅ FIXED | Crash + folio list both fixed |
| POS System | ✅ PASS | PIN, stations, shift dialog all work |
| Inventory / GRN | ✅ PASS | All tabs load |
| Night Audit Reports | ✅ FIXED | All historical dates now surfaced |
| Flash Report | ✅ FIXED | Real-time DB data (not stale localStorage) |
| Arrivals & Departures | ✅ FIXED | Now DB-driven |
| Inventory COGS | ✅ FIXED | Now reads inventory_periods from DB |
| High Balance Report | ✅ FIXED | Now reads DB folios + city_ledger_accounts |
| Server batch-reconcile | ✅ FIXED | Syntax error (duplicate code block) |

---

## BUG DETAILS & FIXES

### CRITICAL-1: Session expiry 5 minutes
- **File:** `src/lib/authService.ts`
- **Bug:** `createSession()` defaulted to `minutes = 5`. Users logged out every 5 minutes during idle.
- **Fix:** Changed default to `minutes = 480` (8 hours). `touchSession()` now refreshes by 8 hours.

### CRITICAL-2: Server crash (batch-reconcile route)
- **File:** `server/index.cjs`
- **Bug:** Previous route insertion corrupted the `batch-reconcile` route — duplicate code block created an unclosed `try` block. Server wouldn't start.
- **Fix:** Rewrote the for-loop in batch-reconcile to correctly read product, compute variance, upsert snapshot, insert adjustment transaction, and update stock level atomically.

### CRITICAL-3: Folio list always empty
- **File:** `src/components/modules/folio/FolioManagement.tsx`
- **Root Cause:** Folios were built from `guests.filter(guest => guest.roomNumber)`. The `guests` table has NO `room_number` column — it lives on the `reservations` table. Result: every guest had `guest.roomNumber === undefined`, so the filter returned 0 guests → 0 folios shown.
- **Fix:** Now builds folios from `reservations WHERE status = 'checked-in'` (which has `room_number` via JOIN with `rooms`). Also adds a legacy path for guests with folio charges but no reservation. Merges with DB `folios` table for accurate balance and payment method.

### HIGH-1: Dashboard RevPAR = $NaN, ADR = $0
- **File:** `src/components/modules/Dashboard.tsx`
- **Bug:** `currentRevenue` used `r.rate || 0` but `r.rate` from DB is a string (`"80.00"`). The `||` operator returns the truthy string, not a number. `NaN * 0.0538 = NaN` → RevPAR $NaN.
- **Fix:** `Number(r.rate) || 0` forces numeric coercion.

### HIGH-2: FrontOffice crash on render
- **File:** `src/components/modules/FrontOffice.tsx` (multiple lines)
- **Bug:** `(res.rate || 0).toFixed(2)` fails when `res.rate` is a DB string. Same root cause as HIGH-1.
- **Fix:** `(Number(res.rate) || 0).toFixed(2)` — applied via sed across all 4 occurrences.

### HIGH-3: Night Audit shows only most recent date
- **File:** `src/components/modules/NightAudit.tsx`
- **Root Cause:** DB hydration query used `LIMIT 1` — only the most recent audit. Only `corepms_nightAudit_lastReports` was written (overwritten each time). No dated `corepms_nightAudit_reports_YYYY-MM-DD` keys were populated, so `getHistoricalNightAuditBundle(date)` returned null for all but one date.
- **Fix:** Changed to `LIMIT 90`. Now iterates ALL 90 rows and writes each to `corepms_nightAudit_reports_${row.date}`. Stores `corepms_nightAudit_available_dates` list.

### HIGH-4: Flash Report room revenue is stale
- **File:** `src/lib/reporting.ts`
- **Root Cause:** `b?.roomRevenue` came from `corepms_nightAudit_lastReports` localStorage — the value from the last completed audit, which could be days old. Cash/card totals came from `corepms_shift_totals` localStorage (also stale).
- **Fix:** Added two real-time DB queries:
  1. `night_audit_runs WHERE business_date = $1` (if audit ran today, use authoritative room_revenue)
  2. `folio_charges WHERE category IN ('Room',...) AND business_date = $1` (if no audit yet, sum live charges)
  3. `pos_shifts WHERE business_date = $1` for live cash/card totals

### HIGH-5: buildArrivalsDepartures reads empty localStorage
- **File:** `src/lib/reporting.ts`
- **Bug:** Read from `corepms_reservations` localStorage, which is never populated. Always returned empty rows.
- **Fix:** Primary: `SELECT r.*, g.full_name, ro.number FROM reservations r LEFT JOIN guests g ... WHERE check_in_date = $1 OR check_out_date = $1`. localStorage is now a fallback only.

### HIGH-6: buildInventoryCOGS reads localStorage (always 0)
- **File:** `src/lib/reporting.ts`
- **Bug:** Read from `corepms_inventory_opening/ending` localStorage keys that are never populated.
- **Fix:** Primary: queries `inventory_periods WHERE period_year=$1 AND period_month=$2`, returning real opening/closing values, COGS, kitchen COGS, cellar COGS. localStorage fallback retained.

### HIGH-7: buildHighBalance reads empty localStorage
- **File:** `src/lib/reporting.ts`
- **Bug:** Read from `corepms_folios` and `corepms_city_ledger` localStorage — never populated.
- **Fix:** Primary: `SELECT f.*, g.full_name FROM folios f LEFT JOIN guests g WHERE f.balance >= $1` + `city_ledger_accounts WHERE current_balance >= $1`. Also adds Room column to output.

---

## PROD vs DEV DISCREPANCY — NIGHT AUDIT

| | Dev | Prod |
|--|-----|------|
| Dates shown | All available from local DB | 2 dates only |
| Root cause | Local DB has multiple completed audit runs | Production DB has only 2 completed runs |
| Code bug? | No | No |
| Resolution | Working correctly | Run more night audits on prod |

The `/api/night-audit/reports` endpoint already merges filesystem reports (from `server/Night Audit/` dir) with all DB runs (LIMIT 90). As more audits complete on production, they'll appear automatically. The LIMIT 90 change ensures up to 3 months of history is shown.

---

## REMAINING ITEMS (Future Work)

| # | Area | Issue | Priority |
|---|------|-------|----------|
| R1 | Vendor Expenses | Not in DB — only localStorage. Open Bills / Aged Payables always empty | Medium |
| R2 | GL Accounts | Chart of Accounts not synced to DB gl_accounts table | Medium |
| R3 | POS shift start UX | Requires multiple PIN entries in sequence (by design for security, but friction) | Low |
| R4 | Cart persistence | Cart not cleared when new shift starts (cross-shift contamination) | Low |

---

## COMMITS THIS SESSION

| Hash | Message |
|------|---------|
| `66b39a6` | Comprehensive system audit fixes: data persistence, POS, inventory, reporting, Z-reading |
| `76c25a5` | Fix: Night audit all dates, flash report real-time, folio list, reports dynamic data |

**Total changes:** ~13 files, ~2,700 insertions, ~300 deletions across both commits.
