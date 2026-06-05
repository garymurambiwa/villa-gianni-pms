---
name: reporting-engine-overhaul
description: Fix blank reports by routing broken build* functions through new DB-backed API endpoints; retire AllReportsPage table layout in favour of ReportingDashboard dropdown
metadata:
  type: project
---

# Reporting Engine Overhaul — Design Spec

## Problem
Four report types render blank because their `build*` functions in `reporting.ts` read from
`localStorage` keys (`corepms_gl_ledger`, `corepms_city_ledger`) that are empty on fresh
sessions or after a browser clear. The data exists in the DB.

Affected: P&L, Trial Balance, Aged AR, Arrivals & Departures.
Working (already DB-backed): Flash Report, POS Reconciliation, Inventory COGS, Purchase Log.

UI issue: `AllReportsPage.tsx` uses a paginated table with "View / Quick Print" per row —
this is the "cascading" pattern the spec forbids. `ReportingDashboard.tsx` already has the
correct single-`<Select>` dropdown and must become the single entry point.

## Architecture

### Backend — 4 new endpoints in api/handler.js

| Endpoint | Tables | Notes |
|---|---|---|
| `GET /api/reports/trial-balance?from=&to=` | `journal_entries` + `journal_lines` | GROUP BY account_id |
| `GET /api/reports/pl?from=&to=` | `journal_entries` + `journal_lines` | Filter by account category via gl_mappings |
| `GET /api/reports/aged-ar?as_of=` | `folios`, `folio_charges`, `city_ledger_transfers` | Bucket by days-since |
| `GET /api/reports/arrivals-departures?date=` | `reservations` JOIN `rooms` JOIN `guests` | Filter check_in/check_out = date |

All endpoints return `{ ok, columns: string[], rows: object[] }`.

### Frontend — reporting.ts

Rewrite 4 broken `build*` functions to call the new endpoints (DB-first) with localStorage
as offline fallback. Do NOT change the function signatures — callers are unchanged.

- `buildTrialBalance(monthISO)` → `GET /api/reports/trial-balance`
- `buildMonthlyPL(monthISO)` → `GET /api/reports/pl`
- `buildAgedAR(asOf)` → `GET /api/reports/aged-ar`
- `buildArrivalsDepartures(forDate)` → `GET /api/reports/arrivals-departures`

### UI — AllReportsPage.tsx

Replace the paginated table and "View / Quick Print" buttons with a simple redirect /
embed of `ReportingDashboard`. The `AllReportsPage` component becomes a thin wrapper
that renders `<ReportingDashboard />` directly. No cascading menus, no separate tabs.

`ReportingDashboard.tsx` is untouched — it already has the correct `<Select>` dropdown,
date pickers, and export buttons.

## Data Flow

```
User selects report in <Select>
  → load() in ReportingDashboard
  → build*(params) in reporting.ts
  → fetch /api/reports/<type>?params (new endpoints)
  → SQL query on live DB tables
  → { columns, rows } back to component
  → render in ds-table
```

## Error Handling

- API endpoints return `{ ok: false, error: string }` on failure.
- `build*` functions log the error and return an empty `{ title, columns: [], rows: [] }` so
  the table shows "No data for the selected period." rather than crashing.

## Out of Scope

- USALI CoA (Feature B), Inventory Transfers (Feature C), Interactive Stock Sheet (Feature D).
- Rewriting the GL localStorage layer — journal entry posting is separate work.
