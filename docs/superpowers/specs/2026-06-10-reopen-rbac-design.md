# Super-User Reopen + RBAC — Design Spec

**Date:** 2026-06-10
**Status:** Approved (user delegated design decisions)
**Part of:** Five-point ERP hardening programme — sub-project 1

## Overview

Allow admins to reopen locked stock-take sheets and closed inventory periods, with a
required reason and an immutable audit trail. Non-admins never see the buttons; the
backend independently rejects non-admin calls.

## Endpoints (server/routes/inventory-v11.cjs — mounted by both backends)

### POST /api/v1/inventory/stock-take/:sheetId/reopen
Body: `{ reopened_by, reason }` — `reason` required (400 if blank).
Guard: header `x-user-role` must be `admin` (403 otherwise).
Transaction:
1. 404 if sheet missing; 409 if sheet not locked.
2. Look up `gl_pending_batches` row (`origin_table='inv_stock_take_sheets'`, `origin_id=sheet.id`).
   - If `status='POSTED'` → ROLLBACK, 409 "GL batch already posted — reverse the journal first".
   - If `PENDING` → DELETE it.
3. DELETE `inv_variance_lines` + `inv_variance_reports` matching the sheet's
   `location_id + period_start + period_end` (created at lock).
4. UPDATE sheet: `status='draft'`, `locked_at=NULL`, `locked_by=NULL`.
5. INSERT audit row into `inventory_period_audit`
   (`action='SHEET_REOPENED'`, user, reason, reference to sheet id).

### POST /api/v1/inventory/reopen-period
Body: `{ period_id, reopened_by, reason }` — same guard + required reason.
Sets `inventory_periods.status='open'`, clears `locked_at/locked_by`,
inserts audit row (`action='PERIOD_REOPENED'`).
(Baradzanwa's existing `/api/inventory/reopen` in api/handler.js remains; this gives
the same capability through the shared router path.)

### Audit table
`CREATE TABLE IF NOT EXISTS inventory_period_audit (id, period_id TEXT, action TEXT,
user_id TEXT, user_name TEXT, change_reason TEXT, created_at TIMESTAMPTZ DEFAULT now())`
added to inventory-v11 DDL (both boot branches). No UPDATE/DELETE endpoints — append-only.

## Frontend (src/components/modules/InventoryHub.tsx)

- `StockTake` component: when `sheet.status === 'locked'` AND `user.role === 'admin'`,
  show red **Reopen Sheet** button. Click → `window.prompt` for reason (abort if blank)
  → POST with `x-user-role` header → refresh sheet.
- Periods UI (where Close Period lives): **Reopen** button per locked period, admin
  only, same reason-prompt flow → POST /reopen-period → refresh list.
- `useAuth()` provides `user.role`.

## Error handling
- 403 non-admin, 400 missing reason, 409 not-locked / posted-GL — all surfaced as toasts.

## Out of scope
- Granular permission flags (role string is the existing model)
- Reversing POSTED GL journals (manual accountant action)
