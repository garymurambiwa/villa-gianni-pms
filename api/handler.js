/**
 * api/handler.js — Vercel Serverless Function (catch-all API handler)
 *
 * Routes all /api/* requests here via vercel.json rewrite.
 * Exports an Express app as a Vercel serverless handler.
 *
 * IMPORTANT: Requires DATABASE_URL environment variable set in
 * Vercel project settings → Environment Variables.
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('../server/db-web.cjs');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// ── Inventory Bootstrap endpoint ─────────────────────────────────────────────
// GET /api/v1/inventory/init?key=confirm — triggers table creation on fresh DB
// This is called automatically by the router on load, but can also be triggered manually.

// ── Mount inventory v11 router (/api/v1/inventory/*) ──────────────────────────
// Provides all advanced inventory routes to Vercel deployments:
//   Items CRUD, GRN (post + list), Transfers (create + approve),
//   Recipes, Variance reports, Locations CRUD, UOM CRUD, Sale Depletion
// Uses DATABASE_URL env var (must be set in Vercel project settings)
try {
  const inventoryRouter = require('../server/routes/inventory-v11.cjs');
  app.use('/api/v1/inventory', inventoryRouter);
  console.log('[handler] inventory-v11 routes mounted at /api/v1/inventory');
} catch (e) {
  console.warn('[handler] inventory-v11 router failed to load (inventory features unavailable):', e.message);
  // Graceful degradation — all other routes still work
}

// ─── Utility ─────────────────────────────────────────────────────────────────
const safeJson = (res, data) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(data);
};

// ─── Health / Test ────────────────────────────────────────────────────────────
app.get('/api/test', (req, res) => {
  safeJson(res, { ok: true, message: 'Vercel API handler working', ts: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  safeJson(res, { ok: true, env: { hasDb: !!process.env.DATABASE_URL } });
});

// ─── Core Database Endpoints ──────────────────────────────────────────────────
app.post('/api/db/query', async (req, res) => {
  const { sql, params } = req.body || {};
  if (!sql) return safeJson(res, { ok: false, error: 'SQL required' });
  try {
    const result = await db.query(sql, params);
    safeJson(res, result);
  } catch (e) {
    safeJson(res, { ok: false, error: e.message });
  }
});

app.post('/api/db/exec', async (req, res) => {
  const { sql } = req.body || {};
  if (!sql) return safeJson(res, { ok: false, error: 'SQL required' });
  try {
    const result = await db.exec(sql);
    safeJson(res, result);
  } catch (e) {
    safeJson(res, { ok: false, error: e.message });
  }
});

app.post('/api/db/transaction', async (req, res) => {
  const { operations } = req.body || {};
  if (!Array.isArray(operations)) return safeJson(res, { ok: false, error: 'operations array required' });
  try {
    const result = await db.transaction(operations);
    safeJson(res, result);
  } catch (e) {
    safeJson(res, { ok: false, error: e.message });
  }
});

app.post('/api/db/test', async (req, res) => {
  try {
    const result = await db.query('SELECT version()');
    if (result.ok) safeJson(res, { ok: true, serverVersion: result.rows[0]?.version });
    else safeJson(res, { ok: false, error: result.error });
  } catch (e) {
    safeJson(res, { ok: false, error: e.message });
  }
});

// ─── GL Account Mappings (DB-backed) ─────────────────────────────────────────
// ISSUE 2 FIX: GL mappings were localStorage-only → invisible to server-side
// processes and lost across sessions. Now persisted in system_configs so all
// contexts (Vercel, Render, browsers) read the same mappings.
//
// USALI-aligned required aliases and their classifications:
//   ROOM_REVENUE  → Revenue: Rooms Dept         (USALI Schedule 1)
//   FB_REVENUE    → Revenue: F&B Dept            (USALI Schedule 2)
//   CONF_REVENUE  → Revenue: Catering/Banquets   (USALI Schedule 3)
//   TAX           → Liability: VAT/Sales Tax
//   CASH          → Asset: Cash on Hand
//   CARD          → Asset: Card Clearing/Bank
//   ROOM_CHARGE   → Control: In-house Guest Ledger (transient AR)
//   CITY_LEDGER   → Control: Accounts Receivable  (non-guest/corporate)
//   FB_REVENUE, BANK, AP_CONTROL etc. extended as needed.

const GL_REQUIRED_CODES = [
  'ROOM_REVENUE','FB_REVENUE','CONF_REVENUE','TAX','CASH','CARD','ECOCASH','ROOM_CHARGE','CITY_LEDGER'
];

// USALI-aligned safe default account numbers (seed if no user mapping exists)
const GL_USALI_DEFAULTS = {
  ROOM_REVENUE:  { accountId: '4000', name: 'Rooms Revenue',          category: 'Revenue',   usali: 'Rooms' },
  FB_REVENUE:    { accountId: '4100', name: 'F&B Revenue',            category: 'Revenue',   usali: 'F&B' },
  CONF_REVENUE:  { accountId: '4200', name: 'Conference Revenue',     category: 'Revenue',   usali: 'Catering' },
  TAX:           { accountId: '2300', name: 'VAT/Sales Tax Payable',  category: 'Liability', usali: 'Tax' },
  CASH:          { accountId: '1000', name: 'Cash on Hand',           category: 'Asset',     usali: 'Cash' },
  CARD:          { accountId: '1100', name: 'Card/Bank Clearing',     category: 'Asset',     usali: 'Bank' },
  ECOCASH:       { accountId: '1180', name: 'EcoCash Mobile Money',   category: 'Asset',     usali: 'Bank' },
  ROOM_CHARGE:   { accountId: '1200', name: 'In-house Guest Ledger',  category: 'Asset',     usali: 'GuestLedger' },
  CITY_LEDGER:   { accountId: '1300', name: 'City Ledger/AR',         category: 'Asset',     usali: 'AR' },
  FB_COST:       { accountId: '5100', name: 'F&B Cost of Sales',      category: 'Expense',   usali: 'F&B Cost' },
  BANK:          { accountId: '1150', name: 'Bank Account',           category: 'Asset',     usali: 'Bank' },
  AP_CONTROL:    { accountId: '2100', name: 'Accounts Payable',       category: 'Liability', usali: 'AP' },
};

// ─── GL Journal Entries (Daily Journal — DB-backed, single source of truth) ──
// GET  /api/gl/journal-entries?date=YYYY-MM-DD&from=...&to=...
// POST /api/gl/journal-entries  { id, date, reference, source, lines:[{accountId,debit,credit,description}] }
// GET  /api/gl/journal-entries/pl?from=YYYY-MM-DD&to=YYYY-MM-DD

app.get('/api/gl/journal-entries', async (req, res) => {
  try {
    const { date, from, to, source, limit } = req.query;
    let sql = `SELECT je.*, COALESCE(json_agg(jl ORDER BY jl.id) FILTER (WHERE jl.id IS NOT NULL),'[]') as lines
               FROM gl_journal_entries je
               LEFT JOIN gl_journal_lines jl ON jl.journal_entry_id = je.id
               WHERE je.status != 'voided'`;
    const params = [];
    if (date)   { sql += ` AND je.business_date = $${params.length+1}::date`; params.push(date); }
    if (from)   { sql += ` AND je.business_date >= $${params.length+1}::date`; params.push(from); }
    if (to)     { sql += ` AND je.business_date <= $${params.length+1}::date`; params.push(to); }
    if (source) { sql += ` AND je.source = $${params.length+1}`; params.push(source); }
    sql += ` GROUP BY je.id ORDER BY je.business_date DESC, je.inserted_at DESC`;
    if (limit)  { sql += ` LIMIT $${params.length+1}`; params.push(parseInt(limit)); }
    safeJson(res, await db.query(sql, params));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.post('/api/gl/journal-entries', async (req, res) => {
  const { id, date, business_date, reference, source, description, lines, created_by } = req.body || {};
  const entryDate = business_date || date;
  if (!entryDate || !Array.isArray(lines) || lines.length === 0)
    return safeJson(res, { ok: false, error: 'business_date and lines[] required' });

  // Validate balanced entry: sum(debit) must equal sum(credit)
  const sumDebit  = lines.reduce((s, l) => s + Number(l.debit  || 0), 0);
  const sumCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(sumDebit - sumCredit) > 0.005)
    return safeJson(res, { ok: false, error: `Journal not balanced: debits $${sumDebit.toFixed(2)} ≠ credits $${sumCredit.toFixed(2)}` });

  try {
    const entryId = id || `GLJE_${entryDate}_${Date.now().toString(36)}`;
    const src = source || 'manual';
    const ops = [
      {
        sql: `INSERT INTO gl_journal_entries
                (id, entry_date, business_date, description, reference, source, status,
                 total_debit, total_credit, is_balanced, created_by, posted_by, posted_at, inserted_at)
              VALUES ($1, $2::date, $2::date, $3, $4, $5, 'posted', $6, $7, true, $8, $8, NOW(), NOW())
              ON CONFLICT (id) DO UPDATE SET
                description=EXCLUDED.description, reference=EXCLUDED.reference,
                total_debit=EXCLUDED.total_debit, total_credit=EXCLUDED.total_credit,
                updated_at=NOW()
              RETURNING id`,
        params: [entryId, entryDate, description || reference || `Journal ${entryDate}`,
                 reference || null, src, sumDebit, sumCredit, created_by || 'system']
      },
      // Delete existing lines before re-inserting (upsert pattern)
      { sql: `DELETE FROM gl_journal_lines WHERE journal_entry_id=$1`, params: [entryId] },
      ...lines.map((l, i) => ({
        sql: `INSERT INTO gl_journal_lines (id, journal_entry_id, gl_account_id, debit_amount, credit_amount, description, inserted_at)
              VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        params: [`${entryId}_L${i+1}`, entryId, l.accountId || l.gl_account_id,
                 Number(l.debit||0), Number(l.credit||0), l.description || null]
      }))
    ];

    const txResult = await db.transaction(ops);
    if (!txResult.ok) throw new Error(txResult.error || 'Transaction failed');
    safeJson(res, { ok: true, id: entryId, date: entryDate, totalDebit: sumDebit, totalCredit: sumCredit });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// GET /api/gl/journal-entries/pl — P&L summary from DB journal lines
app.get('/api/gl/journal-entries/pl', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return safeJson(res, { ok: false, error: 'from and to dates required' });
  try {
    const result = await db.query(
      `SELECT
         a.category,
         a.name as account_name,
         jl.gl_account_id,
         COALESCE(SUM(jl.debit_amount),0)  as total_debit,
         COALESCE(SUM(jl.credit_amount),0) as total_credit,
         COALESCE(SUM(jl.credit_amount),0) - COALESCE(SUM(jl.debit_amount),0) as net_balance
       FROM gl_journal_lines jl
       JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
       LEFT JOIN gl_accounts   a  ON a.id  = jl.gl_account_id
       WHERE je.business_date >= $1::date
         AND je.business_date <= $2::date
         AND je.status = 'posted'
       GROUP BY a.category, a.name, jl.gl_account_id
       ORDER BY a.category, a.name`,
      [from, to]
    );
    const rows = result.rows || [];
    const revenue = rows.filter(r => r.category === 'Revenue').reduce((s, r) => s + Number(r.net_balance||0), 0);
    const expense = rows.filter(r => r.category === 'Expense').reduce((s, r) => s + Number(r.total_debit||0) - Number(r.total_credit||0), 0);
    safeJson(res, { ok: true, from, to, lines: rows, revenue: Number(revenue.toFixed(2)), expense: Number(expense.toFixed(2)), netIncome: Number((revenue - expense).toFixed(2)) });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// GET /api/gl/daily-journal-report?date=YYYY-MM-DD — Daily Journal Report for Reports module
app.get('/api/gl/daily-journal-report', async (req, res) => {
  const { date } = req.query;
  if (!date) return safeJson(res, { ok: false, error: 'date required' });
  try {
    // Fetch journal entries for the date with their lines + night audit snapshot
    const [journalRes, auditRes] = await Promise.all([
      db.query(
        `SELECT je.id, je.business_date, je.description, je.reference, je.source,
                je.total_debit, je.total_credit, je.status, je.posted_at,
                COALESCE(json_agg(jl ORDER BY jl.id) FILTER (WHERE jl.id IS NOT NULL),'[]') as lines
         FROM gl_journal_entries je
         LEFT JOIN gl_journal_lines jl ON jl.journal_entry_id = je.id
         WHERE je.business_date = $1::date AND je.status='posted'
         GROUP BY je.id ORDER BY je.inserted_at DESC`,
        [date]
      ),
      db.query(
        `SELECT business_date, room_revenue, total_revenue, occupancy_percent, adr, revpar,
                rooms_posted, reports_snapshot, status
         FROM night_audit_runs WHERE business_date::date = $1::date LIMIT 1`,
        [date]
      )
    ]);
    safeJson(res, {
      ok: true,
      date,
      journalEntries: journalRes.rows || [],
      nightAudit: auditRes.rows?.[0] || null,
      totalDebit:  (journalRes.rows || []).reduce((s, e) => s + Number(e.total_debit||0), 0),
      totalCredit: (journalRes.rows || []).reduce((s, e) => s + Number(e.total_credit||0), 0),
    });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/gl/mappings', async (req, res) => {
  try {
    const result = await db.query(`SELECT value FROM system_configs WHERE key='gl_mappings'`);
    let mappings = {};
    if (result.ok && result.rows?.length) {
      try { mappings = JSON.parse(result.rows[0].value); } catch { mappings = {}; }
    }
    // Merge defaults so missing codes always resolve to USALI safe defaults
    const merged = { ...Object.fromEntries(Object.entries(GL_USALI_DEFAULTS).map(([k,v])=>[k,v.accountId])), ...mappings };
    safeJson(res, { ok: true, mappings: merged, requiredCodes: GL_REQUIRED_CODES, defaults: GL_USALI_DEFAULTS });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.post('/api/gl/mappings', async (req, res) => {
  const { mappings } = req.body || {};
  if (!mappings || typeof mappings !== 'object') return safeJson(res, { ok: false, error: 'mappings object required' });
  try {
    const existing = await db.query(`SELECT value FROM system_configs WHERE key='gl_mappings'`);
    let current = {};
    if (existing.ok && existing.rows?.length) { try { current = JSON.parse(existing.rows[0].value); } catch {} }
    const merged = { ...current, ...mappings };
    await db.query(
      `INSERT INTO system_configs (key,value) VALUES ('gl_mappings',$1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [JSON.stringify(merged)]
    );
    safeJson(res, { ok: true, mappings: merged });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// GET /api/gl/mappings/validate — check which required codes are mapped
app.get('/api/gl/mappings/validate', async (req, res) => {
  try {
    const result = await db.query(`SELECT value FROM system_configs WHERE key='gl_mappings'`);
    let mappings = {};
    if (result.ok && result.rows?.length) { try { mappings = JSON.parse(result.rows[0].value); } catch {} }
    const merged = { ...Object.fromEntries(Object.entries(GL_USALI_DEFAULTS).map(([k,v])=>[k,v.accountId])), ...mappings };
    const missing = GL_REQUIRED_CODES.filter(c => !merged[c]);
    safeJson(res, { ok: missing.length === 0, mappings: merged, missing, complete: missing.length === 0 });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/gl/mappings/seed — seed USALI defaults for any unmapped codes
app.post('/api/gl/mappings/seed', async (req, res) => {
  try {
    const existing = await db.query(`SELECT value FROM system_configs WHERE key='gl_mappings'`);
    let current = {};
    if (existing.ok && existing.rows?.length) { try { current = JSON.parse(existing.rows[0].value); } catch {} }
    // Only seed codes that have no existing mapping
    const seeded = {};
    for (const [code, def] of Object.entries(GL_USALI_DEFAULTS)) {
      if (!current[code]) { current[code] = def.accountId; seeded[code] = def.accountId; }
    }
    await db.query(
      `INSERT INTO system_configs (key,value) VALUES ('gl_mappings',$1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [JSON.stringify(current)]
    );
    safeJson(res, { ok: true, mappings: current, seeded, message: `Seeded ${Object.keys(seeded).length} USALI default account mappings` });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── GL Accounts (Chart of Accounts) ────────────────────────────────────────

const VALID_GL_CATEGORIES = ['Asset','Liability','Equity','Revenue','Expense'];

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
  { id:'3000', account_number:'3000', name:"Owner's Equity / Capital",            category:'Equity'    },
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

// POST /api/gl/accounts/seed
app.post('/api/gl/accounts/seed', async (req, res) => {
  try {
    await db.query(`ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS account_number VARCHAR(20)`);

    // ── GL Pending Batches tables ─────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS gl_account_mappings (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        source_type     TEXT NOT NULL CHECK (source_type IN ('SUPPLIER','CUSTOMER_CREDIT','STOCK_CATEGORY')),
        source_ref_id   TEXT NOT NULL,
        target_gl_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
        updated_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (source_type, source_ref_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS gl_pending_batches (
        id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        origin_table      TEXT NOT NULL,
        origin_id         TEXT NOT NULL,
        description       TEXT,
        debit_gl_account  TEXT NOT NULL,
        credit_gl_account TEXT NOT NULL,
        amount            NUMERIC(12,2) NOT NULL,
        status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','POSTED','IGNORED')),
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        posted_at         TIMESTAMPTZ,
        posted_journal_id TEXT REFERENCES gl_journal_entries(id),
        UNIQUE (origin_table, origin_id)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_glpb_status ON gl_pending_batches(status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_glpb_origin ON gl_pending_batches(origin_table, origin_id)`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_stock_take_sheets (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        location_id   TEXT NOT NULL,
        period_start  DATE NOT NULL,
        period_end    DATE NOT NULL,
        status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked')),
        created_by    TEXT,
        created_at    TIMESTAMPTZ DEFAULT now(),
        locked_at     TIMESTAMPTZ,
        locked_by     TEXT,
        UNIQUE (location_id, period_start, period_end)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_stock_take_lines (
        id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        sheet_id              TEXT NOT NULL REFERENCES inv_stock_take_sheets(id) ON DELETE CASCADE,
        item_id               TEXT NOT NULL,
        opening_qty           NUMERIC(12,4) NOT NULL DEFAULT 0,
        purchases_qty         NUMERIC(12,4) NOT NULL DEFAULT 0,
        transfers_in_qty      NUMERIC(12,4) NOT NULL DEFAULT 0,
        transfers_out_qty     NUMERIC(12,4) NOT NULL DEFAULT 0,
        theoretical_sales_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
        adjustments_qty       NUMERIC(12,4) NOT NULL DEFAULT 0,
        physical_qty          NUMERIC(12,4),
        unit_cost             NUMERIC(12,4) NOT NULL DEFAULT 0,
        item_name             TEXT,
        UNIQUE (sheet_id, item_id)
      )
    `);

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
      `SELECT id, account_number, name, category FROM gl_accounts ORDER BY id`
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
  if (!VALID_GL_CATEGORIES.includes(category)) {
    return res.status(400).json({ ok: false, error: `category must be one of: ${VALID_GL_CATEGORIES.join(', ')}` });
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
  if (category && !VALID_GL_CATEGORIES.includes(category)) {
    return res.status(400).json({ ok: false, error: `category must be one of: ${VALID_GL_CATEGORIES.join(', ')}` });
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

// ─── GL Pending Batches ───────────────────────────────────────────────────────

// GET /api/gl/pending-batches
app.get('/api/gl/pending-batches', async (req, res) => {
  const { status } = req.query;
  const st = status || 'PENDING';
  try {
    const r = await db.query(
      `SELECT id, origin_table, origin_id, description, debit_gl_account, credit_gl_account,
              amount, status, created_at
       FROM gl_pending_batches
       WHERE status = $1
       ORDER BY created_at DESC`,
      [st]
    );
    safeJson(res, { ok: true, rows: r.rows || [] });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/gl/pending-batches (create)
app.post('/api/gl/pending-batches', async (req, res) => {
  const { origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount } = req.body || {};
  if (!origin_table || !origin_id || !debit_gl_account || !credit_gl_account || amount == null)
    return safeJson(res, { ok: false, error: 'origin_table, origin_id, debit_gl_account, credit_gl_account, amount required' });
  try {
    const r = await db.query(
      `INSERT INTO gl_pending_batches (origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (origin_table, origin_id) DO NOTHING
       RETURNING id`,
      [origin_table, origin_id, description || null, debit_gl_account, credit_gl_account, Number(amount)]
    );
    const id = r.rows?.[0]?.id || null;
    safeJson(res, { ok: true, id, created: !!id });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/gl/pending-batches/flush (MUST be BEFORE /:id routes)
app.post('/api/gl/pending-batches/flush', async (req, res) => {
  try {
    const pending = await db.query(
      `SELECT * FROM gl_pending_batches WHERE status='PENDING' ORDER BY created_at`
    );
    const rows = pending.rows || [];
    if (!rows.length) return safeJson(res, { ok: true, flushed: 0, errors: [] });

    let flushed = 0;
    const errors = [];

    for (const batch of rows) {
      try {
        const entryId = `GLJE_BATCH_${batch.id}`;
        const ops = [
          {
            sql: `INSERT INTO gl_journal_entries
                    (id, entry_date, business_date, description, source, status,
                     total_debit, total_credit, is_balanced, created_by, posted_by, posted_at, inserted_at)
                  VALUES ($1, NOW()::date, NOW()::date, $2, 'pending_batch', 'posted', $3, $3, true, 'system', 'system', NOW(), NOW())
                  ON CONFLICT (id) DO NOTHING
                  RETURNING id`,
            params: [entryId, batch.description || `Batch ${batch.origin_table}/${batch.origin_id}`, Number(batch.amount)]
          },
          {
            sql: `INSERT INTO gl_journal_lines (id, journal_entry_id, gl_account_id, debit_amount, credit_amount, description, inserted_at)
                  VALUES ($1, $2, $3, $4, 0, $5, NOW())`,
            params: [`${entryId}_DR`, entryId, batch.debit_gl_account, Number(batch.amount), batch.description || null]
          },
          {
            sql: `INSERT INTO gl_journal_lines (id, journal_entry_id, gl_account_id, debit_amount, credit_amount, description, inserted_at)
                  VALUES ($1, $2, $3, 0, $4, $5, NOW())`,
            params: [`${entryId}_CR`, entryId, batch.credit_gl_account, Number(batch.amount), batch.description || null]
          },
          {
            sql: `UPDATE gl_pending_batches SET status='POSTED', posted_at=NOW(), posted_journal_id=$1 WHERE id=$2`,
            params: [entryId, batch.id]
          }
        ];
        const txResult = await db.transaction(ops);
        if (!txResult.ok) throw new Error(txResult.error || 'Transaction failed');
        flushed++;
      } catch (batchErr) {
        errors.push({ id: batch.id, error: batchErr.message });
      }
    }

    safeJson(res, { ok: true, flushed, errors });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// PATCH /api/gl/pending-batches/:id (MUST be AFTER /flush)
app.patch('/api/gl/pending-batches/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!['POSTED','IGNORED'].includes(status))
    return safeJson(res, { ok: false, error: 'status must be POSTED or IGNORED' });
  try {
    const extra = status === 'POSTED' ? ', posted_at = NOW()' : '';
    const r = await db.query(
      `UPDATE gl_pending_batches SET status=$1${extra} WHERE id=$2 RETURNING id`,
      [status, id]
    );
    if (!r.rows?.length) return safeJson(res, { ok: false, error: 'Not found' });
    safeJson(res, { ok: true });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── System Branding (DB-backed, per-property) ───────────────────────────────
// Reads/writes hotel branding from system_configs so each property keeps its own
// name/logo regardless of which Vite build is deployed.
app.get('/api/system/branding', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT key, value FROM system_configs
       WHERE key IN ('hotel_name','hotel_address','hotel_phone','hotel_email',
                     'hotel_website','hotel_logo_url','hotel_logo_show',
                     'hotel_receipt_footer','hotel_tax_rate','hotel_paper_size')`
    );
    const map = {};
    if (result.ok && result.rows) {
      for (const row of result.rows) {
        try { map[row.key] = JSON.parse(row.value); } catch { map[row.key] = row.value; }
      }
    }
    safeJson(res, { ok: true, branding: map });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.post('/api/system/branding', async (req, res) => {
  const patch = req.body || {};
  const allowed = ['hotel_name','hotel_address','hotel_phone','hotel_email',
                   'hotel_website','hotel_logo_url','hotel_logo_show',
                   'hotel_receipt_footer','hotel_tax_rate','hotel_paper_size'];
  try {
    const ops = Object.entries(patch)
      .filter(([k]) => allowed.includes(k))
      .map(([k, v]) => ({
        sql: `INSERT INTO system_configs (key, value) VALUES ($1, $2)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        params: [k, JSON.stringify(v)]
      }));
    if (ops.length === 0) return safeJson(res, { ok: true, updated: 0 });
    const txResult = await db.transaction(ops);
    safeJson(res, { ok: !!(txResult && txResult.ok), updated: ops.length });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Room Reconciliation ──────────────────────────────────────────────────────
// POST /api/rooms/reconcile — corrects stale OC rooms with no active checked-in guest
app.post('/api/rooms/reconcile', async (req, res) => {
  try {
    // Rooms with OC/OD status but no matching checked-in reservation → set VD
    const staleResult = await db.query(
      `UPDATE rooms r SET status = 'VD', updated_at = NOW()
       WHERE r.status IN ('OC','OD')
         AND NOT EXISTS (
           SELECT 1 FROM reservations res
           WHERE res.room_id = r.id AND res.status = 'checked-in'
         )
       RETURNING id, number, status`
    );
    const fixed = staleResult.ok ? (staleResult.rows || []) : [];
    safeJson(res, { ok: true, fixed, count: fixed.length });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Schema Init ──────────────────────────────────────────────────────────────
app.get('/api/setup/init-db', async (req, res) => {
  const { key, reset } = req.query;
  if (key !== 'confirm') return res.status(400).send('<h1>Use ?key=confirm</h1>');
  try {
    const fs = require('fs');
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    if (!fs.existsSync(schemaPath)) return res.status(500).send('Schema file missing');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    if (reset === 'true') {
      await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
    }
    const result = await db.exec(sql);
    if (result.ok) res.send('<h1>✅ Database Initialized!</h1>');
    else res.status(500).send(`<h1>❌ Error</h1><pre>${result.error}</pre>`);
  } catch (e) {
    res.status(500).send(`<h1>❌ Exception</h1><pre>${e.message}</pre>`);
  }
});

// ─── Products (POS + Inventory) ───────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const { department, active, category } = req.query;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];
    if (department) { sql += ' AND LOWER(department) = LOWER($' + (params.length+1) + ')'; params.push(department); }
    if (active !== undefined) { sql += ' AND active = $' + (params.length+1); params.push(active === 'true'); }
    if (category) { sql += ' AND LOWER(category) = LOWER($' + (params.length+1) + ')'; params.push(category); }
    sql += ' ORDER BY name ASC';
    safeJson(res, await db.query(sql, params));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/products/stock', async (req, res) => {
  try {
    safeJson(res, await db.query('SELECT id, name, stock_level, reorder_level, unit FROM products WHERE is_stock_item = true ORDER BY name'));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!r.rows?.length) return res.status(404).json({ ok: false, error: 'Not found' });
    safeJson(res, { ok: true, row: r.rows[0] });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.post('/api/products', async (req, res) => {
  const b = req.body || {};
  if (!b.id || !b.name) return safeJson(res, { ok: false, error: 'id and name required' });
  try {
    const vis = JSON.stringify(b.visibility || { bar: true, restaurant: true });
    safeJson(res, await db.query(
      `INSERT INTO products (id, name, category, department, price, cost_price, stock_level, unit,
          active, visibility, bar_visibility, restaurant_visibility, is_stock_item, inserted_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, category=EXCLUDED.category, department=EXCLUDED.department,
         price=EXCLUDED.price, cost_price=EXCLUDED.cost_price, stock_level=EXCLUDED.stock_level,
         unit=EXCLUDED.unit, active=EXCLUDED.active, visibility=EXCLUDED.visibility,
         bar_visibility=EXCLUDED.bar_visibility, restaurant_visibility=EXCLUDED.restaurant_visibility,
         is_stock_item=EXCLUDED.is_stock_item, updated_at=NOW()`,
      [b.id, b.name, b.category||'general', b.department||'Restaurant', Number(b.price||0),
       Number(b.cost_price||0), Number(b.stock_level||0), b.unit||'units', b.active!==false,
       vis, b.bar_visibility!==false, b.restaurant_visibility!==false, b.is_stock_item!==false]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.put('/api/products/visibility', async (req, res) => {
  const { ids, bar, restaurant } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return safeJson(res, { ok: false, error: 'ids required' });
  try {
    const fields = []; const params = [];
    if (bar !== undefined) { fields.push(`bar_visibility = $${params.length+1}`); params.push(bar); }
    if (restaurant !== undefined) { fields.push(`restaurant_visibility = $${params.length+1}`); params.push(restaurant); }
    if (!fields.length) return safeJson(res, { ok: false, error: 'bar or restaurant required' });
    const ph = ids.map((_, i) => `$${params.length+i+1}`).join(',');
    params.push(...ids);
    safeJson(res, await db.query(`UPDATE products SET ${fields.join(',')}, updated_at=NOW() WHERE id IN (${ph})`, params));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  const allowed = ['name','category','department','price','cost_price','stock_level','unit',
                   'active','visibility','bar_visibility','restaurant_visibility','is_stock_item',
                   'category_id','sub_id','notes','reorder_level'];
  const fields = []; const vals = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      const v = (f === 'visibility' && typeof req.body[f] !== 'string') ? JSON.stringify(req.body[f]) : req.body[f];
      fields.push(`${f} = $${vals.length+1}`); vals.push(v);
    }
  }
  if (!fields.length) return safeJson(res, { ok: false, error: 'No fields to update' });
  vals.push(req.params.id);
  try { safeJson(res, await db.query(`UPDATE products SET ${fields.join(',')}, updated_at=NOW() WHERE id = $${vals.length}`, vals)); }
  catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.delete('/api/products', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return safeJson(res, { ok: false, error: 'ids required' });
  try {
    const ph = ids.map((_, i) => `$${i+1}`).join(',');
    safeJson(res, await db.transaction([
      { sql: `DELETE FROM products WHERE id IN (${ph})`, params: ids },
      { sql: `DELETE FROM inventory_items WHERE id IN (${ph})`, params: ids },
      { sql: `DELETE FROM menu_items WHERE id IN (${ph})`, params: ids },
    ]));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  const id = req.params.id;
  try {
    safeJson(res, await db.transaction([
      { sql: 'DELETE FROM products WHERE id = $1', params: [id] },
      { sql: 'DELETE FROM inventory_items WHERE id = $1', params: [id] },
      { sql: 'DELETE FROM menu_items WHERE id = $1', params: [id] },
    ]));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.patch('/api/products/:id/stock', async (req, res) => {
  const { delta, reason, user_id } = req.body || {};
  if (delta === undefined) return safeJson(res, { ok: false, error: 'delta required' });
  try {
    safeJson(res, await db.transaction([
      { sql: 'UPDATE products SET stock_level = GREATEST(0, stock_level + $1), updated_at=NOW() WHERE id=$2', params: [Number(delta), req.params.id] },
      { sql: `INSERT INTO inventory_movements (id, item_id, delta, reason, user_id, inserted_at) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,NOW())`, params: [req.params.id, Number(delta), reason||'adjustment', user_id||'system'] }
    ]));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── POS Shifts ───────────────────────────────────────────────────────────────
app.get('/api/pos/shifts', async (req, res) => {
  try {
    const { date, status } = req.query;
    let sql = 'SELECT * FROM pos_shifts WHERE 1=1';
    const params = [];
    if (date) { sql += ' AND business_date = $' + (params.length+1); params.push(date); }
    if (status) { sql += ' AND status = $' + (params.length+1); params.push(status); }
    sql += ' ORDER BY opened_at DESC LIMIT 100';
    safeJson(res, await db.query(sql, params));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/pos/shifts/active', async (req, res) => {
  try {
    const { user_id } = req.query;
    let sql = "SELECT * FROM pos_shifts WHERE status='open'";
    const params = [];
    if (user_id) { sql += ' AND opened_by=$1'; params.push(user_id); }
    sql += ' ORDER BY opened_at DESC LIMIT 1';
    safeJson(res, await db.query(sql, params));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.post('/api/pos/shifts', async (req, res) => {
  const { id, opened_by, opening_cash, outlet } = req.body || {};
  if (!id || !opened_by) return safeJson(res, { ok: false, error: 'id and opened_by required' });
  try {
    const sn = await db.query('SELECT COALESCE(MAX(shift_number),0)+1 as next FROM pos_shifts WHERE business_date=CURRENT_DATE');
    const n = sn.rows?.[0]?.next || 1;
    safeJson(res, await db.query(
      `INSERT INTO pos_shifts (id,outlet,shift_number,business_date,opened_by,opening_cash,status,inserted_at,updated_at)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,'open',NOW(),NOW())`,
      [id, outlet||'Restaurant', n, opened_by, Number(opening_cash||0)]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.put('/api/pos/shifts/:id/close', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  try {
    safeJson(res, await db.query(
      `UPDATE pos_shifts SET status='closed',closed_at=NOW(),closed_by=$1,closing_cash=$2,
       total_sales=$3,total_cash=$4,total_card=$5,total_room_charge=$6,transaction_count=$7,updated_at=NOW()
       WHERE id=$8`,
      [b.closed_by, Number(b.closing_cash||0), Number(b.total_sales||0), Number(b.total_cash||0),
       Number(b.total_card||0), Number(b.total_room_charge||0), Number(b.transaction_count||0), id]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.put('/api/pos/shifts/:id/totals', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  try {
    safeJson(res, await db.query(
      `UPDATE pos_shifts SET total_sales=$1,total_cash=$2,total_card=$3,total_room_charge=$4,transaction_count=$5,updated_at=NOW()
       WHERE id=$6 AND status='open'`,
      [Number(b.total_sales||0), Number(b.total_cash||0), Number(b.total_card||0),
       Number(b.total_room_charge||0), Number(b.tx_count||0), id]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.post('/api/pos/orders', async (req, res) => {
  const b = req.body || {};
  if (!b.id) return safeJson(res, { ok: false, error: 'id required' });
  try {
    safeJson(res, await db.query(
      `INSERT INTO pos_orders (id,items,total_amount,status,outlet,shift_id,payment_method,business_date,table_number,guest_id,opened_by,closed_by,updated_at,created_at)
       VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET items=EXCLUDED.items,total_amount=EXCLUDED.total_amount,status=EXCLUDED.status,payment_method=EXCLUDED.payment_method,closed_by=EXCLUDED.closed_by,updated_at=NOW()`,
      [b.id, JSON.stringify(b.items||[]), Number(b.total_amount||0), b.status||'open',
       b.outlet||'Restaurant', b.shift_id||null, b.payment_method||null,
       b.business_date||new Date().toISOString().slice(0,10), b.table_number||null,
       b.guest_id||null, b.opened_by||null, b.closed_by||null]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/pos/reports/daily', async (req, res) => {
  try {
    const { date } = req.query;
    const d = date || new Date().toISOString().slice(0,10);
    safeJson(res, await db.query(
      `SELECT COUNT(*) as order_count, SUM(total_amount) as gross_sales, outlet, payment_method
       FROM pos_orders WHERE status='closed' AND business_date=$1
       GROUP BY outlet, payment_method ORDER BY outlet, payment_method`,
      [d]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Voids & Deleted Items Report ────────────────────────────────────────────
// GET /api/pos/voids?shift_id=X&date=YYYY-MM-DD
// Returns all void log entries from DB. Populated by the frontend void_log
// localStorage flush on shift end, and by the server-side POS void endpoint.
app.get('/api/pos/voids', async (req, res) => {
  const { shift_id, date, limit = 200 } = req.query;
  try {
    let sql = `SELECT v.*, p.name as product_name, p.price as product_price
               FROM pos_void_log v
               LEFT JOIN products p ON p.id = v.item_id
               WHERE 1=1`;
    const params = [];
    if (shift_id) { sql += ` AND v.shift_id = $${params.length+1}`; params.push(shift_id); }
    if (date)     { sql += ` AND v.voided_at::date = $${params.length+1}::date`; params.push(date); }
    sql += ` ORDER BY v.voided_at DESC LIMIT $${params.length+1}`;
    params.push(Number(limit));
    const result = await db.query(sql, params);
    if (!result.ok && result.error?.includes('does not exist')) {
      // Table not yet created — return empty with a flag so UI can auto-init
      return safeJson(res, { ok: true, rows: [], tableNotReady: true });
    }
    safeJson(res, { ok: true, rows: result.rows || [] });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/pos/voids — flush void log entries from localStorage to DB
app.post('/api/pos/voids', async (req, res) => {
  const { entries } = req.body || {};
  if (!Array.isArray(entries) || entries.length === 0) {
    return safeJson(res, { ok: true, inserted: 0 });
  }
  try {
    // Ensure table exists (idempotent)
    await db.exec(`CREATE TABLE IF NOT EXISTS public.pos_void_log (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      item_id     TEXT,
      item_name   TEXT,
      table_id    TEXT,
      bill_id     TEXT,
      shift_id    TEXT,
      authorized_by TEXT,
      voided_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    let inserted = 0;
    for (const e of entries) {
      try {
        await db.query(
          `INSERT INTO pos_void_log (item_id, item_name, table_id, bill_id, shift_id, authorized_by, voided_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [e.itemId||null, e.itemName||null, e.tableId||null, e.billId||null,
           e.shiftId||null, e.authorizedBy||'manager-pin',
           e.timestamp ? new Date(e.timestamp).toISOString() : new Date().toISOString()]
        );
        inserted++;
      } catch { /* skip bad entry */ }
    }
    safeJson(res, { ok: true, inserted });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Night Audit Manual Run (Vercel/serverless — triggered by admin UI) ──────
// POST /api/night-audit/run  { date: 'YYYY-MM-DD' }
// Runs a single night audit for the given date: posts room charges, saves run record.
app.post('/api/night-audit/run', async (req, res) => {
  const { date } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return safeJson(res, { ok: false, error: 'date (YYYY-MM-DD) required' });
  }
  try {
    // Guard: don't run twice for the same date
    const existing = await db.query(
      `SELECT id FROM night_audit_runs WHERE business_date::date = $1::date AND status='completed' LIMIT 1`, [date]
    );
    if (existing.ok && existing.rows?.length) {
      return safeJson(res, { ok: true, skipped: true, message: `Audit for ${date} already exists` });
    }

    // Gather occupied rooms for the date
    const roomsRes = await db.query(
      `SELECT r.id, r.number, r.rate, r.type, r.status
       FROM rooms r WHERE r.is_active IS DISTINCT FROM false`
    );
    const rooms = roomsRes.ok ? roomsRes.rows || [] : [];
    const occupied = rooms.filter(r => ['OC','OD','OCC','occupied'].includes(String(r.status||'').toUpperCase().replace('UPY','')) || String(r.status||'').toLowerCase().includes('occ'));

    // Post room charges to checked-in folios
    let roomsPosted = 0;
    for (const room of occupied) {
      try {
        const folioRes = await db.query(
          `SELECT f.id FROM folios f
           JOIN reservations res ON res.id = f.reservation_id
           WHERE res.room_id = $1 AND res.status='checked-in' AND f.status='open' LIMIT 1`,
          [room.id]
        );
        if (folioRes.ok && folioRes.rows?.length) {
          const folioId = folioRes.rows[0].id;
          const chargeId = `rc_${date.replace(/-/g,'')}_${room.id.slice(-6)}`;
          await db.query(
            `INSERT INTO folio_charges (id,folio_id,category,description,amount,quantity,unit_price,business_date,posted_at)
             VALUES ($1,$2,'Room Rate','Room Rate - Night Audit',$3,1,$4,$5::date,NOW())
             ON CONFLICT (id) DO NOTHING`,
            [chargeId, folioId, Number(room.rate||0), Number(room.rate||0), date]
          );
          roomsPosted++;
        }
      } catch { /* per-room failure is non-fatal */ }
    }

    // Compute totals
    const totalOccupied = occupied.length;
    const totalAvailable = rooms.filter(r => !['OOO','OOS'].includes(String(r.status||'').toUpperCase())).length;
    const roomRevenue = occupied.reduce((s, r) => s + Number(r.rate || 0), 0);
    const occupancyPct = totalAvailable > 0 ? ((totalOccupied / totalAvailable) * 100) : 0;
    const adr = totalOccupied > 0 ? roomRevenue / totalOccupied : 0;
    const revpar = totalAvailable > 0 ? roomRevenue / totalAvailable : 0;

    // POS revenue for the date
    const posRes = await db.query(
      `SELECT COALESCE(SUM(total_amount),0) as pos_rev FROM pos_orders WHERE business_date::date=$1::date AND status='closed'`, [date]
    );
    const posRevenue = posRes.ok ? Number(posRes.rows?.[0]?.pos_rev || 0) : 0;
    const totalRevenue = roomRevenue + posRevenue;

    // Advance business date — but CLAMP so it never runs ahead of the real
    // server date. A manual run for a future date previously pushed
    // business_date to e.g. 2026-06-02, silently breaking the night-audit
    // catch-up. We cap nextDate at CURRENT_DATE.
    const nextDate = new Date(date); nextDate.setDate(nextDate.getDate() + 1);
    let nextDateStr = nextDate.toISOString().split('T')[0];
    try {
      const nowRes = await db.query(`SELECT CURRENT_DATE::text AS d`);
      const serverToday = nowRes.ok && nowRes.rows?.length ? nowRes.rows[0].d : null;
      if (serverToday && nextDateStr > serverToday) {
        nextDateStr = serverToday; // never advance past today
      }
    } catch { /* if clock check fails, fall through with computed nextDate */ }
    await db.query(
      `INSERT INTO system_configs (key,value) VALUES ('business_date',$1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [JSON.stringify({ date: nextDateStr })]
    );

    // Build reports_snapshot (same shape NightAuditReports.tsx reads from DB)
    const snapshot = {
      date,
      roomRevenue,
      fbRevenue: posRevenue,
      totalRevenue,
      occupancy: occupancyPct,
      avgDailyRate: adr,
      revPAR: revpar,
      postingsCount: roomsPosted,
      cityLedgerCount: 0
    };

    // Record audit run — three bugs fixed here:
    // BUG-A: next_business_date (NOT NULL) was missing → PostgreSQL violation → silent false-positive
    // BUG-B: ON CONFLICT (id) was wrong — id is random; real UNIQUE key is business_date
    // BUG-C: reports_snapshot was absent → Reports summary showed empty data even if row existed
    // BUG-D: INSERT result was never checked — db.query() returns {ok:false} not throws on error
    const insertResult = await db.query(
      `INSERT INTO night_audit_runs
         (id,business_date,next_business_date,status,rooms_posted,occupied_rooms,available_rooms,
          room_revenue,total_revenue,occupancy_percent,adr,revpar,
          run_by,started_at,completed_at,reports_snapshot,inserted_at)
       VALUES (gen_random_uuid(),$1::date,$2::date,'completed',$3,$4,$5,$6,$7,$8,$9,$10,
               'catch_up_manual',$1::date,NOW(),$11::jsonb,NOW())
       ON CONFLICT (business_date) DO NOTHING
       RETURNING id`,
      [date, nextDateStr, roomsPosted, totalOccupied, totalAvailable,
       roomRevenue, totalRevenue, occupancyPct, adr, revpar, JSON.stringify(snapshot)]
    );

    // BUG-D fix: explicitly check INSERT result and surface errors
    if (!insertResult.ok) {
      console.error(`[night-audit/run] INSERT failed for ${date}:`, insertResult.error);
      return safeJson(res, { ok: false, error: `Failed to record audit for ${date}: ${insertResult.error}` });
    }

    const inserted = insertResult.rows?.length > 0;
    safeJson(res, { ok: true, date, roomsPosted, roomRevenue, fbRevenue: posRevenue, totalRevenue, occupancyPct: occupancyPct.toFixed(1), nextBusinessDate: nextDateStr, recorded: inserted, skipped: !inserted });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Night Audit (simplified for Vercel — no SSE/file system) ────────────────
app.get('/api/night-audit/status', async (req, res) => {
  try {
    const lastRun = await db.query(
      `SELECT business_date, business_date::date::text as business_date_str,
              total_revenue, rooms_posted, status, completed_at
       FROM night_audit_runs WHERE status='completed' ORDER BY business_date DESC LIMIT 1`
    );
    const bizDateRow = await db.query(`SELECT value FROM system_configs WHERE key='business_date'`);

    // ISSUE 3 FIX: Parse businessDate robustly — value is stored as JSON {date:'YYYY-MM-DD'}
    let businessDate = null;
    try {
      const raw = bizDateRow.rows?.[0]?.value;
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        businessDate = parsed?.date || parsed || null;
      }
    } catch { businessDate = bizDateRow.rows?.[0]?.value || null; }

    // Normalize lastRun.business_date to string for frontend consumption
    const lastRunRow = lastRun.ok && lastRun.rows?.length ? lastRun.rows[0] : null;
    if (lastRunRow) {
      lastRunRow.business_date = lastRunRow.business_date_str || String(lastRunRow.business_date || '').slice(0, 10);
    }

    safeJson(res, {
      ok: true, locked: false, step: null, progress: 0,
      businessDate,
      lastRun: lastRunRow,
      // Signal to frontend if business_date was never initialized (new property)
      needsInitialization: !businessDate && !lastRunRow,
      // Warn the frontend if the stored business_date is ahead of the real calendar date
      dateIsAhead: businessDate ? businessDate > new Date().toISOString().split('T')[0] : false
    });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/night-audit/repair-date
// Resets system_configs.business_date to today (or the last completed audit date + 1,
// whichever is earlier) when the date has drifted into the future.
app.post('/api/night-audit/repair-date', async (req, res) => {
  try {
    const todayReal = new Date().toISOString().split('T')[0];
    const lastRun = await db.query(
      `SELECT business_date::date::text as d FROM night_audit_runs WHERE status='completed' ORDER BY business_date DESC LIMIT 1`
    );
    let correctDate = todayReal;
    if (lastRun.ok && lastRun.rows?.length) {
      const lastAuditDate = lastRun.rows[0].d;
      const dayAfterLast = new Date(lastAuditDate);
      dayAfterLast.setDate(dayAfterLast.getDate() + 1);
      const dayAfterLastStr = dayAfterLast.toISOString().split('T')[0];
      // Use whichever is earlier: day-after-last-audit or today
      correctDate = dayAfterLastStr < todayReal ? dayAfterLastStr : todayReal;
    }
    await db.query(
      `INSERT INTO system_configs (key,value) VALUES ('business_date',$1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [JSON.stringify({ date: correctDate })]
    );
    safeJson(res, { ok: true, repaired: true, businessDate: correctDate });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});


app.get('/api/night-audit/reports', async (req, res) => {
  try {
    const dbResult = await db.query(
      `SELECT business_date::date::text as date,
              room_revenue, total_revenue, occupancy_percent, adr, revpar,
              rooms_posted, reports_snapshot
       FROM night_audit_runs
       WHERE status='completed'
       ORDER BY business_date DESC
       LIMIT 90`
    );
    const dbRuns = dbResult.ok && dbResult.rows ? dbResult.rows : [];
    const syntheticFiles = ['front_office_report.txt','fnb_report.txt','reconciliation_report.txt','full_report.json'];
    const result = dbRuns.map(run => ({
      date: run.date,
      files: syntheticFiles,
      fromDb: true,
      dbRun: run
    }));
    safeJson(res, { ok: true, reports: result });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/night-audit/reports/:date/:file', async (req, res) => {
  const { date, file } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[\w_.-]+$/.test(file)) {
    return res.status(400).json({ ok: false, error: 'Invalid path' });
  }
  try {
    const dbResult = await db.query(
      `SELECT business_date::date::text as date, room_revenue, total_revenue,
              occupancy_percent, adr, revpar, rooms_posted, occupied_rooms,
              available_rooms, tax_revenue, reports_snapshot, completed_at
       FROM night_audit_runs WHERE business_date::date = $1::date LIMIT 1`,
      [date]
    );
    if (!dbResult.ok || !dbResult.rows?.length) {
      return res.status(404).send(`No audit data for ${date}`);
    }
    const run = dbResult.rows[0];
    const snap = run.reports_snapshot || {};
    const fbRevenue = snap.fbRevenue !== undefined ? Number(snap.fbRevenue) : Number(run.total_revenue) - Number(run.room_revenue);
    const genTime = run.completed_at ? new Date(run.completed_at).toLocaleString() : date;
    const div = '════════════════════════════════════════════════════════════';
    const sub = '────────────────────────────────────────────────────────────';
    let content = '';

    if (file === 'front_office_report.txt') {
      content = `${div}\n  FRONT OFFICE NIGHT AUDIT REPORT\n  Business Date : ${date}\n  Generated     : ${genTime}\n${div}\n\nROOM OCCUPANCY\n${sub}\n  Occupied Rooms   : ${run.occupied_rooms || 0}\n  Available Rooms  : ${run.available_rooms || 13}\n  Occupancy %      : ${Number(run.occupancy_percent || 0).toFixed(1)}%\n\nROOM REVENUE\n${sub}\n  Room Revenue     : $${Number(run.room_revenue || 0).toFixed(2)}\n  Tax Revenue      : $${Number(run.tax_revenue || 0).toFixed(2)}\n  ADR              : $${Number(run.adr || 0).toFixed(2)}\n  RevPAR           : $${Number(run.revpar || 0).toFixed(2)}\n\n${div}\n  END OF FRONT OFFICE REPORT\n${div}\n`;
    } else if (file === 'fnb_report.txt') {
      content = `${div}\n  FOOD & BEVERAGE NIGHT AUDIT REPORT\n  Business Date : ${date}\n  Generated     : ${genTime}\n${div}\n\nPOS / F&B REVENUE\n${sub}\n  F&B Revenue : $${Number(fbRevenue).toFixed(2)}\n\n${div}\n  END OF F&B REPORT\n${div}\n`;
    } else if (file === 'reconciliation_report.txt') {
      content = `${div}\n  NIGHT AUDIT RECONCILIATION\n  Business Date : ${date}\n  Generated     : ${genTime}\n${div}\n\nREVENUE SUMMARY\n${sub}\n  Room Revenue   : $${Number(run.room_revenue || 0).toFixed(2)}\n  Tax Revenue    : $${Number(run.tax_revenue || 0).toFixed(2)}\n  F&B Revenue    : $${Number(fbRevenue).toFixed(2)}\n  TOTAL          : $${Number(run.total_revenue || 0).toFixed(2)}\n\n${div}\n  END OF RECONCILIATION REPORT\n${div}\n`;
    } else if (file === 'full_report.json') {
      res.setHeader('Content-Type', 'application/json');
      return res.json({ businessDate: date, generatedAt: new Date().toISOString(), ...run, fbRevenue });
    } else {
      return res.status(404).send(`Unknown report file: ${file}`);
    }
    res.setHeader('Content-Type', 'text/plain');
    res.send(content);
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/night-audit/history', async (req, res) => {
  try {
    const { limit = 30 } = req.query;
    safeJson(res, await db.query(
      `SELECT business_date, rooms_posted, room_revenue, total_revenue,
              occupied_rooms, occupancy_percent, adr, revpar, status, completed_at
       FROM night_audit_runs ORDER BY business_date DESC LIMIT $1`,
      [Number(limit)]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// Night audit backfill (same as server/routes/nightAuditApi.cjs but simplified)
app.post('/api/night-audit/backfill', async (req, res) => {
  const { date, force } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return safeJson(res, { ok: false, error: 'date required YYYY-MM-DD' });
  try {
    const existing = await db.query(`SELECT id,status FROM night_audit_runs WHERE business_date::date=$1::date`, [date]);
    if (existing.ok && existing.rows?.length && !force) {
      return safeJson(res, { ok: false, error: `Audit exists for ${date}. Pass force:true to overwrite.` });
    }
    const reservRes = await db.query(
      `SELECT ro.number, COALESCE(NULLIF(r.rate::numeric,0), ro.rate, 0) as rate,
              r.id as reservation_id, r.guest_id,
              COALESCE(g.full_name, r.booking_name, 'Unknown') as guest_name
       FROM reservations r JOIN rooms ro ON ro.id=r.room_id
       LEFT JOIN guests g ON g.id=r.guest_id
       WHERE r.check_in_date<=$1::date AND r.check_out_date>$1::date AND r.status IN ('checked-in','checked-out')`,
      [date]
    );
    const rsvs = reservRes.ok ? reservRes.rows : [];
    const totalRooms = 13;
    let roomRevenue = 0; let taxRevenue = 0; const charges = [];
    for (const room of rsvs) {
      const rate = Number(room.rate || 0);
      const tax = Number((rate * (0.15/1.15)).toFixed(2));
      roomRevenue += rate; taxRevenue += tax;
      charges.push({ room: room.number, guest: room.guest_name, rate, tax });
    }
    const occupiedRooms = rsvs.length;
    const posRes = await db.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM pos_orders WHERE status='closed' AND created_at::date=$1::date`, [date]);
    const posRevenue = Number(posRes.ok ? posRes.rows[0]?.total || 0 : 0);
    const totalRevenue = roomRevenue + posRevenue;
    const occupancyPct = Number(((occupiedRooms/totalRooms)*100).toFixed(2));
    const adr = occupiedRooms > 0 ? Number((roomRevenue/occupiedRooms).toFixed(2)) : 0;
    const revpar = Number((roomRevenue/totalRooms).toFixed(2));
    const d = new Date(date+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+1);
    const nextDate = d.toISOString().slice(0,10);
    const snapshot = { fbRevenue: posRevenue, occupiedRooms, availableRooms: totalRooms, charges, backfilled: true };
    let auditId;
    if (existing.ok && existing.rows?.length && force) {
      const upRes = await db.query(
        `UPDATE night_audit_runs SET rooms_posted=$2,room_revenue=$3,tax_revenue=$4,total_revenue=$5,
         occupied_rooms=$6,available_rooms=$7,occupancy_percent=$8,adr=$9,revpar=$10,
         status='completed',run_by='BACKFILL_SYSTEM',completed_at=NOW(),reports_snapshot=$11::jsonb,next_business_date=$12::date
         WHERE business_date::date=$1::date RETURNING id`,
        [date,occupiedRooms,roomRevenue,taxRevenue,totalRevenue,occupiedRooms,totalRooms,occupancyPct,adr,revpar,JSON.stringify(snapshot),nextDate]
      );
      auditId = upRes.ok ? upRes.rows[0]?.id : null;
    } else {
      const insRes = await db.query(
        `INSERT INTO night_audit_runs (id,business_date,next_business_date,rooms_posted,room_revenue,tax_revenue,total_revenue,city_ledger_transfers,city_ledger_amount,occupied_rooms,available_rooms,occupancy_percent,adr,revpar,status,run_by,started_at,completed_at,reports_snapshot,inserted_at)
         VALUES (gen_random_uuid(),$1::date,$2::date,$3,$4,$5,$6,0,0,$7,$8,$9,$10,$11,'completed','BACKFILL_SYSTEM',$1::date,NOW(),$12::jsonb,NOW()) ON CONFLICT DO NOTHING RETURNING id`,
        [date,nextDate,occupiedRooms,roomRevenue,taxRevenue,totalRevenue,occupiedRooms,totalRooms,occupancyPct,adr,revpar,JSON.stringify(snapshot)]
      );
      auditId = insRes.ok ? insRes.rows[0]?.id : null;
    }
    safeJson(res, { ok: true, message: `Audit backfilled for ${date}`, auditId, summary: { date, occupiedRooms, roomRevenue, taxRevenue, posRevenue, totalRevenue, occupancyPct, adr, revpar }, charges });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Inventory Periods ────────────────────────────────────────────────────────
app.get('/api/inventory/periods', async (req, res) => {
  try { safeJson(res, await db.query('SELECT * FROM inventory_periods ORDER BY period_year DESC, period_month DESC')); }
  catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.post('/api/inventory/periods', async (req, res) => {
  const { period_name, period_year, period_month, start_date, end_date, status, opening_stock_value, created_by } = req.body || {};
  if (!period_name || !period_year || !period_month || !start_date || !end_date)
    return safeJson(res, { ok: false, error: 'Missing required fields' });
  try {
    const openCheck = await db.query("SELECT id FROM inventory_periods WHERE status IN ('open','reconciling') LIMIT 1");
    if (openCheck.rows?.length) return res.status(409).json({ ok: false, error: 'Another period is already open.' });
    safeJson(res, await db.query(
      `INSERT INTO inventory_periods (period_name,period_year,period_month,start_date,end_date,status,opening_stock_value,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [period_name, period_year, period_month, start_date, end_date, status||'open', opening_stock_value||0, created_by]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.put('/api/inventory/periods/:id', async (req, res) => {
  // Parity with Villa Gianni — same 14 allowed fields (added: reopened_at, reopened_by, is_locked, locked_at, locked_by)
  const allowed = ['period_name','status','closing_stock_value','variance_value','cogs_value','kitchen_cogs','cellar_cogs','closed_by','closed_reason','reopened_at','reopened_by','is_locked','locked_at','locked_by'];
  const fields = []; const vals = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) { fields.push(`${f}=$${vals.length+1}`); vals.push(req.body[f]); }
  }
  if (!fields.length) return safeJson(res, { ok: false, error: 'No fields to update' });
  vals.push(req.params.id);
  try { safeJson(res, await db.query(`UPDATE inventory_periods SET ${fields.join(',')},updated_at=NOW() WHERE id=$${vals.length}`, vals)); }
  catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/inventory/transactions', async (req, res) => {
  try {
    const { period_id, limit } = req.query;
    let sql = 'SELECT * FROM inventory_transactions WHERE is_deleted=false';
    const params = [];
    if (period_id) { sql += ` AND period_id=$${params.length+1}`; params.push(period_id); }
    sql += ' ORDER BY transaction_date DESC';
    if (limit) { sql += ` LIMIT $${params.length+1}`; params.push(parseInt(limit)); }
    safeJson(res, await db.query(sql, params));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.post('/api/inventory/transactions', async (req, res) => {
  const { transaction_type, transaction_number, period_id, transaction_date, department, total_quantity, total_value, supplier_name, created_by } = req.body || {};
  if (!transaction_type || !transaction_number || !transaction_date || !department)
    return safeJson(res, { ok: false, error: 'Missing required fields' });
  try {
    safeJson(res, await db.query(
      `INSERT INTO inventory_transactions (transaction_type,transaction_number,period_id,transaction_date,department,total_quantity,total_value,supplier_name,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [transaction_type,transaction_number,period_id,transaction_date,department,total_quantity||0,total_value||0,supplier_name,created_by]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/inventory/audit', async (req, res) => {
  try {
    const { period_id, limit } = req.query;
    let sql = 'SELECT * FROM inventory_period_audit';
    const params = [];
    if (period_id) { sql += ` WHERE period_id=$${params.length+1}`; params.push(period_id); }
    sql += ' ORDER BY timestamp DESC';
    if (limit) { sql += ` LIMIT $${params.length+1}`; params.push(parseInt(limit)); }
    safeJson(res, await db.query(sql, params));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Inventory Reconciliation — 3 endpoints matching Villa Gianni ─────────────

// POST /api/inventory/batch-reconcile
app.post('/api/inventory/batch-reconcile', async (req, res) => {
  const { period_id, user_id, items } = req.body || {};
  if (!period_id || !Array.isArray(items) || items.length === 0)
    return safeJson(res, { ok: false, error: 'period_id and items[] required' });
  try {
    const periodRes = await db.query(`SELECT status, is_locked FROM inventory_periods WHERE id=$1`, [period_id]);
    if (!periodRes.rows?.length) return res.status(404).json({ ok: false, error: 'Period not found' });
    const period = periodRes.rows[0];
    if (period.is_locked) return res.status(403).json({ ok: false, error: 'Period is locked' });
    if (period.status !== 'reconciling') return res.status(403).json({ ok: false, error: `Period must be in reconciling state, current: ${period.status}` });

    // Pre-fetch all products (reads outside transaction)
    const productIds = items.map(i => i.product_id).filter(Boolean);
    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
    const allProds = productIds.length > 0
      ? await db.query(`SELECT id, department, stock_level, cost_price FROM products WHERE id IN (${placeholders})`, productIds)
      : { rows: [] };
    const prodMap = Object.fromEntries((allProds.rows || []).map(p => [p.id, p]));

    const today = new Date().toISOString().split('T')[0];
    const ops = [];
    for (const item of items) {
      const { product_id, physical_qty, cost_price } = item;
      const physQty = Number(physical_qty) || 0;
      const product = prodMap[product_id];
      if (!product) continue;
      const bookQty = Number(product.stock_level || 0);
      const newCost = (cost_price != null) ? Number(cost_price) : Number(product.cost_price || 0);
      const variance = physQty - bookQty;
      const totalValue = variance * newCost;

      ops.push({ sql: `INSERT INTO inventory_snapshots (period_id,product_id,physical_qty,variance,opening_qty,received_qty,system_usage_qty) VALUES ($1,$2,$3,$4,0,0,0) ON CONFLICT (period_id,product_id) DO UPDATE SET physical_qty=EXCLUDED.physical_qty,variance=EXCLUDED.variance,updated_at=NOW()`, params: [period_id, product_id, physQty, variance] });
      if (variance !== 0) ops.push({ sql: `INSERT INTO inventory_transactions (transaction_type,transaction_number,period_id,transaction_date,department,total_quantity,total_value,created_by) VALUES ('adjustment',$1,$2,$3,$4,$5,$6,$7)`, params: [`BATCH-${Date.now()}-${String(product_id).slice(0,8)}`, period_id, today, product.department||'General', variance, totalValue, user_id||'system'] });
      if (cost_price != null) { ops.push({ sql: 'UPDATE products SET stock_level=$1,cost_price=$2,last_inventory_period_id=$3,last_physical_qty=$4,last_physical_date=NOW(),updated_at=NOW() WHERE id=$5', params: [physQty, newCost, period_id, physQty, product_id] }); }
      else { ops.push({ sql: 'UPDATE products SET stock_level=$1,last_inventory_period_id=$2,last_physical_qty=$3,last_physical_date=NOW(),updated_at=NOW() WHERE id=$4', params: [physQty, period_id, physQty, product_id] }); }
    }
    if (ops.length > 0) {
      const txResult = await db.transaction(ops);
      if (!txResult.ok) throw new Error(txResult.error || 'Transaction failed');
    }
    safeJson(res, { ok: true, message: `Batch reconciled ${items.length} items` });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/inventory/close
app.post('/api/inventory/close', async (req, res) => {
  const { period_id, closed_by, closed_reason, manager_override } = req.body || {};
  if (!period_id || !closed_by) return safeJson(res, { ok: false, error: 'period_id and closed_by required' });
  try {
    const periodRes = await db.query(`SELECT * FROM inventory_periods WHERE id=$1`, [period_id]);
    if (!periodRes.rows?.length) return res.status(404).json({ ok: false, error: 'Period not found' });
    const period = periodRes.rows[0];
    if (period.is_locked) return res.status(403).json({ ok: false, error: 'Period already locked' });
    if (period.status !== 'reconciling') return res.status(403).json({ ok: false, error: `Period must be reconciling, current: ${period.status}` });

    const txCountRes = await db.query(`SELECT COUNT(*) as cnt FROM inventory_transactions WHERE period_id=$1 AND transaction_type IN ('purchase','grv')`, [period_id]);
    const txCount = Number(txCountRes.rows?.[0]?.cnt || 0);
    if (txCount === 0 && !manager_override) return res.status(403).json({ ok: false, error: 'ZERO_CAPTURE', message: 'No receipts found. Set manager_override:true to force close.' });

    const prodRes = await db.query(`SELECT id,name,department,stock_level,cost_price,last_physical_qty FROM products WHERE last_inventory_period_id=$1`, [period_id]);
    if (!prodRes.rows?.length) return res.status(400).json({ ok: false, error: 'No physical counts recorded. Perform a stock take first.' });

    let totalClosingValue = 0, totalVarianceValue = 0, kitchenVar = 0, cellarVar = 0;
    const today = new Date().toISOString().split('T')[0];
    const ops = [];
    for (const p of prodRes.rows) {
      const physQty = Number(p.last_physical_qty || 0);
      const variance = physQty - Number(p.stock_level || 0);
      const costPrice = Number(p.cost_price || 0);
      const varianceValue = variance * costPrice;
      totalClosingValue += physQty * costPrice;
      totalVarianceValue += varianceValue;
      if ((p.department||'').toLowerCase() === 'kitchen') kitchenVar += varianceValue;
      else if ((p.department||'').toLowerCase() === 'cellar') cellarVar += varianceValue;
      ops.push({ sql: `INSERT INTO inventory_snapshots (period_id,product_id,physical_qty,variance,opening_qty,received_qty,system_usage_qty) VALUES ($1,$2,$3,$4,0,0,0) ON CONFLICT (period_id,product_id) DO UPDATE SET physical_qty=EXCLUDED.physical_qty,variance=EXCLUDED.variance,updated_at=NOW()`, params: [period_id, p.id, physQty, variance] });
      if (variance !== 0) ops.push({ sql: `INSERT INTO inventory_transactions (transaction_type,transaction_number,period_id,transaction_date,department,total_quantity,total_value,created_by) VALUES ('adjustment',$1,$2,$3,$4,$5,$6,$7)`, params: [`CLS-${Date.now()}-${p.id.slice(0,8)}`, period_id, today, p.department||'General', variance, varianceValue, closed_by] });
      ops.push({ sql: 'UPDATE products SET stock_level=$1,updated_at=NOW() WHERE id=$2', params: [physQty, p.id] });
    }
    const cogsValue = Number(period.opening_stock_value||0) + Number(period.received_value||0) - totalClosingValue;
    ops.push({ sql: `UPDATE inventory_periods SET status='closed',closing_stock_value=$1,variance_value=$2,cogs_value=$3,kitchen_cogs=$4,cellar_cogs=$5,closed_at=NOW(),closed_by=$6,closed_reason=$7,is_locked=true,locked_at=NOW() WHERE id=$8`, params: [totalClosingValue, totalVarianceValue, cogsValue, kitchenVar, cellarVar, closed_by, closed_reason||'', period_id] });
    if (txCount === 0 && manager_override) ops.push({ sql: `INSERT INTO inventory_period_audit (period_id,action,user_id,user_name,change_reason) VALUES ($1,'ZERO_CAPTURE_OVERRIDE',$2,$3,$4)`, params: [period_id, closed_by, closed_by, 'Manager override: zero receipts'] });

    const txResult = await db.transaction(ops);
    if (!txResult.ok) throw new Error(txResult.error || 'Transaction failed');
    safeJson(res, { ok: true, message: 'Period closed', closing_stock_value: totalClosingValue, variance_value: totalVarianceValue, cogs_value: cogsValue });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/inventory/reopen
app.post('/api/inventory/reopen', async (req, res) => {
  const { period_id, reopened_by } = req.body || {};
  if (!period_id) return safeJson(res, { ok: false, error: 'period_id required' });
  try {
    const periodRes = await db.query(`SELECT * FROM inventory_periods WHERE id=$1`, [period_id]);
    if (!periodRes.rows?.length) return res.status(404).json({ ok: false, error: 'Period not found' });
    if (!periodRes.rows[0].is_locked) return res.status(400).json({ ok: false, error: 'Period is not locked and cannot be reopened' });

    const ops = [
      { sql: `UPDATE inventory_periods SET status='open',closed_at=NULL,closed_by=NULL,closed_reason=NULL,is_locked=false,locked_at=NULL,locked_by=NULL,reopened_at=NOW(),reopened_by=$1 WHERE id=$2`, params: [reopened_by||'system', period_id] },
      { sql: `INSERT INTO inventory_period_audit (period_id,action,user_id,user_name,change_reason) VALUES ($1,'PERIOD_REOPENED',$2,$3,$4)`, params: [period_id, reopened_by||'system', reopened_by||'system', 'Period reopened for correction'] }
    ];
    const txResult = await db.transaction(ops);
    if (!txResult.ok) throw new Error(txResult.error);
    safeJson(res, { ok: true, message: 'Period reopened successfully' });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Reports ──────────────────────────────────────────────────────────────────
app.get('/api/reports/flash', async (req, res) => {
  const { date } = req.query;
  try {
    const r = await db.query(`SELECT * FROM night_audit_runs WHERE business_date=$1`, [date]);
    if (r.rows?.length) safeJson(res, { ok: true, data: r.rows[0].reports_snapshot, ...r.rows[0] });
    else safeJson(res, { ok: false, error: 'No data for date' });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/reports/night-audit-runs', async (req, res) => {
  const { start_date, end_date } = req.query;
  try {
    safeJson(res, await db.query(
      `SELECT * FROM night_audit_runs WHERE business_date>=$1 AND business_date<=$2 ORDER BY business_date DESC`,
      [start_date, end_date]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

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

// GET /api/reports/aged-ar?as_of=YYYY-MM-DD
// City ledger aging: returns each outstanding transaction (debit>credit) with its
// age bucket (0-30/31-60/61-90/90+). The frontend renders one row per transaction.
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

// ─── Printer status (no real printer on Vercel) ───────────────────────────────
app.get('/api/printer/status', (req, res) => {
  safeJson(res, { connected: true, method: 'browser', lastCheck: new Date().toISOString() });
});

// ─── SSE Stub — Vercel can't hold persistent SSE connections ─────────────────
// Return a valid SSE response that immediately closes. The client (useNightAuditLock)
// will fall back to polling on Vercel automatically (host.includes('vercel.app')).
app.get('/api/night-audit/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'close'); // Signal immediate close
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Send one heartbeat then close — client detects close and falls back to polling
  res.write(': Vercel serverless — SSE not supported, use polling\n\n');
  res.end();
});

// ─── WebSocket price sync — not supported on Vercel, return 200 JSON ─────────
// This prevents the 404 → the client detects non-WS response and skips gracefully
app.get('/api/v1/prices/sync', (req, res) => {
  safeJson(res, { ok: false, error: 'WebSocket not supported on Vercel. Use HTTP polling.' });
});

// ─── Rooms — serve from DB ────────────────────────────────────────────────────
app.get('/api/rooms', async (req, res) => {
  try {
    safeJson(res, await db.query('SELECT * FROM rooms WHERE is_active IS DISTINCT FROM false ORDER BY number'));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Reservations ─────────────────────────────────────────────────────────────
app.get('/api/reservations', async (req, res) => {
  try {
    safeJson(res, await db.query(
      `SELECT r.*, g.full_name as guest_name, ro.number as room_number
       FROM reservations r
       LEFT JOIN guests g ON r.guest_id = g.id
       LEFT JOIN rooms ro ON r.room_id = ro.id
       ORDER BY r.check_in_date DESC LIMIT 500`
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Guests ───────────────────────────────────────────────────────────────────
app.get('/api/guests', async (req, res) => {
  try {
    safeJson(res, await db.query('SELECT * FROM guests ORDER BY full_name LIMIT 500'));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Folio Charges ────────────────────────────────────────────────────────────
app.get('/api/folio-charges', async (req, res) => {
  try {
    safeJson(res, await db.query(
      'SELECT * FROM folio_charges WHERE is_voided=false ORDER BY posting_date DESC, inserted_at DESC LIMIT 1000'
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Folios ───────────────────────────────────────────────────────────────────
app.get('/api/folios', async (req, res) => {
  try {
    safeJson(res, await db.query("SELECT * FROM folios WHERE status IN ('open','pending') ORDER BY inserted_at DESC"));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Users API ────────────────────────────────────────────────────────────────
// Dedicated endpoint so User Management doesn't rely solely on raw SQL passthrough

// GET /api/users — list all non-deleted users
app.get('/api/users', async (req, res) => {
  try {
    // Use IS NOT TRUE to safely handle NULL is_deleted values (fresh DB migrations)
    const result = await db.query(
      `SELECT id, username, name, email, role, active, created_at, last_login,
              last_activity, permissions, two_factor_enabled, is_deleted
       FROM app_users
       WHERE is_deleted IS NOT TRUE
       ORDER BY username ASC`
    );
    safeJson(res, result);
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// GET /api/users/:id — get single user
app.get('/api/users/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, name, email, role, active, created_at, last_login,
              last_activity, permissions, two_factor_enabled, is_deleted
       FROM app_users WHERE id = $1 AND is_deleted IS NOT TRUE`,
      [req.params.id]
    );
    if (!result.rows?.length) return res.status(404).json({ ok: false, error: 'User not found' });
    safeJson(res, { ok: true, user: result.rows[0] });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/users — create user (register)
app.post('/api/users', async (req, res) => {
  const { id, username, name, email, role, password_hash, active, password_change_required, permissions } = req.body || {};
  if (!id || !username || !password_hash) return safeJson(res, { ok: false, error: 'id, username, password_hash required' });
  try {
    const result = await db.query(
      `INSERT INTO app_users (id, username, name, email, role, password_hash, active, password_change_required, permissions, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
       ON CONFLICT (username) DO NOTHING RETURNING id`,
      [id, username, name||username, email||null, role||'staff', password_hash, active!==false, password_change_required||true, permissions||null]
    );
    if (!result.rows?.length) return safeJson(res, { ok: false, error: 'Username already exists' });
    safeJson(res, { ok: true, id: result.rows[0].id });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// PUT /api/users/:id — update user
app.put('/api/users/:id', async (req, res) => {
  const allowed = ['name','email','role','active','password_change_required','permissions','pos_pin','two_factor_enabled'];
  const fields = []; const vals = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      fields.push(`${f}=$${vals.length+1}`);
      vals.push(f === 'permissions' && Array.isArray(req.body[f]) ? req.body[f] : req.body[f]);
    }
  }
  if (!fields.length) return safeJson(res, { ok: false, error: 'No fields to update' });
  vals.push(req.params.id);
  try {
    safeJson(res, await db.query(`UPDATE app_users SET ${fields.join(',')},updated_at=NOW() WHERE id=$${vals.length} AND is_deleted IS NOT TRUE`, vals));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// DELETE /api/users/:id — soft delete (rename + mark deleted)
app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const userRes = await db.query('SELECT username, email FROM app_users WHERE id=$1', [id]);
    if (!userRes.rows?.length) return res.status(404).json({ ok: false, error: 'User not found' });
    const { username, email } = userRes.rows[0];
    const ts = Date.now();
    const deletedUsername = `${username}_del_${ts}`;
    const deletedEmail = email ? `${email}_del_${ts}` : null;
    safeJson(res, await db.query(
      `UPDATE app_users SET is_deleted=true, active=false, username=$1, email=$2, updated_at=NOW() WHERE id=$3`,
      [deletedUsername, deletedEmail, id]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/users/:id/reset-password — update password hash
app.post('/api/users/:id/reset-password', async (req, res) => {
  const { password_hash } = req.body || {};
  if (!password_hash) return safeJson(res, { ok: false, error: 'password_hash required' });
  try {
    safeJson(res, await db.query(
      `UPDATE app_users SET password_hash=$1, password_change_required=false, updated_at=NOW() WHERE id=$2`,
      [password_hash, req.params.id]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// GET /api/users/stats — user statistics
app.get('/api/users/stats', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN active=true THEN 1 END) as active_count,
         COUNT(DISTINCT role) as role_count,
         COUNT(CASE WHEN last_login > NOW() - INTERVAL '7 days' THEN 1 END) as recent_logins
       FROM app_users
       WHERE is_deleted IS NOT TRUE`
    );
    safeJson(res, { ok: true, stats: result.rows?.[0] });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// GET /api/access-logs — activity logs
app.get('/api/access-logs', async (req, res) => {
  try {
    const { limit = 100, username, event } = req.query;
    let sql = 'SELECT * FROM access_logs WHERE 1=1';
    const params = [];
    if (username) { sql += ` AND user_username=$${params.length+1}`; params.push(username); }
    if (event) { sql += ` AND event=$${params.length+1}`; params.push(event); }
    sql += ` ORDER BY ts DESC LIMIT $${params.length+1}`;
    params.push(Number(limit));
    safeJson(res, await db.query(sql, params));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Baradzanwa Rooms Restoration ────────────────────────────────────────────
// GET /api/setup/restore-baradzanwa-rooms?key=confirm
// Restores all 31 Baradzanwa rooms from the reconstruction dataset
app.get('/api/setup/restore-baradzanwa-rooms', async (req, res) => {
  if (req.query.key !== 'confirm') {
    return safeJson(res, { ok: false, error: 'Pass ?key=confirm to execute' });
  }
  try {
    const ops = [
      // Fix rates on existing rooms overwritten by Villa Gianni schema seed
      { sql: "UPDATE rooms SET type='Standard Room', rate=90.00, updated_at=NOW() WHERE number='103' AND rate::numeric=80", params: [] },
      { sql: "UPDATE rooms SET type='Standard Room', rate=90.00, updated_at=NOW() WHERE number='105' AND rate::numeric=80", params: [] },
      { sql: "UPDATE rooms SET type='Deluxe Queen', rate=100.00, updated_at=NOW() WHERE number='106'", params: [] },
      { sql: "UPDATE rooms SET type='Standard Room', updated_at=NOW() WHERE type='Standard Roon'", params: [] },
      // Add 18 missing rooms (113-131) to reach 31 total
      ...['113:Deluxe Queen:90','115:Deluxe Queen:90','116:Deluxe Queen:90','117:Deluxe Queen:90',
          '118:Deluxe Queen:100','119:Deluxe Queen:100','120:Deluxe Queen:100',
          '121:Standard Room:90','122:Standard Room:90','123:Standard Room:90','124:Standard Room:90',
          '125:Executive Room:100','126:Executive Room:100','127:Executive Room:100','128:Executive Room:110',
          '129:Executive Suite:90','130:Executive Suite:90','131:Standard Room:90'
      ].map(r => {
        const [num, type, rate] = r.split(':');
        return {
          sql: `INSERT INTO rooms (id, number, type, status, rate, floor, is_active, inserted_at, updated_at)
                VALUES (gen_random_uuid()::text, $1, $2, 'vacant', $3, 1, true, NOW(), NOW())
                ON CONFLICT (number) DO NOTHING`,
          params: [num, type, parseFloat(rate)]
        };
      })
    ];

    let succeeded = 0; const errors = [];
    for (const op of ops) {
      const r = await db.query(op.sql, op.params);
      if (r.ok) succeeded++;
      else errors.push(op.sql.substring(0, 60) + ': ' + r.error);
    }

    const countRes = await db.query("SELECT COUNT(*) as total FROM rooms WHERE is_active IS DISTINCT FROM false");
    const total = countRes.ok ? countRes.rows[0]?.total : 'unknown';

    safeJson(res, {
      ok: errors.length === 0,
      message: `Baradzanwa rooms restored. Total rooms: ${total}`,
      operations: succeeded,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (e) {
    safeJson(res, { ok: false, error: e.message });
  }
});

// ─── Rooms CRUD API ───────────────────────────────────────────────────────────
app.get('/api/rooms', async (req, res) => {
  try {
    safeJson(res, await db.query('SELECT * FROM rooms WHERE is_active IS DISTINCT FROM false ORDER BY number::int NULLS LAST'));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.post('/api/rooms', async (req, res) => {
  const { id, number, type, status, rate, floor } = req.body || {};
  if (!number || !type) return safeJson(res, { ok: false, error: 'number and type required' });
  try {
    safeJson(res, await db.query(
      `INSERT INTO rooms (id, number, type, status, rate, floor, is_active, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
       ON CONFLICT (number) DO UPDATE SET type=EXCLUDED.type, rate=EXCLUDED.rate, status=EXCLUDED.status, updated_at=NOW()`,
      [id || `R${Date.now()}`, number, type, status || 'vacant', Number(rate || 0), Number(floor || 1)]
    ));
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.put('/api/rooms/:id', async (req, res) => {
  const allowed = ['number','type','status','rate','floor','is_active','tax_applicable'];
  const fields = []; const vals = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) { fields.push(`${f}=$${vals.length+1}`); vals.push(req.body[f]); }
  }
  if (!fields.length) return safeJson(res, { ok: false, error: 'No fields to update' });
  vals.push(req.params.id);
  try { safeJson(res, await db.query(`UPDATE rooms SET ${fields.join(',')},updated_at=NOW() WHERE id=$${vals.length}`, vals)); }
  catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Cron: nightly auto-run of Night Audit ───────────────────────────────────
// Hit by Vercel cron daily at 22:00 UTC (00:00 Africa/Harare CAT, UTC+2).
// Schedule defined in vercel.json. Runs even when no browser is open.
//
// Idempotent — records last-run date in system_configs so a manual run earlier
// in the day prevents double-execution. Best-effort: failures don't crash the
// server, they're logged and the next morning's catch-up in the browser will
// fill in any missed dates.
async function ensureNightAuditLogTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS night_audit_log (
      id            SERIAL PRIMARY KEY,
      audit_date    DATE NOT NULL UNIQUE,
      ran_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source        TEXT NOT NULL DEFAULT 'cron',
      ok            BOOLEAN NOT NULL DEFAULT TRUE,
      notes         TEXT
    )
  `);
}

// ─── Helper: run a single night-audit pass for a given date ──────────────────
// Idempotent (safe to call multiple times per date) — each step records what
// it did into the night_audit_runs.notes column so a manager can audit the
// history. Returns { ok, date, notes } never throws — errors go into notes.
async function runNightAuditForDate(date, source = 'manual') {
  await ensureNightAuditLogTable();
  const notes = [];
  let allOk = true;

  // Read live tax rate from system_configs (default 15% if unset)
  let taxRate = 0.15;
  try {
    const cfgRes = await db.query(`SELECT value FROM system_configs WHERE key='tax_config' LIMIT 1`);
    if (cfgRes.ok && cfgRes.rows?.length) {
      const cfg = typeof cfgRes.rows[0].value === 'string' ? JSON.parse(cfgRes.rows[0].value) : cfgRes.rows[0].value;
      const r = Number(cfg?.room_tax_rate ?? cfg?.default_rate ?? cfg?.pos_tax_rate ?? 0);
      if (r > 1) taxRate = r / 100;
      else if (r > 0) taxRate = r;
    }
  } catch (e) { notes.push(`tax_config read failed: ${e.message}`); }

  // Step 1: Close stuck shifts
  try {
    const r = await db.query(
      `UPDATE pos_shifts SET status='closed', closed_at=COALESCE(closed_at, NOW())
       WHERE status='open' AND opened_at::date <= $1 RETURNING id`,
      [date]
    );
    notes.push(`Closed ${r.rows?.length || 0} stuck shifts`);
  } catch (e) { allOk = false; notes.push(`shift-close error: ${e.message}`); }

  // Step 2: Void stale open POS orders (>18h)
  try {
    const r = await db.query(
      `UPDATE pos_orders SET status='voided', updated_at=NOW()
       WHERE status='open' AND created_at < NOW() - INTERVAL '18 hours' RETURNING id`
    );
    notes.push(`Voided ${r.rows?.length || 0} stale POS orders`);
  } catch (e) { allOk = false; notes.push(`order-void error: ${e.message}`); }

  // Step 3: Post room charges for occupied rooms (with idempotency via source_reference)
  // Capture stats that get written to night_audit_runs for report visibility.
  let chargesPosted = 0;
  let totalRevenue = 0;
  let occupiedRoomsCount = 0;
  let posRevenueForDay = 0;
  let totalRoomsCount = 0;
  try {
    const occRooms = await db.query(
      `SELECT ro.id as room_id, ro.number, ro.type, ro.rate as default_rate,
              r.id as reservation_id, COALESCE(NULLIF(r.rate::numeric, 0), ro.rate, 0) as reservation_rate,
              g.id as guest_id, g.full_name,
              f.id as folio_id
       FROM rooms ro
       JOIN reservations r ON r.room_id = ro.id AND r.status = 'checked-in'
       JOIN guests g ON g.id = r.guest_id
       LEFT JOIN folios f ON f.reservation_id = r.id AND f.status = 'open'
       WHERE ro.status IN ('OC', 'OD')`
    );
    if (occRooms.ok && occRooms.rows?.length) {
      occupiedRoomsCount = occRooms.rows.length;
    }
    // Also capture total room inventory for occupancy % calculation
    try {
      const tot = await db.query(`SELECT COUNT(*) AS n FROM rooms WHERE is_active IS NOT FALSE`);
      if (tot.ok && tot.rows?.length) totalRoomsCount = Number(tot.rows[0].n || 0);
    } catch { totalRoomsCount = 0; }
    if (occRooms.ok && occRooms.rows?.length) {
      for (const room of occRooms.rows) {
        const rate = Number(room.reservation_rate || 0);
        if (rate <= 0) continue;
        const tax = Number((rate * (taxRate / (1 + taxRate))).toFixed(2));
        const base = Number((rate - tax).toFixed(2));
        const chargeRef = `NA_${date}_RM${room.number}`;

        // Auto-create folio if missing
        let folioId = room.folio_id;
        if (!folioId) {
          const nf = await db.query(
            `INSERT INTO folios (id, guest_id, reservation_id, room_number, status, balance, guest_name, arrival_date, inserted_at)
             VALUES (gen_random_uuid(), $1, $2, $3, 'open', 0, $4, NOW(), NOW()) RETURNING id`,
            [room.guest_id, room.reservation_id, room.number, room.full_name]
          );
          folioId = nf.ok ? nf.rows[0]?.id : null;
        }
        if (!folioId) continue;

        // Idempotency check — skip if already posted for this date
        const exists = await db.query(
          `SELECT 1 FROM folio_charges WHERE source_reference=$1 AND folio_id=$2 LIMIT 1`,
          [chargeRef, folioId]
        );
        if (exists.ok && exists.rows?.length) continue;

        await db.query(
          `INSERT INTO folio_charges (id, folio_id, guest_id, reservation_id, room_number, charge_type, category,
              description, amount, tax_amount, total_amount, source, source_reference, posting_date, business_date, department, service_date, inserted_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'charge', 'Room', $5, $6, $7, $8, 'night_audit', $9, $10, $11, 'Rooms', $11, NOW())`,
          [folioId, room.guest_id, room.reservation_id, room.number,
           `Room ${room.number} - ${room.type}`, base, tax, rate, chargeRef, date, date]
        );
        await db.query(`UPDATE folios SET balance = balance + $1, updated_at=NOW() WHERE id=$2`, [rate, folioId]);
        chargesPosted += 1;
        totalRevenue += rate;
      }
    }
    notes.push(`Posted ${chargesPosted} room charges (revenue $${totalRevenue.toFixed(2)})`);
  } catch (e) { allOk = false; notes.push(`room-charge error: ${e.message}`); }

  // Capture POS revenue for the day (for the night_audit_runs report row)
  try {
    const posRes = await db.query(
      `SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM pos_orders
       WHERE status='closed' AND created_at::date = $1::date`,
      [date]
    );
    if (posRes.ok && posRes.rows?.length) posRevenueForDay = Number(posRes.rows[0].total || 0);
  } catch { /* leave at 0 */ }

  // True-up stats from the DB rather than from this run's loop counters.
  // The loop only counts charges posted THIS run; if previous backfills wrote
  // them already, idempotency would skip and our counter would read 0 even
  // though the charges are present. Source-of-truth: folio_charges for this date.
  try {
    const fc = await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount),0)::numeric AS total
         FROM folio_charges
        WHERE source='night_audit'
          AND source_reference LIKE $1
          AND category='Room'`,
      [`NA_${date}_RM%`]
    );
    if (fc.ok && fc.rows?.length) {
      const dbCount = Number(fc.rows[0].n || 0);
      const dbTotal = Number(fc.rows[0].total || 0);
      if (dbCount > chargesPosted) chargesPosted = dbCount;
      if (dbTotal > totalRevenue) totalRevenue = dbTotal;
    }
  } catch { /* keep loop counters */ }

  // Step 4: Reset stuck table_status rows
  try {
    await db.query(`UPDATE table_status SET status='available', last_update=NOW() WHERE status='open'`);
    notes.push('Reset stuck table_status rows');
  } catch (e) { notes.push(`table-status reset error: ${e.message}`); }

  // Step 5: Roll business_date forward
  try {
    await db.query(
      `INSERT INTO system_configs (key, value) VALUES ('business_date', $1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [JSON.stringify(date)]
    );
    notes.push(`business_date set to ${date}`);
  } catch (e) { notes.push(`date-roll error: ${e.message}`); }

  // Record the run in the lightweight log
  try {
    await db.query(
      `INSERT INTO night_audit_log (audit_date, source, ok, notes) VALUES ($1, $2, $3, $4)
       ON CONFLICT (audit_date) DO UPDATE SET ran_at=NOW(), ok=EXCLUDED.ok, notes=EXCLUDED.notes, source=EXCLUDED.source`,
      [date, source, allOk, notes.join('; ')]
    );
  } catch (e) { notes.push(`run-log error: ${e.message}`); }

  // Also record in the full night_audit_runs table so the existing
  // NightAuditReports / Reports UI surfaces the backfilled date with real stats.
  try {
    const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
    const nextDate = d.toISOString().slice(0, 10);

    const taxRevenue = Number((totalRevenue * (taxRate / (1 + taxRate))).toFixed(2));
    const fullTotalRevenue = totalRevenue + posRevenueForDay;
    const occupancyPct = totalRoomsCount > 0
      ? Number(((occupiedRoomsCount / totalRoomsCount) * 100).toFixed(2))
      : 0;
    const adr = occupiedRoomsCount > 0
      ? Number((totalRevenue / occupiedRoomsCount).toFixed(2))
      : 0;
    const revpar = totalRoomsCount > 0
      ? Number((totalRevenue / totalRoomsCount).toFixed(2))
      : 0;
    const snapshot = {
      fbRevenue: posRevenueForDay,
      roomRevenue: totalRevenue,
      taxRevenue,
      occupiedRooms: occupiedRoomsCount,
      availableRooms: totalRoomsCount,
      source,
      notes: notes.join('; '),
    };
    const statusVal = allOk ? 'completed' : 'completed_with_warnings';

    // UPSERT — if row already exists for this date (e.g. earlier backfill with
    // empty stats), enrich it with the real numbers from this run.
    const existing = await db.query(
      `SELECT id FROM night_audit_runs WHERE business_date::date=$1::date LIMIT 1`,
      [date]
    );
    if (existing.ok && existing.rows?.length) {
      await db.query(
        `UPDATE night_audit_runs SET
           rooms_posted=$2, room_revenue=$3, tax_revenue=$4, total_revenue=$5,
           occupied_rooms=$6, available_rooms=$7, occupancy_percent=$8, adr=$9, revpar=$10,
           status=$11, run_by=$12, completed_at=NOW(), reports_snapshot=$13::jsonb,
           next_business_date=$14::date
         WHERE business_date::date=$1::date`,
        [date, chargesPosted, totalRevenue, taxRevenue, fullTotalRevenue,
         occupiedRoomsCount, totalRoomsCount, occupancyPct, adr, revpar,
         statusVal, `${source}_runner`, JSON.stringify(snapshot), nextDate]
      );
    } else {
      await db.query(
        `INSERT INTO night_audit_runs
           (id, business_date, next_business_date, rooms_posted, room_revenue,
            tax_revenue, total_revenue, city_ledger_transfers, city_ledger_amount,
            occupied_rooms, available_rooms, occupancy_percent, adr, revpar,
            status, run_by, started_at, completed_at, reports_snapshot, inserted_at)
         VALUES (gen_random_uuid(), $1::date, $2::date, $3, $4, $5, $6, 0, 0,
                 $7, $8, $9, $10, $11, $12, $13, $1::date, NOW(), $14::jsonb, NOW())
         ON CONFLICT DO NOTHING`,
        [date, nextDate, chargesPosted, totalRevenue, taxRevenue, fullTotalRevenue,
         occupiedRoomsCount, totalRoomsCount, occupancyPct, adr, revpar,
         statusVal, `${source}_runner`, JSON.stringify(snapshot)]
      );
    }
  } catch (e) {
    notes.push(`night_audit_runs upsert error: ${e.message}`);
  }

  return { ok: allOk, date, notes, stats: { chargesPosted, totalRevenue, occupiedRoomsCount, totalRoomsCount, posRevenueForDay } };
}

// POST /api/admin/night-audit/backfill — fill missing audits from a start date.
// Body: { from: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }   (to defaults to today)
// Use case: Baradzanwa night audit stuck since 2026-05-18 — backfill restores
// missing room charges, closes orphaned shifts, and rolls business_date forward
// one day at a time so accounting periods reconcile cleanly.
app.post('/api/admin/night-audit/backfill', async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return safeJson(res, { ok: false, error: 'from date required (YYYY-MM-DD)' });
  }
  const endDate = (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) ? to : new Date().toISOString().slice(0, 10);

  const startMs = new Date(from + 'T00:00:00Z').getTime();
  const endMs   = new Date(endDate + 'T00:00:00Z').getTime();
  if (endMs < startMs) return safeJson(res, { ok: false, error: 'to must be >= from' });
  const dayMs = 86400000;
  const dates = [];
  for (let t = startMs; t <= endMs; t += dayMs) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  if (dates.length > 90) return safeJson(res, { ok: false, error: 'Backfill range too large (>90 days). Run in smaller batches.' });

  const results = [];
  for (const d of dates) {
    try {
      const r = await runNightAuditForDate(d, 'backfill');
      results.push(r);
    } catch (e) {
      results.push({ ok: false, date: d, notes: [`fatal: ${e.message}`] });
    }
  }

  safeJson(res, {
    ok: true,
    backfilled: dates.length,
    from, to: endDate,
    results,
  });
});

// GET /api/admin/night-audit/status — quick health view: last run, missed dates
app.get('/api/admin/night-audit/status', async (req, res) => {
  try {
    await ensureNightAuditLogTable();
    const recent = await db.query(
      `SELECT audit_date, ran_at, source, ok, notes FROM night_audit_log
       ORDER BY audit_date DESC LIMIT 30`
    );
    const last = recent.rows?.[0];
    // Compute missing dates between last run and today
    const today = new Date().toISOString().slice(0, 10);
    const missing = [];
    if (last) {
      const lastMs = new Date(last.audit_date).getTime();
      const todayMs = new Date(today).getTime();
      for (let t = lastMs + 86400000; t <= todayMs; t += 86400000) {
        missing.push(new Date(t).toISOString().slice(0, 10));
      }
    }
    safeJson(res, { ok: true, lastRun: last || null, missingDates: missing, recent: recent.rows || [] });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

app.get('/api/cron/night-audit', async (req, res) => {
  try {
    await ensureNightAuditLogTable();
    const today = new Date().toISOString().slice(0, 10);

    // Idempotency check — don't run twice for the same date
    const already = await db.query(`SELECT 1 FROM night_audit_log WHERE audit_date=$1 AND ok=TRUE`, [today]);
    if (already.ok && already.rows?.length) {
      return safeJson(res, { ok: true, skipped: true, reason: 'already ran today', date: today });
    }

    const result = await runNightAuditForDate(today, 'cron');
    safeJson(res, result);
  } catch (e) {
    console.error('[cron/night-audit] Failed:', e);
    safeJson(res, { ok: false, error: e.message });
  }
});

// ─── GL Journal persistence ──────────────────────────────────────────────────
// Receives journal entries posted by the client (ShiftContext.endShift) so the
// ledger survives a browser wipe. Idempotent on entry.id.
async function ensureGlJournalsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS gl_journals (
      id          TEXT PRIMARY KEY,
      entry_date  DATE NOT NULL,
      reference   TEXT,
      lines       JSONB NOT NULL,
      attachments JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

app.post('/api/gl/journal', async (req, res) => {
  const { entry } = req.body || {};
  if (!entry || !entry.id || !Array.isArray(entry.lines)) {
    return safeJson(res, { ok: false, error: 'entry with id and lines required' });
  }
  try {
    await ensureGlJournalsTable();
    await db.query(
      `INSERT INTO gl_journals (id, entry_date, reference, lines, attachments)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [entry.id, entry.date, entry.reference || null,
       JSON.stringify(entry.lines), JSON.stringify(entry.attachments || {})]
    );
    safeJson(res, { ok: true });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Code Version Control (Vercel deployment snapshots) ──────────────────────
// Lets any staff member save the current deployed code as a named snapshot and
// restore it later — without touching the database data.
//
// Requires these Vercel env vars:
//   VERCEL_TOKEN       — personal access token (Settings → Tokens)
//   VERCEL_PROJECT_ID  — from project Settings → General → Project ID
//   VERCEL_TEAM_ID     — optional, only for team-scoped projects

// Ensure the code_versions table exists (idempotent)
async function ensureCodeVersionsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS code_versions (
      id          SERIAL PRIMARY KEY,
      label       TEXT NOT NULL,
      deployment_id   TEXT,
      deployment_url  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by  TEXT NOT NULL DEFAULT 'system',
      notes       TEXT
    )
  `);
}

// GET /api/version/list — return all saved snapshots newest-first
app.get('/api/version/list', async (req, res) => {
  try {
    await ensureCodeVersionsTable();
    const result = await db.query(`SELECT * FROM code_versions ORDER BY created_at DESC LIMIT 50`);
    safeJson(res, { ok: true, versions: result.rows || [] });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/version/snapshot — save the current live deployment as a snapshot
app.post('/api/version/snapshot', async (req, res) => {
  const { label, notes, createdBy } = req.body || {};
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  try {
    await ensureCodeVersionsTable();

    let deploymentId = null;
    let deploymentUrl = null;

    if (token && projectId) {
      // Fetch the current production deployment from Vercel
      const teamId = process.env.VERCEL_TEAM_ID;
      const qs = teamId ? `?teamId=${teamId}&limit=1&target=production` : '?limit=1&target=production';
      const vRes = await fetch(`https://api.vercel.com/v6/deployments${qs}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (vRes.ok) {
        const vData = await vRes.json();
        const dep = vData.deployments?.[0];
        if (dep) { deploymentId = dep.uid; deploymentUrl = dep.url ? `https://${dep.url}` : null; }
      }
    }

    const snapshotLabel = label || `Snapshot ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`;
    const result = await db.query(
      `INSERT INTO code_versions (label, deployment_id, deployment_url, created_by, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [snapshotLabel, deploymentId, deploymentUrl, createdBy || 'staff', notes || null]
    );
    safeJson(res, { ok: true, version: result.rows[0] });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// POST /api/version/restore — promote a saved deployment back to production
app.post('/api/version/restore', async (req, res) => {
  const { versionId } = req.body || {};
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (!versionId) return safeJson(res, { ok: false, error: 'versionId required' });
  if (!token || !projectId) return safeJson(res, { ok: false, error: 'VERCEL_TOKEN and VERCEL_PROJECT_ID env vars are not set — cannot restore deployments automatically. Ask your developer to set these in Vercel project settings.' });

  try {
    await ensureCodeVersionsTable();
    const vResult = await db.query(`SELECT * FROM code_versions WHERE id=$1`, [versionId]);
    if (!vResult.rows?.length) return safeJson(res, { ok: false, error: 'Version not found' });
    const version = vResult.rows[0];

    if (!version.deployment_id) {
      return safeJson(res, { ok: false, error: 'This snapshot has no Vercel deployment ID recorded. It may have been saved before Vercel integration was configured.' });
    }

    const teamId = process.env.VERCEL_TEAM_ID;
    const qs = teamId ? `?teamId=${teamId}` : '';
    // Promote (alias) the saved deployment to production
    const promoteRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/promote/${version.deployment_id}${qs}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: `restore-${versionId}-${Date.now()}` })
    });
    const promoteData = await promoteRes.json();
    if (!promoteRes.ok) {
      return safeJson(res, { ok: false, error: promoteData.error?.message || `Vercel API error ${promoteRes.status}` });
    }

    safeJson(res, { ok: true, message: `Restore initiated for "${version.label}". The site will update in ~30 seconds.`, version });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// DELETE /api/version/:id — remove a saved snapshot record
app.delete('/api/version/:id', async (req, res) => {
  try {
    await db.query(`DELETE FROM code_versions WHERE id=$1`, [req.params.id]);
    safeJson(res, { ok: true });
  } catch (e) { safeJson(res, { ok: false, error: e.message }); }
});

// ─── Catch-all: return JSON 404 (NOT HTML) ───────────────────────────────────
// This prevents the "Unexpected token T" error — always return JSON
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Route not found: ${req.method} ${req.path}` });
});

// ─── Vercel serverless export ─────────────────────────────────────────────────
module.exports = app;
