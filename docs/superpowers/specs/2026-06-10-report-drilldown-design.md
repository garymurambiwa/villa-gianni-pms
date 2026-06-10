# Report Drill-Down — Design Spec

**Date:** 2026-06-10
**Status:** Approved (user delegated design decisions)
**Part of:** Five-point ERP hardening programme — sub-project 4

## Overview
Turn flat report views into click-through grids at the two highest-value points:

1. **Trial Balance → journal lines** (GLAccounting.tsx): clicking a TB row opens an
   inline panel listing every journal line that hit that account inside the report
   range (date, reference, description, debit, credit, totals row). Covers the
   "P&L expense line → underlying GL transactions" requirement since expense
   accounts appear in the TB with the same range.
2. **Stock On Hand → stock card** (InventoryHub.tsx StockReports): clicking an item
   row jumps to the Movement sub-tab pre-scoped to that item + location (last 30
   days up to the as-of date) — the classic In/Out/Balance stock card. A removable
   "Item: X" chip shows and clears the filter.

Both reuse the data sources already in place (`gl.getLedger()` client-side,
`/report/movement` server-side). No new endpoints.

## Out of scope (deliberate)
- Drill-down in printed/PDF report outputs (print stays flat)
- Editing transactions from inside the drill panel (transfer reversal and expense
  forms already cover corrections; sub-projects 1–3)
- Transfer-number click-through from movement rows to the transfer modal (the
  transfer list drill-down from sub-project 2 covers it)
