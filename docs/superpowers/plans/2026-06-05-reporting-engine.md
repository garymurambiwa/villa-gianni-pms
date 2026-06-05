# Reporting Engine Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix blank reports (Trial Balance, P&L, Aged AR) by routing their data through live DB queries instead of localStorage, and retire the AllReportsPage table in favour of the existing ReportingDashboard dropdown.

**Architecture:** Add 3 new GET endpoints to `api/handler.js` that query `gl_journal_entries/lines/accounts` and `city_ledger_*` tables. Rewrite 3 broken `build*` functions in `src/lib/reporting.ts` to call these endpoints (DB-first, localStorage fallback). Replace the `AllReportsPage` table in `Reports.tsx` with `<ReportingDashboard />`.

**Tech Stack:** Node.js/Express (api/handler.js), React/TypeScript (src/), PostgreSQL via `db.query()`, Supabase.

---

## File Map

| File | Change |
|------|--------|
| `api/handler.js` | Add 3 new GET endpoints: `/api/reports/trial-balance`, `/api/reports/pl`, `/api/reports/aged-ar` |
| `src/lib/reporting.ts` | Rewrite `buildTrialBalance`, `buildMonthlyPL`, `buildAgedAR` to call new endpoints |
| `src/components/modules/Reports.tsx` | Replace `<AllReportsPage />` with `<ReportingDashboard />` at the `reportType === 'all'` branch |
| `src/components/modules/AllReportsPage.tsx` | No changes — file stays but is no longer mounted |

---

## Task 1: Backend — Trial Balance & P&L endpoints

**Files:**
- Modify: `api/handler.js` (add after the existing `/api/reports/night-audit-runs` block, around line 1270)

### What these endpoints do

`GET /api/reports/trial-balance?from=YYYY-MM-DD&to=YYYY-MM-DD`
Aggregates `gl_journal_lines` debits/credits per `gl_account_id`, joined to `gl_accounts` for name and category.

`GET /api/reports/pl?from=YYYY-MM-DD&to=YYYY-MM-DD`
Same aggregation but filters by category (`Revenue`, `Expense`) and returns totals.

- [ ] **Step 1: Add Trial Balance endpoint to api/handler.js**

Find the line:
```js
// ─── Printer status (no real printer on Vercel) ───────────────────────────────
```
Insert before it:

```js
// GET /api/reports/trial-balance?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns per-account debit/credit/balance for the date range from gl_journal_lines.
app.get('/api/reports/trial-balance', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return safeJson(res, { ok: false, error: 'from and to required' });
  try {
    const result = await db.query(
      `SELECT
         jl.gl_account_id   AS "accountId",
         COALESCE(a.name, jl.gl_account_id) AS name,
         COALESCE(a.category, 'Unknown')     AS category,
         COALESCE(SUM(jl.debit_amount),  0)::numeric(14,2) AS debit,
         COALESCE(SUM(jl.credit_amount), 0)::numeric(14,2) AS credit,
         (COALESCE(SUM(jl.debit_amount), 0) - COALESCE(SUM(jl.credit_amount), 0))::numeric(14,2) AS balance
       FROM gl_journal_lines jl
       JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
       LEFT JOIN gl_accounts a   ON a.id  = jl.gl_account_id
       WHERE je.business_date >= $1::date
         AND je.business_date <= $2::date
         AND je.status = 'posted'
         AND je.is_voided = false
       GROUP BY jl.gl_account_id, a.name, a.category
       ORDER BY a.category NULLS LAST, a.name`,
      [from, to]
    );
    const rows = (result.ok ? result.rows || [] : []).map(r => ({
      accountId: r.accountId,
      name:      r.name,
      category:  r.category,
      debit:     Number(r.debit),
      credit:    Number(r.credit),
      balance:   Number(r.balance)
    }));
    safeJson(res, { ok: true, rows });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// GET /api/reports/pl?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns Revenue total, Expense total, and GOP for the date range.
app.get('/api/reports/pl', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return safeJson(res, { ok: false, error: 'from and to required' });
  try {
    const result = await db.query(
      `SELECT
         COALESCE(a.category, 'Unknown') AS category,
         COALESCE(SUM(CASE WHEN a.category = 'Revenue' THEN jl.credit_amount - jl.debit_amount ELSE 0 END), 0)::numeric(14,2) AS revenue_net,
         COALESCE(SUM(CASE WHEN a.category = 'Expense' THEN jl.debit_amount - jl.credit_amount ELSE 0 END), 0)::numeric(14,2) AS expense_net,
         jl.gl_account_id AS "accountId",
         COALESCE(a.name, jl.gl_account_id) AS name
       FROM gl_journal_lines jl
       JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
       LEFT JOIN gl_accounts a   ON a.id  = jl.gl_account_id
       WHERE je.business_date >= $1::date
         AND je.business_date <= $2::date
         AND je.status = 'posted'
         AND je.is_voided = false
         AND a.category IN ('Revenue', 'Expense')
       GROUP BY a.category, jl.gl_account_id, a.name
       ORDER BY a.category, a.name`,
      [from, to]
    );
    const rows = result.ok ? result.rows || [] : [];
    const revenue = rows.filter(r => r.category === 'Revenue').reduce((s, r) => s + Number(r.revenue_net), 0);
    const expense = rows.filter(r => r.category === 'Expense').reduce((s, r) => s + Number(r.expense_net), 0);
    const lineItems = rows.map(r => ({
      category: r.category,
      accountId: r.accountId,
      name: r.name,
      amount: r.category === 'Revenue' ? Number(r.revenue_net) : Number(r.expense_net)
    }));
    safeJson(res, { ok: true, revenue: Number(revenue.toFixed(2)), expense: Number(expense.toFixed(2)), gop: Number((revenue - expense).toFixed(2)), rows: lineItems });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node -e "require('./api/handler.js')" 2>&1 | head -5
```
Expected: no output (or startup log lines, no SyntaxError).

- [ ] **Step 3: Commit**

```bash
git add api/handler.js
git commit -m "feat(reports): add /api/reports/trial-balance and /api/reports/pl endpoints"
```

---

## Task 2: Backend — Aged AR endpoint

**Files:**
- Modify: `api/handler.js` (add after Task 1's block)

`GET /api/reports/aged-ar?as_of=YYYY-MM-DD`
Queries `city_ledger_accounts` and `city_ledger_transactions` to compute outstanding balance per account, bucketed into 0-30, 31-60, 61-90, 90+ days.

- [ ] **Step 1: Add Aged AR endpoint**

After the `/api/reports/pl` endpoint added in Task 1, insert:

```js
// GET /api/reports/aged-ar?as_of=YYYY-MM-DD
// City ledger aging: sum outstanding charges per account bucketed by age.
app.get('/api/reports/aged-ar', async (req, res) => {
  const { as_of } = req.query;
  const asOf = as_of || new Date().toISOString().split('T')[0];
  try {
    const result = await db.query(
      `SELECT
         a.account_name,
         a.account_type,
         t.transaction_date::text AS date,
         (t.debit_amount - t.credit_amount)::numeric(12,2) AS net_amount,
         ($1::date - t.transaction_date)::int AS age_days
       FROM city_ledger_transactions t
       JOIN city_ledger_accounts a ON a.id = t.account_id
       WHERE t.transaction_date <= $1::date
         AND (t.debit_amount - t.credit_amount) > 0
       ORDER BY a.account_name, t.transaction_date`,
      [asOf]
    );
    const rows = (result.ok ? result.rows || [] : []).map(r => ({
      account:  r.account_name,
      type:     r.account_type,
      date:     r.date,
      amount:   Number(r.net_amount),
      bucket:   Number(r.age_days) <= 30 ? '0-30'
              : Number(r.age_days) <= 60 ? '31-60'
              : Number(r.age_days) <= 90 ? '61-90'
              : '90+'
    }));
    safeJson(res, { ok: true, rows });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node -e "require('./api/handler.js')" 2>&1 | head -5
```
Expected: no SyntaxError.

- [ ] **Step 3: Commit**

```bash
git add api/handler.js
git commit -m "feat(reports): add /api/reports/aged-ar endpoint"
```

---

## Task 3: Frontend — Rewrite buildTrialBalance

**Files:**
- Modify: `src/lib/reporting.ts` lines 866–874

Current (broken):
```ts
export const buildTrialBalance = async (monthISO: string) => {
  const [y, m] = monthISO.split('-');
  const start = `${y}-${m}-01`;
  const endDate = new Date(Number(y), Number(m));
  const end = endDate.toISOString().slice(0, 10);
  const tb = gl.getTrialBalance(start, end);  // ← reads localStorage only
  const rows = tb.map(a => ({ accountId: a.accountId, name: a.name, debit: a.debit, credit: a.credit, balance: a.balance }));
  return { title: `Trial Balance — ${monthISO}`, columns: ['Account', 'Name', 'Debit', 'Credit', 'Balance'], rows };
};
```

- [ ] **Step 1: Replace buildTrialBalance**

Replace the entire function (lines 866–874) with:

```ts
export const buildTrialBalance = async (monthISO: string) => {
  const [y, m] = monthISO.split('-');
  const from = `${y}-${m}-01`;
  const to = new Date(Number(y), Number(m)).toISOString().slice(0, 10);

  // DB-first: query gl_journal_lines via API endpoint
  try {
    const res = await fetch(`/api/reports/trial-balance?from=${from}&to=${to}`);
    const data = await res.json();
    if (data.ok && data.rows?.length > 0) {
      return {
        title: `Trial Balance — ${monthISO}`,
        columns: ['Account', 'Name', 'Category', 'Debit', 'Credit', 'Balance'],
        rows: data.rows.map((r: any) => ({
          Account: r.accountId,
          Name: r.name,
          Category: r.category,
          Debit: Number(r.debit).toFixed(2),
          Credit: Number(r.credit).toFixed(2),
          Balance: Number(r.balance).toFixed(2)
        }))
      };
    }
  } catch (err) {
    console.warn('[Reporting] buildTrialBalance DB fetch failed, using localStorage:', err);
  }

  // Offline fallback: localStorage GL ledger
  const tb = gl.getTrialBalance(from, to);
  const rows = tb.map(a => ({
    Account: a.accountId, Name: a.name, Category: '—',
    Debit: a.debit.toFixed(2), Credit: a.credit.toFixed(2), Balance: a.balance.toFixed(2)
  }));
  return { title: `Trial Balance — ${monthISO}`, columns: ['Account', 'Name', 'Category', 'Debit', 'Credit', 'Balance'], rows };
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "reporting.ts" | head -10
```
Expected: no errors on reporting.ts.

- [ ] **Step 3: Commit**

```bash
git add src/lib/reporting.ts
git commit -m "fix(reports): buildTrialBalance queries DB via /api/reports/trial-balance"
```

---

## Task 4: Frontend — Rewrite buildMonthlyPL

**Files:**
- Modify: `src/lib/reporting.ts` lines 1029–1041

Current (broken):
```ts
export const buildMonthlyPL = async (monthISO: string) => {
  const [y, m] = monthISO.split('-');
  const start = `${y}-${m}-01`;
  const end = new Date(Number(y), Number(m)).toISOString().slice(0, 10);
  const pl = gl.getPLStatement(start, end);  // ← reads localStorage only
  const rows = [
    { category: 'Revenue', amount: Number(pl.revenue || 0) },
    { category: 'Expense', amount: Number(pl.expense || 0) },
    { category: 'GOP (Revenue - Expense)', amount: Number((pl.revenue - pl.expense).toFixed(2)) },
    { category: 'Net Income', amount: Number(pl.netIncome || 0) }
  ];
  return { title: `Profit & Loss — ${monthISO}`, columns: ['Category', 'Amount'], rows };
};
```

- [ ] **Step 1: Replace buildMonthlyPL**

Replace lines 1029–1041 with:

```ts
export const buildMonthlyPL = async (monthISO: string) => {
  const [y, m] = monthISO.split('-');
  const from = `${y}-${m}-01`;
  const to = new Date(Number(y), Number(m)).toISOString().slice(0, 10);

  // DB-first: query gl_journal_lines via API endpoint
  try {
    const res = await fetch(`/api/reports/pl?from=${from}&to=${to}`);
    const data = await res.json();
    if (data.ok) {
      // Build summary rows + per-account detail rows
      const detailRows = (data.rows || []).map((r: any) => ({
        Category: r.category,
        Account: r.name,
        Amount: Number(r.amount).toFixed(2)
      }));
      // Append totals
      detailRows.push({ Category: '─── TOTAL Revenue', Account: '', Amount: Number(data.revenue).toFixed(2) });
      detailRows.push({ Category: '─── TOTAL Expense', Account: '', Amount: Number(data.expense).toFixed(2) });
      detailRows.push({ Category: 'Gross Operating Profit', Account: '', Amount: Number(data.gop).toFixed(2) });
      return {
        title: `Profit & Loss — ${monthISO}`,
        columns: ['Category', 'Account', 'Amount'],
        rows: detailRows
      };
    }
  } catch (err) {
    console.warn('[Reporting] buildMonthlyPL DB fetch failed, using localStorage:', err);
  }

  // Offline fallback: localStorage GL
  const pl = gl.getPLStatement(from, to);
  const rows = [
    { Category: 'Revenue', Account: '—', Amount: Number(pl.revenue || 0).toFixed(2) },
    { Category: 'Expense', Account: '—', Amount: Number(pl.expense || 0).toFixed(2) },
    { Category: 'Gross Operating Profit', Account: '—', Amount: Number((pl.revenue - pl.expense).toFixed(2)) },
    { Category: 'Net Income', Account: '—', Amount: Number(pl.netIncome || 0).toFixed(2) }
  ];
  return { title: `Profit & Loss — ${monthISO}`, columns: ['Category', 'Account', 'Amount'], rows };
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "reporting.ts" | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/reporting.ts
git commit -m "fix(reports): buildMonthlyPL queries DB via /api/reports/pl"
```

---

## Task 5: Frontend — Rewrite buildAgedAR

**Files:**
- Modify: `src/lib/reporting.ts` lines 1043–1051

Current (broken):
```ts
export const buildAgedAR = async (asOf?: string) => {
  const date = asOf || getBusinessDate();
  const ledger = readJSON<any[]>('corepms_city_ledger', []);  // ← localStorage only
  const now = new Date(date);
  const ageDays = (d: string) => Math.floor((now.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
  const rows = ledger.map(t => ({ account: t.guestName || t.accountName || 'Account', reference: t.reason || t.reference || '', date: t.date, amount: Number(t.amount || 0), bucket: (() => { const a = ageDays(t.date || date); return a <= 30 ? '0-30' : a <= 60 ? '31-60' : a <= 90 ? '61-90' : '90+'; })() }));
  return { title: `Aged Accounts Receivable — ${date}`, columns: ['Account', 'Reference', 'Date', 'Amount', 'Aging'], rows };
};
```

- [ ] **Step 1: Replace buildAgedAR**

Replace lines 1043–1051 with:

```ts
export const buildAgedAR = async (asOf?: string) => {
  const date = asOf || getBusinessDate();

  // DB-first: query city_ledger_transactions via API endpoint
  try {
    const res = await fetch(`/api/reports/aged-ar?as_of=${date}`);
    const data = await res.json();
    if (data.ok && data.rows?.length > 0) {
      return {
        title: `Aged Accounts Receivable — ${date}`,
        columns: ['Account', 'Type', 'Date', 'Amount', 'Aging'],
        rows: data.rows.map((r: any) => ({
          Account: r.account,
          Type:    r.type,
          Date:    r.date,
          Amount:  Number(r.amount).toFixed(2),
          Aging:   r.bucket
        }))
      };
    }
  } catch (err) {
    console.warn('[Reporting] buildAgedAR DB fetch failed, using localStorage:', err);
  }

  // Offline fallback: localStorage city ledger
  const ledger = readJSON<any[]>('corepms_city_ledger', []);
  const now = new Date(date);
  const ageDays = (d: string) => Math.floor((now.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
  const rows = ledger.map(t => ({
    Account: t.guestName || t.accountName || 'Account',
    Type:    'Legacy',
    Date:    t.date || date,
    Amount:  Number(t.amount || 0).toFixed(2),
    Aging:   (() => { const a = ageDays(t.date || date); return a <= 30 ? '0-30' : a <= 60 ? '31-60' : a <= 90 ? '61-90' : '90+'; })()
  }));
  return { title: `Aged Accounts Receivable — ${date}`, columns: ['Account', 'Type', 'Date', 'Amount', 'Aging'], rows };
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "reporting.ts" | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/reporting.ts
git commit -m "fix(reports): buildAgedAR queries DB via /api/reports/aged-ar"
```

---

## Task 6: UI — Replace AllReportsPage table with ReportingDashboard

**Files:**
- Modify: `src/components/modules/Reports.tsx` (around line 514–519)
- The import at line 3 (`import { AllReportsPage } from './AllReportsPage'`) can be removed if no other code in Reports.tsx uses it.

Current:
```tsx
{/* Dedicated All Reports view with pagination & URL params */}
{reportType === 'all' && (
  <div className="ds-card">
    <AllReportsPage />
  </div>
)}
```

- [ ] **Step 1: Replace AllReportsPage mount with ReportingDashboard**

In `src/components/modules/Reports.tsx`:

1. Find the import line:
```tsx
import { AllReportsPage } from './AllReportsPage';
```
Replace with:
```tsx
import ReportingDashboard from './ReportingDashboard';
```
(Check no other place in the file imports AllReportsPage; if it does, keep both imports.)

2. Find:
```tsx
{reportType === 'all' && (
  <div className="ds-card">
    <AllReportsPage />
  </div>
)}
```
Replace with:
```tsx
{reportType === 'all' && (
  <div className="ds-card">
    <ReportingDashboard />
  </div>
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "Reports.tsx" | head -10
```
Expected: no errors.

- [ ] **Step 3: Verify the app builds**

```bash
npm run build 2>&1 | tail -10
```
Expected: `✓ built in` line, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/modules/Reports.tsx
git commit -m "feat(reports): replace AllReportsPage table with ReportingDashboard dropdown — no cascading menus"
```

---

## Task 7: Push and verify on live

- [ ] **Step 1: Push to main**

```bash
git push
```

- [ ] **Step 2: Manual smoke test on baradzanwa.vercel.app**

After Vercel redeploy (≈1-2 min):
1. Navigate to Reports → select "Monthly: Trial Balance"
2. Pick a month that has night audits (check Night Audit history for a completed date)
3. Confirm the table shows account rows with Debit/Credit/Balance — not "No data"
4. Select "Monthly: Profit & Loss (USALI)" — confirm Revenue/Expense rows appear
5. Select "Monthly: Aged Accounts Receivable" — confirm city ledger rows appear (or "No data" if genuinely empty — that is correct behaviour, not a bug)
6. Navigate to Reports → "All Reports" tab — confirm it now shows the same `<Select>` dropdown, NOT the old paginated table

- [ ] **Step 3: Smoke test on villa-gianni-pms.onrender.com**

Same 6 checks as Step 2. Render deploys take 3-5 min after push.

---

## Self-Review Notes

- `buildArrivalsDepartures` was already DB-backed with a proper query — no change needed.
- `AllReportsPage.tsx` is not deleted (other code may reference it); it is simply no longer mounted.
- Column key casing (`Account`, `Name`, etc.) in the rewritten functions matches how `ReportingDashboard` renders: `dataset.columns.map(c => (r as any)[c])` — uppercase keys in `columns` array must match object property names exactly. Each rewrite uses matching keys.
- The P&L endpoint returns both per-account `rows` and summary `revenue/expense/gop` fields; the frontend uses `rows` for the table and ignores the summary fields (they are there for future dashboard KPI cards).
