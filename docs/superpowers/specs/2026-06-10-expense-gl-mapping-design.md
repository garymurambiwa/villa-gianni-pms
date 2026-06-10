# Expense Category → GL Account Mapping — Design Spec

**Date:** 2026-06-10
**Status:** Approved (user delegated design decisions)
**Part of:** Five-point ERP hardening programme — sub-project 3

## Overview
Expense capture lines carry an explicit `gl_account_id`. The category dropdown shows
`<account code> — <account name>` for GL-backed options. The double-entry GL posting
(DR mapped expense account / CR Accounts Payable) uses the picked account directly
instead of guessing by department-name substring.

## Changes
- `vendor_expenses` gains `gl_account_id TEXT` (ALTER ... IF NOT EXISTS in the
  DataContext bootstrap DDL).
- `DataContext.addVendorExpense`: INSERT includes `gl_account_id`; the GL ledger
  bridge prefers `expenseData.gl_account_id`, falling back to the legacy heuristic
  (department-name match → any Expense account → '5000') for old callers
  (VendorManagement still posts without an explicit id — heuristic covers it).
- `RecordVendorBill.tsx`: `getCategoriesForDept` returns
  `{value, label, glAccountId}` — GL accounts for the department render as
  `5020 — Beverage Costs`; static labels are matched against the chart by name to
  pick up an id where possible. Submit resolves the chosen option's `glAccountId`
  into the payload.

## Out of scope
- Migrating historic expenses to gl_account_id (heuristic still applies in reports)
- Forcing every static category to have a GL account (graceful: null id → heuristic)
