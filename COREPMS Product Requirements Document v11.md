# COREPMS Product Requirements Document v11

## Advanced Inventory & Menu Engineering Module

**Document Type:** Product Requirements Document (PRD)
**Module Name:** Advanced Inventory & Menu Engineering
**Version:** v11.0
**System:** COREPMS — Villa Gianni Boutique Hotel
**Prepared By:** Manus AI (originally Vhukile Matenda — Finance & Technology Director)
**Date:** April 2026
**Status:** DRAFT — Pending AntiGravity Deployment
**Deployment Constraint:** Local test only. No git commit until full QA pass.

## 1. Executive Summary

COREPMS v11 introduces the Advanced Inventory & Menu Engineering module — a comprehensive, multi-location stock management and recipe costing system built natively into Villa Gianni's Property Management System. This module closes the critical control gap between purchasing, storage, outlet service, and POS revenue reporting.

Without this module, variance between POS-reported sales volumes and physical inventory counts is invisible. A variance of 60 tots of whiskey per week — equivalent to 2 bottles — disappears undetected. This document specifies the full functional, technical, and deployment requirements for this module.

> **BUSINESS CASE:** Every 60-tot weekly variance on Jameson Whiskey (2 bottles @ $180/case) represents approximately $30 in unrecovered cost per week — or $1,560 per year on a single SKU. Across all beverage and food items, untracked variance is a material financial risk.

## 2. Scope & Objectives

### 2.1 In Scope

*   Multi-location inventory hierarchy (Main Cellar, Dry Goods, Freezer, Bar 1, Restaurant)
*   Goods Received Note (GRN) creation, approval, and GL posting
*   Inter-store stock transfers with UOM breakdown at outlet level
*   Hierarchical Unit of Measure (UOM) conversion engine
*   Bill of Materials / Recipe builder and Menu Engineering tools
*   POS-driven inventory depletion with wastage/yield factor
*   Weekly variance report generation and alert system
*   USALI-compliant GL journal entries for all inventory movements
*   AntiGravity multi-agent deployment with local testing and rollback capability

### 2.2 Out of Scope

*   Supplier procurement and purchase order management (future v12)
*   Changes to protected modules: Billing, Front Office, Reservations, Rooms
*   Customer-facing menu display or online ordering
*   Direct integration with external POS platforms (bridge only, not replacement)

### 2.3 Strategic Objectives

1.  Eliminate invisible shrinkage by reconciling POS sales data with physical stock movements weekly.
2.  Enforce USALI cost accounting discipline across all F&B inventory categories.
3.  Enable accurate recipe costing so selling prices reflect true ingredient costs.
4.  Provide management with real-time stock valuations per location at all times.
5.  Deploy with zero disruption to live hotel operations — local test gate enforced.

## 3. Stakeholders & Roles

| Stakeholder             | Role                      | Interest in This Module                               |
| :---------------------- | :------------------------ | :---------------------------------------------------- |
| Vhukile Matenda         | Finance & Technology Director | System owner, cost control oversight, deployment approval |
| F&B Manager             | Operations                | Recipe management, outlet stock levels, variance alerts |
| Bar & Restaurant Staff  | End Users                 | Stock transfer notes, GRN receiving assistance        |
| General Manager         | Oversight                 | Weekly variance summary reports, KPI dashboard        |
| AntiGravity Agents      | Development               | Schema, backend logic, UI — under Main Agent coordination |

## 4. Functional Requirements

### 4.1 Multi-Location Inventory Hierarchy

The system must maintain separate, independently tracked stock balances for each of the following locations:

| Location Type       | Typical Stock Categories             | Transfer Direction       |
| :------------------ | :----------------------------------- | :----------------------- |
| Main Cellar         | Spirits, wines, bulk beverages       | Storage Source only      |
| Dry Goods Store     | Non-perishable food, cleaning supplies | Storage Source only      |
| Freezer / Perishables | Meat, dairy, frozen foods            | Storage Source only      |
| Bar 1               | Broken-down spirits, draft, mixers   | Outlet Destination (from storage) |
| Restaurant          | Portioned food, garnishes, condiments | Outlet Destination (from storage) |

### 4.2 Unit of Measure (UOM) Conversion Engine

The system must support full hierarchical UOM chains. Each inventory item has a base UOM. All stock ledger entries are recorded in base units and converted for display.

> **EXAMPLE:** 1 Case of Jameson = 12 Bottles = 9,000 ml = 360 Tots (25ml). When 2 Bottles transfer to Bar 1 with "Breakdown" flag, the destination records +60 Tots (2 x 30 tots per 750ml bottle).

*   Each item defines a UOM chain with conversion factors stored per hop
*   Breakdown flag on a transfer triggers automatic conversion at the destination UOM
*   GRN receives in bulk UOM (Cases, Crates, Drums); ledger converts to base units
*   Recipe ingredients are defined in preparation UOM (e.g., grams, ml, tots)

### 4.3 Goods Received Note (GRN)

All stock entering the property must be recorded via a GRN. The GRN screen captures supplier, date, destination store, and line items with quantities, bulk UOM, unit cost, and optional expiry date.

*   GRN auto-calculates total line cost and total GRN value
*   On posting, the system writes to the stock ledger (type: GRN) and triggers a GL journal entry
*   GL entry: Debit Inventory Asset Account / Credit Accounts Payable
*   GRN number is auto-generated in format: GRN-[YYYY]-[NNNN]
*   Duplicate GRN posting must be blocked at the database level

### 4.4 Stock Transfer & Breakdown

Stock transfers move inventory between a source location and a destination location. Transfers require approval by an authorised manager before the stock ledger is updated.

*   Transfer creates two ledger entries: TRANSFER_OUT (source, negative) and TRANSFER_IN (destination, positive)
*   If Breakdown is flagged, destination quantity is converted via the UOM engine before posting
*   Current stock balance of the source location is displayed on the transfer line for validation
*   Transfers cannot exceed available source balance — hard block at approval stage
*   Reference field supports free text (e.g., "Restock Bar 1 — Saturday service")

### 4.5 Recipe Builder & Bill of Materials

The Menu Engineering function maps each POS SKU to a set of inventory ingredients with quantities and wastage factors. This is the Bill of Materials (BOM) for each menu item.

| Ingredient             | Qty Required | UOM    | Wastage % | Effective Cost                |
| :--------------------- | :----------- | :----- | :-------- | :---------------------------- |
| Whole Chicken (1/4 portion) | 350          | grams  | 5%        | Auto-calculated from current stock cost |
| Cooking Oil            | 30           | ml     | 2%        | Auto-calculated from current stock cost |
| Coleslaw Mix           | 80           | grams  | 8%        | Auto-calculated from current stock cost |

*   Recipes are versioned — changes create a new version, preserving history for variance accuracy
*   Theoretical cost is computed from current weighted average cost per base unit
*   Recipes support both Food and Beverage categories with separate variance tabs on the dashboard

### 4.6 POS Sale Depletion Logic

On each POS sale event, the system fetches the current recipe for the sold SKU and depletes each ingredient from the relevant outlet location stock.

1.  POS fires a sale event with: SKU, quantity sold, outlet location, timestamp
2.  System retrieves the active recipe (is_current = true) for the SKU
3.  For each recipe ingredient: actual_qty = qty_required x qty_sold / (1 - wastage_pct / 100)
4.  Actual qty is converted to base units via the UOM engine
5.  Stock ledger is decremented: type = SALE_DEPLETION at the outlet location
6.  If outlet balance is insufficient, a warning is logged but the sale is NOT blocked

> **WARNING:** Insufficient stock at outlet does not block POS sales. It flags a management alert and creates a negative balance entry, which is resolved by the next transfer or physical count adjustment.

### 4.7 Variance Report

The Variance Report is the financial control centrepiece of this module. It reconciles theoretical depletion (derived from POS sales x recipe) against actual depletion (physical count changes or direct ledger movements).

| Alert Level | Variance Threshold | Visual Indicator | Action Required             |
| :---------- | :----------------- | :--------------- | :-------------------------- |
| OK          | Variance < 2%      | Green badge      | None — within tolerance     |
| WARNING     | Variance 2% to 5%  | Amber badge      | F&B Manager review          |
| CRITICAL    | Variance > 5%      | Red badge        | GM sign-off + investigation |

*   Report is generated automatically every Monday at 06:00 via scheduled cron job per location
*   Users can also manually generate for any custom date range and location
*   Export to PDF is available from the report viewer screen
*   Columns: Item | UOM | POS Theoretical Qty | Physical Count | Variance Qty | Variance Value | Variance %

## 5. Technical Architecture

### 5.1 Database Schema Overview

All new tables are namespaced with the `inv_` prefix to prevent collision with existing COREPMS tables. No existing production tables are dropped or structurally altered.

| Table Name            | Purpose                                       | Key Relationships                                   |
| :-------------------- | :-------------------------------------------- | :-------------------------------------------------- |
| `inv_locations`       | Multi-location hierarchy with self-referencing parent | Parent location FK (self)                           |
| `inv_items`           | Inventory item master with wastage yield %    | FK to `uom_definitions` (base UOM)                  |
| `inv_uom_definitions` | Unit of measure master (Case, Bottle, Tot, ml) | Referenced by items, GRN lines, recipe lines        |
| `inv_uom_conversions` | Per-item conversion factors with breakdown flag | FK to items + from/to UOM definitions               |
| `inv_grn_headers`     | GRN master: supplier, date, destination, status | FK to `locations` (destination)                     |
| `inv_grn_lines`       | GRN line items with qty, cost, expiry         | FK to GRN headers, items, UOM                       |
| `inv_transfer_headers` | Transfer note: source, destination, status    | FK to `locations` (source + destination)            |
| `inv_transfer_lines`  | Line items with breakdown flag and UOM        | FK to transfer headers, items, UOM                  |
| `inv_stock_ledger`    | Single source of truth for all stock movements | FK to items, locations, UOM; GL account code        |
| `inv_recipes`         | Recipe versions per menu item                 | FK to `menu_items`; version + is_current flag       |
| `inv_recipe_lines`    | Ingredient lines with qty, UOM, wastage override | FK to recipes and inventory items                   |
| `inv_variance_reports` | Report header: period, location, generated by | FK to `locations`                                   |
| `inv_variance_lines`  | Per-item variance with alert level classification | FK to report headers and inventory items            |

### 5.2 API Endpoint Summary

| Method | Endpoint                                   | Description                                    |
| :----- | :----------------------------------------- | :--------------------------------------------- |
| POST   | `/api/v1/inventory/grn`                    | Create GRN header and lines                    |
| POST   | `/api/v1/inventory/grn/:id/post`           | Post GRN to ledger and trigger GL entry        |
| GET    | `/api/v1/inventory/grn`                    | List GRNs (paginated, filterable)              |
| POST   | `/api/v1/inventory/transfer`               | Create stock transfer note                     |
| POST   | `/api/v1/inventory/transfer/:id/approve`   | Approve and execute transfer                   |
| GET    | `/api/v1/inventory/ledger`                 | Query stock ledger entries                     |
| GET    | `/api/v1/inventory/balance/:location_id`   | Current balances per location                  |
| POST   | `/api/v1/inventory/deplete`                | Manual depletion trigger (testing)             |
| GET    | `/api/v1/inventory/recipe/:menu_item_id`   | Fetch recipe with costing                      |
| POST   | `/api/v1/inventory/recipe`                 | Create or update recipe version                |
| POST   | `/api/v1/inventory/variance/generate`      | Generate variance report                       |
| GET    | `/api/v1/inventory/variance/:report_id`    | Fetch variance report detail                   |

### 5.3 Module Integration Map

This module integrates with existing COREPMS modules using read-only bridges and append-only registrations. No existing module internals are modified.

| Connected Module      | Integration Type | Description                                                              |
| :-------------------- | :--------------- | :----------------------------------------------------------------------- |
| POS Module            | Subscriber       | Listens to `sale_completed` events to trigger ingredient depletion       |
| Accounting / GL       | Caller           | POSTs structured journal entries to existing GL posting endpoint on GRN and transfer |
| Reports Module        | Registry         | Appends Variance Report as a new Report Type — no existing reports modified |
| Billing Module        | None             | No direct integration. Inventory is upstream of billing — no connection needed |
| Front Office / Rooms / Reservations | None             | Protected modules — no integration, no modification                      |

## 6. UI Design Requirements

### 6.1 Color Theme

All UI components must match the existing COREPMS visual language exactly as defined in the system screenshots.

| Element               | Hex Color | Usage                                   |
| :-------------------- | :-------- | :-------------------------------------- |
| Sidebar background    | `#1A2332` | Left navigation panel                   |
| Header / card header  | `#243447` | Page header bar, card title bars        |
| Teal accent           | `#1D9E75` | Primary buttons, active nav, positive variance |
| Page background       | `#F0F4F7` | Content area background                 |
| White card            | `#FFFFFF` | Content cards and panels                |
| Critical alert / red badge | `#E24B4A` | Negative variance, critical stock alerts |
| Warning / amber badge | `#F59E0B` | Warning-level variance alerts           |
| Sidebar text          | `#FFFFFF` | Navigation item text                    |
| Body text             | `#1A2332` | Primary content text                    |
| Muted text            | `#6B7A8D` | Secondary labels and metadata           |

### 6.2 Screen Inventory

*   Inventory Dashboard — KPI cards, critical stock alerts, recent GRNs, recipe cost variance table
*   GRN Screen — New Goods Received Note form with line items grid and total footer
*   Stock Transfer Screen — Source/destination selectors, breakdown toggle, Approve Transfer action
*   Recipe Builder — POS SKU selector, ingredient lines with wastage %, theoretical cost summary
*   Variance Report Viewer — Date range filter, summary bar, detail table with alert badges, PDF export

**Navigation:** The module adds the following items to the existing sidebar below the Dashboard entry:

*   Receiving (GRN)
*   Stock Transfer
*   Menu Engineering
*   Reports (extends existing Reports section)

## 7. AntiGravity Deployment Plan

> **CRITICAL CONSTRAINT:** DO NOT commit to any git branch. Run all tests locally only. Any test failure halts the process. Rollback checkpoint must be generated before any file or database modification.

### 7.1 Agent Assignments

| Agent       | Specialisation    | Primary Deliverables                                                              |
| :---------- | :---------------- | :-------------------------------------------------------------------------------- |
| Agent 1     | Schema & Data     | All `inv_` database tables, migrations, rollback scripts, seed data               |
| Agent 2     | Backend Logic     | GRN service, transfer service, UOM engine, depletion logic, variance calculator, API endpoints |
| Agent 3     | UI / Frontend     | React/Tailwind components for all 5 screens, matching COREPMS color theme         |
| Main Agent  | Consolidation & QA | Integration orchestration, full test suite execution, rollback artefact generation, deployment gate |

### 7.2 Execution Sequence

1.  Main Agent generates rollback checkpoint: DB snapshot + file backup to `/corepms/rollback/v11_pre/`
2.  Agent 1 runs database migrations inside a transaction — auto-rollback on any failure
3.  Agent 2 deploys backend services and passes all unit tests before proceeding
4.  Agent 3 builds UI components and confirms build compiles without errors
5.  Main Agent runs the full integration test suite (6 tests — see Section 7.3)
6.  If any test fails: STOP. Print failure report. Do not commit. Await human review.
7.  If all tests pass: Print "v11 READY FOR REVIEW" with rollback command available

### 7.3 Integration Test Suite

| # | Test Name             | Scenario                                          | Expected Outcome                                  |
| :- | :-------------------- | :------------------------------------------------ | :------------------------------------------------ |
| 1 | Full GRN Flow         | Create GRN: 10 Cases Jameson @ $180 to Main Cellar | Ledger: +120 Bottles Main Cellar; GL entry posted |
| 2 | Transfer + Breakdown  | Transfer 2 Bottles Jameson to Bar 1 with breakdown | Main Cellar -2 Bottles; Bar 1 +60 Tots in ledger  |
| 3 | POS Sale Depletion    | Sell 10 x Quarter Chicken at Restaurant           | Chicken, Oil, Sides depleted per recipe x 10 x wastage |
| 4 | Variance Calculation  | 300 Tots sold via POS; 12 bottles                 | Variance: 60 Tots; Alert Level: CRITICAL          |
