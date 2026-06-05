# USALI Chart of Accounts Design

**Goal:** Add an `account_number` display column to `gl_accounts`, seed the full USALI account list, and build a Chart of Accounts management UI (add/edit only, no delete).

**Architecture:** One migration/seed endpoint (`POST /api/gl/accounts/seed`) that adds the `account_number` column and upserts all USALI accounts. One CRUD endpoint pair (`GET /api/gl/accounts`, `POST /api/gl/accounts`, `PUT /api/gl/accounts/:id`). Frontend: new `ChartOfAccounts.tsx` component registered in the Accounting module.

**Tech Stack:** Node.js/Express, PostgreSQL, React/TypeScript, Tailwind, shadcn/ui.

---

## Database changes

Add `account_number VARCHAR(20)` column to `gl_accounts` if not present:
```sql
ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS account_number VARCHAR(20);
```

Existing rows have `id` values like `'1100'`, `'4000'` — set `account_number = id` for those on seed.

---

## USALI account seed (40 accounts)

Grouped by category. All inserted via `INSERT ... ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, account_number=EXCLUDED.account_number, category=EXCLUDED.category`.

| id | account_number | name | category |
|----|---------------|------|----------|
| 1000 | 1000 | Cash on Hand | Asset |
| 1050 | 1050 | Petty Cash | Asset |
| 1100 | 1100 | Card/Bank Clearing | Asset |
| 1150 | 1150 | Bank Account | Asset |
| 1180 | 1180 | EcoCash Mobile Money | Asset |
| 1200 | 1200 | In-house Guest Ledger | Asset |
| 1300 | 1300 | City Ledger / Accounts Receivable | Asset |
| 1400 | 1400 | Inventory — Food & Beverage | Asset |
| 1500 | 1500 | Prepaid Expenses | Asset |
| 1600 | 1600 | Property, Plant & Equipment | Asset |
| 1610 | 1610 | Accumulated Depreciation | Asset |
| 2100 | 2100 | Accounts Payable | Liability |
| 2200 | 2200 | Accrued Expenses | Liability |
| 2300 | 2300 | VAT / Sales Tax Payable | Liability |
| 2400 | 2400 | Advance Deposits | Liability |
| 2500 | 2500 | Current Portion Long-term Debt | Liability |
| 3000 | 3000 | Owner's Equity / Capital | Equity |
| 3100 | 3100 | Retained Earnings | Equity |
| 3200 | 3200 | Current Year Earnings | Equity |
| 4000 | 4000 | Rooms Revenue | Revenue |
| 4100 | 4100 | Food & Beverage Revenue | Revenue |
| 4200 | 4200 | Conference / Catering Revenue | Revenue |
| 4300 | 4300 | Spa & Recreation Revenue | Revenue |
| 4400 | 4400 | Telephone & Internet Revenue | Revenue |
| 4500 | 4500 | Other Operated Departments Revenue | Revenue |
| 4600 | 4600 | Miscellaneous Income | Revenue |
| 5000 | 5000 | Rooms Payroll & Related | Expense |
| 5100 | 5100 | Food & Beverage Cost of Sales | Expense |
| 5200 | 5200 | Food & Beverage Payroll | Expense |
| 5300 | 5300 | Administrative & General | Expense |
| 5400 | 5400 | Sales & Marketing | Expense |
| 5500 | 5500 | Property Operations & Maintenance | Expense |
| 5600 | 5600 | Utilities | Expense |
| 5700 | 5700 | Information Technology | Expense |
| 5800 | 5800 | Depreciation & Amortisation | Expense |
| 5900 | 5900 | Insurance | Expense |
| 6000 | 6000 | Management Fees | Expense |
| 6100 | 6100 | Interest Expense | Expense |
| 6200 | 6200 | Income Tax Expense | Expense |
| 6300 | 6300 | Other Fixed Charges | Expense |

---

## New API endpoints

Both go in `api/handler.js` AND `server/index.cjs` (these are GL endpoints, not inventory router).

### POST /api/gl/accounts/seed
- Runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS account_number`
- Upserts all 40 accounts above
- Returns `{ ok: true, upserted: N }`

### GET /api/gl/accounts
- `SELECT id, account_number, name, category FROM gl_accounts ORDER BY id`
- Returns `{ ok: true, rows: [...] }`

### POST /api/gl/accounts
Body: `{ id, account_number, name, category }`
- Validates: id, name, category (one of Asset/Liability/Equity/Revenue/Expense) present
- `INSERT INTO gl_accounts (id, account_number, name, category) VALUES (...) ON CONFLICT (id) DO NOTHING`
- Returns `{ ok: true }` or `{ ok: false, error }`

### PUT /api/gl/accounts/:id
Body: `{ account_number?, name?, category? }` — patch, only update supplied fields
- Validates: at least one field, category must be valid if supplied
- Returns `{ ok: true }` or `{ ok: false, error }`

---

## Frontend: ChartOfAccounts.tsx

**File:** `src/components/modules/ChartOfAccounts.tsx` (new file)

### Layout
- Header with title + "Seed USALI Accounts" button (calls `POST /api/gl/accounts/seed`; shows spinner + success toast)
- Filter bar: search input (filters by name or account_number), category dropdown (All / Asset / Liability / Equity / Revenue / Expense)
- Account table: Account # | Name | Category | Actions (Edit)
- Grouped by category with a subtle header row per group

### Add Account
- "+ Add Account" button opens a modal form
- Fields: Account Number (text), Name (text), Category (select), ID (text, auto-populated from account_number if blank but user can override)
- Submit → `POST /api/gl/accounts`

### Edit Account (inline modal)
- Edit button per row opens same modal pre-filled
- Submit → `PUT /api/gl/accounts/:id`
- ID field is read-only in edit mode

### Registration
- Wire into the existing Accounting module navigation so it's reachable. The Accounting module is in `src/components/modules/Accounting.tsx` (or wherever the GL/reports navigation lives). Add a "Chart of Accounts" nav item that renders `<ChartOfAccounts />`.

---

## No delete
No delete endpoint or button. Accounts referenced by journal lines must remain. The UI has no delete action.
