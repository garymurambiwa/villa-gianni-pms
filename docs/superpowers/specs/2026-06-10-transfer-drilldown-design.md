# Transfer Drill-Down + GTN + Reversal — Design Spec

**Date:** 2026-06-10
**Status:** Approved (user delegated design decisions)
**Part of:** Five-point ERP hardening programme — sub-project 2

## Overview
Master-detail drill-down on the Transfers list: click a row → modal with header,
lines, Print GTN, Delete (unposted only), and admin-only Reverse.

## Endpoints (inventory-v11.cjs)
- `GET /transfer/:id` — header (with joined location names) + lines (item name, SKU, UOM codes).
- `POST /transfer/:id/reverse` — admin only (`x-user-role`), required reason. In one
  transaction: negates every `inv_stock_ledger` row written under the transfer number
  (exact mirror, so UOM-converted destination qtys reverse correctly) under reference
  `REV-<transfer_number>`, sets header `status='reversed'` + `reversed_by/at`, audit
  row (`TRANSFER_REVERSED`) in `inventory_period_audit`.
- `DELETE /transfer/:id` — only `pending/draft/rejected/cancelled` (no ledger impact);
  posted transfers get 409 "use Reverse instead".
- Migration: status CHECK extended with `'reversed'`; `reversed_by/reversed_at` columns.

## Edit guardrail decision
Posted (approved) transfers are immutable — correct accounting is reverse + re-enter,
not in-place edit. "Edit" therefore = Reverse (admin) + create a new transfer.

## Frontend (InventoryHub.tsx — Transfers tab)
- Rows clickable → `TransferDetailModal` (new component).
- Modal: header grid, lines table, status badge, actions:
  - **Print GTN** — branded print window (uses `VITE_HOTEL_NAME`), signature lines
    (Issued / Received / Authorised).
  - **Delete** — visible for unposted statuses.
  - **Reverse Transfer** — admin only, reason prompt.
- Filter bar + list badge gain `reversed` status (red).
