# USALI Chart of Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `account_number` column to `gl_accounts`, seed 40 USALI accounts, build a Chart of Accounts management UI (add/edit, no delete), and wire it into the Accounting module.

**Architecture:** Three new endpoints in BOTH `api/handler.js` and `server/index.cjs` (GL endpoints, not inventory router). New `ChartOfAccounts.tsx` component. `AccountingDom.tsx` gets a new button + action; `AppLayout.tsx` registers the new `chart-of-accounts` module.

**Tech Stack:** Node.js/Express, PostgreSQL (db.query returning `{ok, rows}`), React/TypeScript, Tailwind, shadcn/ui.

---

## File map

| File | Change |
|------|--------|
| `api/handler.js` | Add `POST /api/gl/accounts/seed`, `GET /api/gl/accounts`, `POST /api/gl/accounts`, `PUT /api/gl/accounts/:id` |
| `server/index.cjs` | Mirror all 4 endpoints (dual-backend requirement) |
| `src/components/modules/ChartOfAccounts.tsx` | New file — full UI component |
| `src/components/modules/AccountingDom.tsx` | Add "Chart of Accounts" button + action handler |
| `src/components/AppLayout.tsx` | Register `case 'chart-of-accounts'` |

---

### Task 1: Add GL accounts endpoints to api/handler.js

**Files:**
- Modify: `api/handler.js` — add 4 routes after the existing `/api/gl/journal-entries` block

The file uses `db.query(sql, params)` returning `{ ok, rows, rowCount }`. Find the section with `app.get('/api/gl/journal-entries', ...)` and add the new endpoints after it.

- [ ] **Step 1: Add the seed + CRUD endpoints to `api/handler.js`**

  After the existing GL journal entries routes, insert:

  ```js
  // ─── GL Accounts (Chart of Accounts) ────────────────────────────────────────

  const VALID_CATEGORIES = ['Asset','Liability','Equity','Revenue','Expense'];

  const USALI_ACCOUNTS = [
    { id:'1000', account_number:'1000', name:'Cash on Hand',                        category:'Asset'     },
    { id:'1050', account_number:'1050', name:'Petty Cash',                          category:'Asset'     },
    { id:'1100', account_number:'1100', name:'Card/Bank Clearing',                  category:'Asset'     },
    { id:'1150', account_number:'1150', name:'Bank Account',                        category:'Asset'     },
    { id:'1180', account_number:'1180', name:'EcoCash Mobile Money',                category:'Asset'     },
    { id:'1200', account_number:'1200', name:'In-house Guest Ledger',               category:'Asset'     },
    { id:'1300', account_number:'1300', name:'City Ledger / Accounts Receivable',   category:'Asset'     },
    { id:'1400', account_number:'1400', name:'Inventory — Food & Beverage',         category:'Asset'     },
    { id:'1500', account_number:'1500', name:'Prepaid Expenses',                    category:'Asset'     },
    { id:'1600', account_number:'1600', name:'Property, Plant & Equipment',         category:'Asset'     },
    { id:'1610', account_number:'1610', name:'Accumulated Depreciation',            category:'Asset'     },
    { id:'2100', account_number:'2100', name:'Accounts Payable',                    category:'Liability' },
    { id:'2200', account_number:'2200', name:'Accrued Expenses',                    category:'Liability' },
    { id:'2300', account_number:'2300', name:'VAT / Sales Tax Payable',             category:'Liability' },
    { id:'2400', account_number:'2400', name:'Advance Deposits',                    category:'Liability' },
    { id:'2500', account_number:'2500', name:'Current Portion Long-term Debt',      category:'Liability' },
    { id:'3000', account_number:'3000', name:'Owner\'s Equity / Capital',           category:'Equity'    },
    { id:'3100', account_number:'3100', name:'Retained Earnings',                   category:'Equity'    },
    { id:'3200', account_number:'3200', name:'Current Year Earnings',               category:'Equity'    },
    { id:'4000', account_number:'4000', name:'Rooms Revenue',                       category:'Revenue'   },
    { id:'4100', account_number:'4100', name:'Food & Beverage Revenue',             category:'Revenue'   },
    { id:'4200', account_number:'4200', name:'Conference / Catering Revenue',       category:'Revenue'   },
    { id:'4300', account_number:'4300', name:'Spa & Recreation Revenue',            category:'Revenue'   },
    { id:'4400', account_number:'4400', name:'Telephone & Internet Revenue',        category:'Revenue'   },
    { id:'4500', account_number:'4500', name:'Other Operated Departments Revenue',  category:'Revenue'   },
    { id:'4600', account_number:'4600', name:'Miscellaneous Income',                category:'Revenue'   },
    { id:'5000', account_number:'5000', name:'Rooms Payroll & Related',             category:'Expense'   },
    { id:'5100', account_number:'5100', name:'Food & Beverage Cost of Sales',       category:'Expense'   },
    { id:'5200', account_number:'5200', name:'Food & Beverage Payroll',             category:'Expense'   },
    { id:'5300', account_number:'5300', name:'Administrative & General',            category:'Expense'   },
    { id:'5400', account_number:'5400', name:'Sales & Marketing',                   category:'Expense'   },
    { id:'5500', account_number:'5500', name:'Property Operations & Maintenance',   category:'Expense'   },
    { id:'5600', account_number:'5600', name:'Utilities',                           category:'Expense'   },
    { id:'5700', account_number:'5700', name:'Information Technology',              category:'Expense'   },
    { id:'5800', account_number:'5800', name:'Depreciation & Amortisation',         category:'Expense'   },
    { id:'5900', account_number:'5900', name:'Insurance',                           category:'Expense'   },
    { id:'6000', account_number:'6000', name:'Management Fees',                     category:'Expense'   },
    { id:'6100', account_number:'6100', name:'Interest Expense',                    category:'Expense'   },
    { id:'6200', account_number:'6200', name:'Income Tax Expense',                  category:'Expense'   },
    { id:'6300', account_number:'6300', name:'Other Fixed Charges',                 category:'Expense'   },
  ];

  // POST /api/gl/accounts/seed  — add account_number column + upsert all USALI accounts
  app.post('/api/gl/accounts/seed', async (req, res) => {
    try {
      await db.query(`ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS account_number VARCHAR(20)`);
      let upserted = 0;
      for (const acc of USALI_ACCOUNTS) {
        const r = await db.query(
          `INSERT INTO gl_accounts (id, account_number, name, category)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE
             SET account_number = EXCLUDED.account_number,
                 name           = EXCLUDED.name,
                 category       = EXCLUDED.category`,
          [acc.id, acc.account_number, acc.name, acc.category]
        );
        if (r.ok) upserted++;
      }
      res.json({ ok: true, upserted });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/gl/accounts
  app.get('/api/gl/accounts', async (req, res) => {
    try {
      const r = await db.query(
        `SELECT id, account_number, name, category
         FROM gl_accounts
         ORDER BY id`
      );
      if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
      res.json({ ok: true, rows: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/gl/accounts
  app.post('/api/gl/accounts', async (req, res) => {
    const { id, account_number, name, category } = req.body;
    if (!id || !name || !category) {
      return res.status(400).json({ ok: false, error: 'id, name and category are required' });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ ok: false, error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }
    try {
      const r = await db.query(
        `INSERT INTO gl_accounts (id, account_number, name, category)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [id, account_number || id, name, category]
      );
      if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // PUT /api/gl/accounts/:id
  app.put('/api/gl/accounts/:id', async (req, res) => {
    const { id } = req.params;
    const { account_number, name, category } = req.body;
    if (!account_number && !name && !category) {
      return res.status(400).json({ ok: false, error: 'Provide at least one field to update' });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ ok: false, error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }
    const sets = [];
    const params = [];
    if (account_number) { params.push(account_number); sets.push(`account_number=$${params.length}`); }
    if (name)           { params.push(name);           sets.push(`name=$${params.length}`); }
    if (category)       { params.push(category);       sets.push(`category=$${params.length}`); }
    params.push(id);
    try {
      const r = await db.query(
        `UPDATE gl_accounts SET ${sets.join(', ')} WHERE id=$${params.length}`,
        params
      );
      if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'Account not found' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  ```

- [ ] **Step 2: Build**

  ```
  npm run build
  ```
  Expected: `✓ built in ...`

- [ ] **Step 3: Commit**

  ```
  git add api/handler.js
  git commit -m "feat: add GL accounts seed + CRUD endpoints to api/handler.js"
  ```

---

### Task 2: Mirror endpoints in server/index.cjs

**Files:**
- Modify: `server/index.cjs`

The dual-backend requirement means every GL endpoint must exist in both files. `server/index.cjs` uses `app.get/post/put` and the same `db.query({ok, rows})` pattern.

- [ ] **Step 1: Find the GL section in `server/index.cjs`**

  Search for `gl/journal-entries` in `server/index.cjs`. Add the four new routes immediately after the existing GL journal entries block. Copy the exact same code from Task 1 Step 1 — same `VALID_CATEGORIES`, `USALI_ACCOUNTS`, and all four routes — but replace `app.get/post/put` with `app.get/post/put` (same, Express is identical in both files).

  The only difference: `server/index.cjs` may use `const { randomUUID } = require('crypto')` at the top already. No new imports needed for these routes.

- [ ] **Step 2: Build**

  ```
  npm run build
  ```
  Expected: `✓ built in ...`

- [ ] **Step 3: Commit**

  ```
  git add server/index.cjs
  git commit -m "feat: mirror GL accounts endpoints in server/index.cjs (Render backend)"
  ```

---

### Task 3: Build ChartOfAccounts.tsx component

**Files:**
- Create: `src/components/modules/ChartOfAccounts.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
  import React, { useEffect, useState } from 'react';
  import { useToast } from '@/hooks/use-toast';

  const CATEGORIES = ['Asset','Liability','Equity','Revenue','Expense'] as const;
  type Category = typeof CATEGORIES[number];

  interface GLAccount {
    id: string;
    account_number: string;
    name: string;
    category: Category;
  }

  const EMPTY_FORM: Omit<GLAccount, never> = { id: '', account_number: '', name: '', category: 'Asset' };

  export const ChartOfAccounts: React.FC = () => {
    const { toast } = useToast();
    const [accounts, setAccounts] = useState<GLAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterCat, setFilterCat] = useState<Category | 'All'>('All');
    const [modalOpen, setModalOpen] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [form, setForm] = useState<GLAccount>({ ...EMPTY_FORM });
    const [saving, setSaving] = useState(false);
    const [seeding, setSeeding] = useState(false);

    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/gl/accounts');
        const d = await r.json();
        if (d.ok) setAccounts(d.rows);
        else toast({ title: 'Failed to load accounts', description: d.error, variant: 'destructive' });
      } catch (e: any) {
        toast({ title: 'Network error', description: e.message, variant: 'destructive' });
      } finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    const seed = async () => {
      setSeeding(true);
      try {
        const r = await fetch('/api/gl/accounts/seed', { method: 'POST' });
        const d = await r.json();
        if (d.ok) {
          toast({ title: 'Seed complete', description: `${d.upserted} accounts upserted` });
          load();
        } else {
          toast({ title: 'Seed failed', description: d.error, variant: 'destructive' });
        }
      } catch (e: any) {
        toast({ title: 'Network error', description: e.message, variant: 'destructive' });
      } finally { setSeeding(false); }
    };

    const openAdd = () => {
      setForm({ ...EMPTY_FORM });
      setEditMode(false);
      setModalOpen(true);
    };

    const openEdit = (acc: GLAccount) => {
      setForm({ ...acc });
      setEditMode(true);
      setModalOpen(true);
    };

    const save = async () => {
      if (!form.id || !form.name || !form.category) {
        toast({ title: 'Validation', description: 'ID, Name and Category are required', variant: 'destructive' });
        return;
      }
      setSaving(true);
      try {
        let r: Response;
        if (editMode) {
          r = await fetch(`/api/gl/accounts/${form.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_number: form.account_number, name: form.name, category: form.category }),
          });
        } else {
          r = await fetch('/api/gl/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          });
        }
        const d = await r.json();
        if (d.ok) {
          toast({ title: editMode ? 'Account updated' : 'Account created' });
          setModalOpen(false);
          load();
        } else {
          toast({ title: 'Save failed', description: d.error, variant: 'destructive' });
        }
      } catch (e: any) {
        toast({ title: 'Network error', description: e.message, variant: 'destructive' });
      } finally { setSaving(false); }
    };

    const visible = accounts.filter(a =>
      (filterCat === 'All' || a.category === filterCat) &&
      (!search || a.name.toLowerCase().includes(search.toLowerCase()) || a.account_number?.includes(search))
    );

    // Group by category for display
    const grouped = CATEGORIES.map(cat => ({
      cat,
      rows: visible.filter(a => a.category === cat),
    })).filter(g => g.rows.length > 0);

    return (
      <div className="space-y-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Chart of Accounts</h2>
            <p className="text-xs text-gray-500">USALI-aligned general ledger accounts</p>
          </div>
          <div className="flex gap-2">
            <button onClick={seed} disabled={seeding}
              className="px-4 py-2 border rounded text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {seeding ? 'Seeding…' : '🌱 Seed USALI Accounts'}
            </button>
            <button onClick={openAdd}
              className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700">
              + Add Account
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center flex-wrap">
          <input
            type="text"
            placeholder="Search by name or account #…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm w-64"
          />
          <select value={filterCat} onChange={e => setFilterCat(e.target.value as any)}
            className="border rounded px-3 py-1.5 text-sm">
            <option value="All">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="text-xs text-gray-400">{visible.length} account{visible.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-8 animate-pulse">Loading accounts…</p>
        ) : (
          <div className="rounded border overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 w-28">Account #</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 w-28">Category</th>
                  <th className="px-4 py-2 text-center font-medium text-gray-600 w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ cat, rows }) => (
                  <React.Fragment key={cat}>
                    <tr className="bg-gray-100">
                      <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {cat}
                      </td>
                    </tr>
                    {rows.map((acc, i) => (
                      <tr key={acc.id} className={`border-b ${i % 2 === 0 ? '' : 'bg-gray-50/30'} hover:bg-indigo-50/30`}>
                        <td className="px-4 py-2 font-mono text-gray-700">{acc.account_number || acc.id}</td>
                        <td className="px-4 py-2">{acc.name}</td>
                        <td className="px-4 py-2 text-gray-500">{acc.category}</td>
                        <td className="px-4 py-2 text-center">
                          <button onClick={() => openEdit(acc)}
                            className="text-xs text-indigo-600 hover:underline font-medium">Edit</button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">No accounts found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Add/Edit Modal */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
              <h3 className="text-lg font-bold">{editMode ? 'Edit Account' : 'Add Account'}</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Account ID {editMode && <span className="text-gray-400">(read-only)</span>}</label>
                  <input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
                    readOnly={editMode}
                    className={`w-full border rounded px-3 py-2 text-sm font-mono ${editMode ? 'bg-gray-50 text-gray-400' : ''}`} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Account Number</label>
                  <input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))}
                    placeholder="e.g. 4000"
                    className="w-full border rounded px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Category *</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as Category }))}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border rounded text-sm font-medium text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={save} disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium disabled:opacity-50">
                  {saving ? 'Saving…' : editMode ? 'Save Changes' : 'Add Account'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  export default ChartOfAccounts;
  ```

- [ ] **Step 2: Build**

  ```
  npm run build
  ```
  Expected: `✓ built in ...`

- [ ] **Step 3: Commit**

  ```
  git add src/components/modules/ChartOfAccounts.tsx
  git commit -m "feat: add ChartOfAccounts component with USALI seed, add/edit UI"
  ```

---

### Task 4: Wire ChartOfAccounts into AppLayout and AccountingDom

**Files:**
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/components/modules/AccountingDom.tsx`

- [ ] **Step 1: Register module in AppLayout.tsx**

  Find the `case 'accounting':` block (around line 308). Just before or after it, add:

  ```tsx
  case 'chart-of-accounts': {
    return (
      <div className="flex-1 overflow-y-auto">
        <ChartOfAccounts />
      </div>
    );
  }
  ```

  Add the import at the top of AppLayout.tsx with the other module imports:

  ```tsx
  import { ChartOfAccounts } from '@/components/modules/ChartOfAccounts';
  ```

- [ ] **Step 2: Add button + action to AccountingDom.tsx**

  In the `switch (action)` block (around line 22), add a new case before `default`:

  ```js
  case 'chart-of-accounts': {
    window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'chart-of-accounts' } } as any));
    break;
  }
  ```

  In the JSX buttons grid (around line 124), add the new button:

  ```tsx
  <button type="button" data-action="chart-of-accounts" className="acct-btn" aria-label="Chart of Accounts">
    <span className="mr-2">📒</span>Chart of Accounts
  </button>
  ```

- [ ] **Step 3: Build**

  ```
  npm run build
  ```
  Expected: `✓ built in ...` — no TypeScript errors.

- [ ] **Step 4: Commit**

  ```
  git add src/components/AppLayout.tsx src/components/modules/AccountingDom.tsx
  git commit -m "feat: wire ChartOfAccounts into Accounting module navigation"
  ```

---

### Task 5: Push and run seed

- [ ] **Step 1: Push**

  ```
  git push
  ```

- [ ] **Step 2: Seed both databases**

  After deploy:
  - Visit Villa Gianni → Accounting → Chart of Accounts → click "Seed USALI Accounts"
  - Visit Baradzanwa → Accounting → Chart of Accounts → click "Seed USALI Accounts"

  Expected: toast "40 accounts upserted" on each.
