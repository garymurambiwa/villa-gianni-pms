const express = require('express');
const cors = require('cors');
const path = require('path');

// Load database module
const db = require('./db-web.cjs');
const { normalizeGLSource } = require('./glSource.cjs');
const { ensureFinanceTables, assertPeriodOpen, isPeriodClosed, setPeriodStatus, nextDocId } = require('./finance-core.cjs');

// Load environment variables
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }) } catch { }

const app = express();
const wsInstance = require('express-ws')(app);
const PORT = process.env.PORT || 3001;

// Minimal middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.url}`);
  next();
});

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, '..', 'dist')));

// Basic test route
app.get('/api/test', (req, res) => {
  console.log('🧪 Test route called');
  res.json({ ok: true, message: 'Server is working', timestamp: new Date().toISOString() });
});

// 1. Database API Endpoints (Strictly mirrors Electron IPC "db:..." handlers)

// POST /api/db/query
app.post('/api/db/query', async (req, res) => {
    const { sql, params } = req.body;
    if (!sql) return res.status(400).json({ ok: false, error: 'SQL required' });

    // Basic security check (very weak, assumes internal use only)
    const s = sql.toLowerCase().trim();
    if (s.startsWith('drop') || s.startsWith('truncate')) {
        // Allow ONLY if explicitly authorized or dev mode? For now, block dangerous ops via API
        // return res.status(403).json({ ok: false, error: 'Destructive DDL not allowed via API' });
    }

    const result = await db.query(sql, params);
    res.json(result);
});

// POST /api/db/exec
app.post('/api/db/exec', async (req, res) => {
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ ok: false, error: 'SQL required' });
    const result = await db.exec(sql);
    res.json(result);
});

// POST /api/db/transaction
app.post('/api/db/transaction', async (req, res) => {
    const { operations } = req.body;
    if (!Array.isArray(operations)) return res.status(400).json({ ok: false, error: 'Operations array required' });
    const result = await db.transaction(operations);
    res.json(result);
});

// POST /api/db/test (Equiv to db:testConnection)
app.post('/api/db/test', async (req, res) => {
    try {
        const result = await db.query('SELECT version()');
        if (result.ok) {
            res.json({ ok: true, serverVersion: result.rows[0].version });
        } else {
            res.json({ ok: false, error: result.error });
        }
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// ─── GL Account Mappings (DB-backed, USALI-aligned) ──────────────────────────
const GL_REQUIRED_CODES = ['ROOM_REVENUE','FB_REVENUE','CONF_REVENUE','TAX','CASH','CARD','ROOM_CHARGE','CITY_LEDGER'];
const GL_USALI_DEFAULTS = {
  ROOM_REVENUE:'4000', FB_REVENUE:'4100', CONF_REVENUE:'4200', TAX:'2300',
  CASH:'1000', CARD:'1100', ROOM_CHARGE:'1200', CITY_LEDGER:'1300',
  FB_COST:'5100', BANK:'1150', AP_CONTROL:'2100',
};
app.get('/api/gl/mappings', async (req, res) => {
  try {
    const r = await db.query(`SELECT value FROM system_configs WHERE key='gl_mappings'`);
    let m = {}; if (r.ok && r.rows?.length) { try { m = JSON.parse(r.rows[0].value); } catch {} }
    const merged = { ...GL_USALI_DEFAULTS, ...m };
    res.json({ ok: true, mappings: merged, requiredCodes: GL_REQUIRED_CODES });
  } catch(e) { res.json({ ok:false, error:e.message }); }
});
app.post('/api/gl/mappings', async (req, res) => {
  const { mappings } = req.body || {};
  if (!mappings) return res.json({ ok:false, error:'mappings required' });
  try {
    const r = await db.query(`SELECT value FROM system_configs WHERE key='gl_mappings'`);
    let cur = {}; if (r.ok && r.rows?.length) { try { cur = JSON.parse(r.rows[0].value); } catch {} }
    const merged = { ...cur, ...mappings };
    await db.query(`INSERT INTO system_configs(key,value) VALUES('gl_mappings',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[JSON.stringify(merged)]);
    res.json({ ok:true, mappings:merged });
  } catch(e) { res.json({ ok:false, error:e.message }); }
});
app.post('/api/gl/mappings/seed', async (req, res) => {
  try {
    const r = await db.query(`SELECT value FROM system_configs WHERE key='gl_mappings'`);
    let cur = {}; if (r.ok && r.rows?.length) { try { cur = JSON.parse(r.rows[0].value); } catch {} }
    const seeded = {}; for (const [k,v] of Object.entries(GL_USALI_DEFAULTS)) { if (!cur[k]) { cur[k]=v; seeded[k]=v; } }
    await db.query(`INSERT INTO system_configs(key,value) VALUES('gl_mappings',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[JSON.stringify(cur)]);
    res.json({ ok:true, mappings:cur, seeded, message:`Seeded ${Object.keys(seeded).length} USALI defaults` });
  } catch(e) { res.json({ ok:false, error:e.message }); }
});
app.get('/api/gl/mappings/validate', async (req, res) => {
  try {
    const r = await db.query(`SELECT value FROM system_configs WHERE key='gl_mappings'`);
    let m = {}; if (r.ok && r.rows?.length) { try { m = JSON.parse(r.rows[0].value); } catch {} }
    const merged = { ...GL_USALI_DEFAULTS, ...m };
    const missing = GL_REQUIRED_CODES.filter(c => !merged[c]);
    res.json({ ok:missing.length===0, mappings:merged, missing, complete:missing.length===0 });
  } catch(e) { res.json({ ok:false, error:e.message }); }
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

// ── GL JOURNAL ENTRIES (ported from api/handler.js for Render/Villa Gianni parity) ──
// These were missing from index.cjs, so every persistJournalEntryToDB() call from
// the accounting module (manual JE, vendor expense, night-audit frontend) hit 404
// on Villa Gianni and silently never wrote a gl_journal_entries row — only the
// backfilled night-audit entries existed. Porting them closes that lifecycle gap.

// GET /api/gl/journal-entries — entries (with lines) filtered by date/range/source
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
    const r = await db.query(sql, params);
    res.json(r);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// POST /api/gl/journal-entries — create/upsert a balanced journal entry + lines
app.post('/api/gl/journal-entries', async (req, res) => {
  const { id, date, business_date, reference, source, description, lines, created_by, status } = req.body || {};
  const entryDate = business_date || date;
  if (!entryDate || !Array.isArray(lines) || lines.length === 0)
    return res.json({ ok: false, error: 'business_date and lines[] required' });

  const sumDebit  = lines.reduce((s, l) => s + Number(l.debit  || 0), 0);
  const sumCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(sumDebit - sumCredit) > 0.005)
    return res.json({ ok: false, error: `Journal not balanced: debits $${sumDebit.toFixed(2)} ≠ credits $${sumCredit.toFixed(2)}` });

  try {
    // Closed-period guard: a posted entry dated into a closed month is blocked
    // (drafts may still be staged for review — they only hit the ledger on post).
    const willPost = ['draft', 'pending'].includes(status) ? false : true;
    if (willPost) {
      try { await assertPeriodOpen(db, entryDate, 'post journal'); }
      catch (pe) { if (pe.code === 'PERIOD_CLOSED') return res.json({ ok: false, error: pe.message, code: pe.code, period: pe.period }); throw pe; }
    }
    // 5-digit journal voucher id (JV-00001) for new manual/system entries; callers
    // that supply an id (reclass, night audit GLJE_<date>) keep theirs.
    const entryId = id || await nextDocId(db, 'JV');
    const src = normalizeGLSource(source);
    // Daily-batch review gate: discretionary journals (manual JEs, vendor expenses,
    // inventory/stock adjustments) land as 'draft' so the controller can examine and
    // adjust the accounts, then post the batch. Automated sources (night audit, POS,
    // folio, etc.) still post directly. An explicit `status` in the body overrides.
    const DRAFT_SOURCES = ['manual', 'expense', 'adjustment'];
    const entryStatus = ['draft', 'pending', 'posted'].includes(status)
      ? status
      : (DRAFT_SOURCES.includes(src) ? 'draft' : 'posted');
    const isPosted = entryStatus === 'posted';
    const ops = [
      {
        sql: `INSERT INTO gl_journal_entries
                (id, entry_date, business_date, description, reference, source, status,
                 total_debit, total_credit, is_balanced, created_by, posted_by, posted_at, inserted_at)
              VALUES ($1, $2::date, $2::date, $3, $4, $5, $9, $6, $7, true, $8,
                      CASE WHEN $9='posted' THEN $8 ELSE NULL END,
                      CASE WHEN $9='posted' THEN NOW() ELSE NULL END, NOW())
              ON CONFLICT (id) DO UPDATE SET
                description=EXCLUDED.description, reference=EXCLUDED.reference,
                total_debit=EXCLUDED.total_debit, total_credit=EXCLUDED.total_credit,
                status=EXCLUDED.status,
                posted_by=CASE WHEN EXCLUDED.status='posted' THEN EXCLUDED.posted_by ELSE NULL END,
                posted_at=CASE WHEN EXCLUDED.status='posted' THEN NOW() ELSE NULL END,
                updated_at=NOW()
              RETURNING id`,
        params: [entryId, entryDate, description || reference || `Journal ${entryDate}`,
                 reference || null, src, sumDebit, sumCredit, created_by || 'system', entryStatus]
      },
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
    res.json({ ok: true, id: entryId, date: entryDate, status: entryStatus, totalDebit: sumDebit, totalCredit: sumCredit });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ─── Daily Journal Batch (review-then-post gate) ─────────────────────────────
// GET /api/gl/daily-batch?date=YYYY-MM-DD — draft/pending entries + lines for review
app.get('/api/gl/daily-batch', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.json({ ok: false, error: 'date required' });
  try {
    const r = await db.query(
      `SELECT je.id, je.business_date, je.description, je.reference, je.source, je.status,
              je.total_debit, je.total_credit, je.created_by, je.inserted_at,
              COALESCE(json_agg(json_build_object(
                 'id', jl.id, 'gl_account_id', jl.gl_account_id,
                 'account_name', a.name, 'account_category', a.category,
                 'debit_amount', jl.debit_amount, 'credit_amount', jl.credit_amount,
                 'description', jl.description
               ) ORDER BY jl.id) FILTER (WHERE jl.id IS NOT NULL), '[]') AS lines
       FROM gl_journal_entries je
       LEFT JOIN gl_journal_lines jl ON jl.journal_entry_id = je.id
       LEFT JOIN gl_accounts a ON a.id = jl.gl_account_id
       WHERE je.business_date = $1::date AND je.status IN ('draft','pending')
       GROUP BY je.id ORDER BY je.inserted_at DESC`,
      [date]
    );
    const rows = r.rows || [];
    res.json({
      ok: true, date, entries: rows, count: rows.length,
      totalDebit:  rows.reduce((s, e) => s + Number(e.total_debit || 0), 0),
      totalCredit: rows.reduce((s, e) => s + Number(e.total_credit || 0), 0),
    });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// POST /api/gl/journal-entries/:id/post — post a single draft/pending entry
app.post('/api/gl/journal-entries/:id/post', async (req, res) => {
  const { id } = req.params;
  const { posted_by } = req.body || {};
  try {
    const r = await db.query(
      `UPDATE gl_journal_entries
         SET status='posted', posted_by=$2, posted_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND status IN ('draft','pending') RETURNING id`,
      [id, posted_by || 'system']
    );
    if (!r.rows?.length) return res.json({ ok: false, error: 'Entry not found or already posted' });
    res.json({ ok: true, id });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// POST /api/gl/daily-batch/post — post ALL draft/pending entries for a business date
app.post('/api/gl/daily-batch/post', async (req, res) => {
  const { date, posted_by } = req.body || {};
  if (!date) return res.json({ ok: false, error: 'date required' });
  try {
    const r = await db.query(
      `UPDATE gl_journal_entries
         SET status='posted', posted_by=$2, posted_at=NOW(), updated_at=NOW()
       WHERE business_date=$1::date AND status IN ('draft','pending') RETURNING id`,
      [date, posted_by || 'system']
    );
    res.json({ ok: true, posted: r.rows?.length || 0, ids: (r.rows || []).map(x => x.id) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ─── GL Transaction Listing (detailed + summary) ─────────────────────────────
// GET /api/gl/transactions?from&to&account_id&source
// Detailed: every posted journal LINE in range (with its parent entry + account).
// Summary: per-account debit/credit/net totals over the same filter.
app.get('/api/gl/transactions', async (req, res) => {
  const { from, to, account_id, source, basis } = req.query;
  if (!from || !to) return res.json({ ok: false, error: 'from and to dates required' });
  try {
    // Date basis: 'transaction' (default) filters on business_date — WHEN the
    // event happened; 'posting' filters on posted_at — when it was captured.
    const dateCol = basis === 'posting'
      ? `COALESCE(je.posted_at, je.inserted_at)::date`
      : `je.business_date`;
    let where = `je.status = 'posted' AND ${dateCol} >= $1::date AND ${dateCol} <= $2::date`;
    const params = [from, to];
    if (account_id) { params.push(account_id); where += ` AND jl.gl_account_id = $${params.length}`; }
    if (source)     { params.push(source);     where += ` AND je.source = $${params.length}`; }

    const [detail, summary] = await Promise.all([
      db.query(
        `SELECT jl.id AS line_id, jl.journal_entry_id, jl.gl_account_id,
                a.name AS account_name, a.category AS account_category,
                jl.debit_amount, jl.credit_amount, jl.description AS line_description,
                je.business_date, je.reference, je.description AS entry_description,
                je.source, je.created_by, je.posted_by, je.posted_at
         FROM gl_journal_lines jl
         JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
         LEFT JOIN gl_accounts a ON a.id = jl.gl_account_id
         WHERE ${where}
         ORDER BY je.business_date DESC, je.inserted_at DESC, jl.id`,
        params
      ),
      db.query(
        `SELECT jl.gl_account_id, MAX(a.name) AS account_name, MAX(a.category) AS account_category,
                COUNT(*) AS line_count,
                COALESCE(SUM(jl.debit_amount),0)  AS total_debit,
                COALESCE(SUM(jl.credit_amount),0) AS total_credit,
                COALESCE(SUM(jl.debit_amount),0) - COALESCE(SUM(jl.credit_amount),0) AS net
         FROM gl_journal_lines jl
         JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
         LEFT JOIN gl_accounts a ON a.id = jl.gl_account_id
         WHERE ${where}
         GROUP BY jl.gl_account_id ORDER BY jl.gl_account_id`,
        params
      ),
    ]);
    res.json({
      ok: true, from, to,
      lines: detail.rows || [],
      summary: summary.rows || [],
      totalDebit:  (detail.rows || []).reduce((s, r) => s + Number(r.debit_amount || 0), 0),
      totalCredit: (detail.rows || []).reduce((s, r) => s + Number(r.credit_amount || 0), 0),
    });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ─── Supplier Payments (clear supplier AP against cash/bank) ─────────────────
async function ensureSupplierPaymentsTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS ap_supplier_payments (
    id TEXT PRIMARY KEY,
    supplier_name TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('cash','bank')),
    gl_cash_account TEXT NOT NULL,
    reference TEXT,
    journal_id TEXT,
    paid_at DATE NOT NULL DEFAULT NOW()::date,
    created_by TEXT,
    inserted_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  // Per-GRN settlement: a payment may be allocated to one specific GRN so the
  // controller can verify and clear invoices document-by-document.
  await db.query(`ALTER TABLE ap_supplier_payments ADD COLUMN IF NOT EXISTS grn_id TEXT`);
  await db.query(`ALTER TABLE ap_supplier_payments ADD COLUMN IF NOT EXISTS grn_number TEXT`);
}

// GET /api/ap/supplier-grns?supplier_name= — the supplier's posted GRNs with
// per-GRN paid amount (allocated payments) and outstanding balance, for
// document-by-document verification and settlement.
app.get('/api/ap/supplier-grns', async (req, res) => {
  const { supplier_name } = req.query;
  if (!supplier_name) return res.json({ ok: false, error: 'supplier_name required' });
  try {
    await ensureSupplierPaymentsTable();
    const r = await db.query(
      `SELECT g.id, g.grn_number, g.receipt_date, g.supplier_invoice_number,
              g.destination_location_id, g.posted_at, g.posted_by,
              COALESCE(g.grn_total, g.total_value, 0) AS grn_total,
              COALESCE(p.paid, 0) AS paid,
              COALESCE(g.grn_total, g.total_value, 0) - COALESCE(p.paid, 0) AS balance,
              (SELECT COUNT(*) FROM inv_grn_lines gl WHERE gl.grn_header_id = g.id) AS line_count
       FROM inv_grn_headers g
       LEFT JOIN LATERAL (
         SELECT SUM(amount) AS paid FROM ap_supplier_payments sp WHERE sp.grn_id = g.id
       ) p ON true
       WHERE g.status = 'posted' AND g.supplier_name = $1
       ORDER BY g.receipt_date DESC NULLS LAST, g.grn_number DESC`,
      [supplier_name]
    );
    const rows = r.rows || [];
    // Unallocated supplier-level payments (no grn_id) shown so totals reconcile
    const un = await db.query(
      `SELECT COALESCE(SUM(amount),0) AS unallocated FROM ap_supplier_payments
       WHERE supplier_name = $1 AND grn_id IS NULL`,
      [supplier_name]
    );
    res.json({ ok: true, rows, unallocated: Number(un.rows?.[0]?.unallocated || 0) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// GET /api/ap/supplier-balances — payable (posted GRNs) vs paid, per supplier
app.get('/api/ap/supplier-balances', async (req, res) => {
  try {
    await ensureSupplierPaymentsTable();
    const r = await db.query(
      `WITH grn AS (
         SELECT supplier_name, COUNT(*) AS grn_count,
                COALESCE(SUM(COALESCE(grn_total, total_value, 0)),0) AS payable
         FROM inv_grn_headers WHERE status='posted' AND supplier_name IS NOT NULL
         GROUP BY supplier_name
       ), pay AS (
         SELECT supplier_name, COALESCE(SUM(amount),0) AS paid
         FROM ap_supplier_payments GROUP BY supplier_name
       )
       SELECT COALESCE(g.supplier_name, p.supplier_name) AS supplier_name,
              COALESCE(g.grn_count,0) AS grn_count,
              COALESCE(g.payable,0) AS payable,
              COALESCE(p.paid,0) AS paid,
              COALESCE(g.payable,0) - COALESCE(p.paid,0) AS balance
       FROM grn g FULL OUTER JOIN pay p ON p.supplier_name = g.supplier_name
       ORDER BY balance DESC`
    );
    res.json({ ok: true, rows: r.rows || [] });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// GET /api/ap/supplier-statement?supplier_name=&from=&to= — full transaction
// statement: GRN charges and payments merged by date with a running balance.
app.get('/api/ap/supplier-statement', async (req, res) => {
  const { supplier_name, from, to } = req.query;
  if (!supplier_name) return res.json({ ok: false, error: 'supplier_name required' });
  try {
    await ensureSupplierPaymentsTable();
    const params = [supplier_name];
    let dateFilterGrn = '', dateFilterPay = '';
    if (from) { params.push(from); dateFilterGrn += ` AND COALESCE(g.receipt_date, g.posted_at, g.inserted_at)::date >= $${params.length}::date`; dateFilterPay += ` AND p.paid_at >= $${params.length}::date`; }
    if (to)   { params.push(to);   dateFilterGrn += ` AND COALESCE(g.receipt_date, g.posted_at, g.inserted_at)::date <= $${params.length}::date`; dateFilterPay += ` AND p.paid_at <= $${params.length}::date`; }
    const r = await db.query(
      `SELECT * FROM (
         SELECT 'GRN' AS tx_type, g.id, g.grn_number AS doc_number,
                COALESCE(g.receipt_date, g.posted_at, g.inserted_at)::date AS tx_date,
                g.supplier_invoice_number AS reference,
                COALESCE(g.grn_total, g.total_value, 0) AS charge, 0::numeric AS payment,
                NULL AS method, NULL AS journal_id
         FROM inv_grn_headers g
         WHERE g.status='posted' AND g.supplier_name = $1 ${dateFilterGrn}
         UNION ALL
         SELECT 'PAYMENT' AS tx_type, p.id, COALESCE(p.grn_number, 'On account') AS doc_number,
                p.paid_at AS tx_date, p.reference,
                0::numeric AS charge, p.amount AS payment, p.method, p.journal_id
         FROM ap_supplier_payments p
         WHERE p.supplier_name = $1 ${dateFilterPay}
       ) t ORDER BY tx_date, tx_type DESC, doc_number`,
      params
    );
    const rows = r.rows || [];
    let bal = 0;
    for (const row of rows) { bal += Number(row.charge || 0) - Number(row.payment || 0); row.balance = Number(bal.toFixed(2)); }
    res.json({
      ok: true, supplier_name, from: from || null, to: to || null, rows,
      totalCharges: rows.reduce((s, x) => s + Number(x.charge || 0), 0),
      totalPayments: rows.reduce((s, x) => s + Number(x.payment || 0), 0),
      closingBalance: bal,
    });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// PATCH /api/ap/supplier-payments/:id — edit statement metadata on a payment
// (reference / paid_at only — the amount is a posted GL fact and stays immutable).
app.patch('/api/ap/supplier-payments/:id', async (req, res) => {
  const { id } = req.params;
  const { reference, paid_at } = req.body || {};
  if (reference === undefined && !paid_at) return res.json({ ok: false, error: 'reference or paid_at required' });
  try {
    await ensureSupplierPaymentsTable();
    const r = await db.query(
      `UPDATE ap_supplier_payments
         SET reference = COALESCE($1, reference),
             paid_at = COALESCE($2::date, paid_at)
       WHERE id = $3 RETURNING id`,
      [reference ?? null, paid_at || null, id]
    );
    if (!r.rows?.length) return res.json({ ok: false, error: 'Payment not found' });
    res.json({ ok: true, id });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// PATCH /api/ap/grn-invoice/:id — correct a GRN's supplier invoice number
app.patch('/api/ap/grn-invoice/:id', async (req, res) => {
  const { id } = req.params;
  const { supplier_invoice_number } = req.body || {};
  try {
    const r = await db.query(
      `UPDATE inv_grn_headers SET supplier_invoice_number = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
      [supplier_invoice_number || null, id]
    );
    if (!r.rows?.length) return res.json({ ok: false, error: 'GRN not found' });
    res.json({ ok: true, id });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// GET /api/ap/supplier-payments?supplier_name — payment history
app.get('/api/ap/supplier-payments', async (req, res) => {
  try {
    await ensureSupplierPaymentsTable();
    const { supplier_name } = req.query;
    const params = [];
    let where = '';
    if (supplier_name) { params.push(supplier_name); where = `WHERE supplier_name = $1`; }
    const r = await db.query(
      `SELECT * FROM ap_supplier_payments ${where} ORDER BY paid_at DESC, inserted_at DESC LIMIT 500`, params
    );
    res.json({ ok: true, rows: r.rows || [] });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// POST /api/ap/supplier-payments — record a payment and post the settlement journal
// Dr 2100 Accounts Payable / Cr 1000 Cash or 1100 Bank. Posted immediately (a cash
// movement is a completed fact, not a discretionary estimate).
app.post('/api/ap/supplier-payments', async (req, res) => {
  const { supplier_name, amount, method, reference, date, created_by, grn_id, grn_number } = req.body || {};
  const amt = Number(amount);
  if (!supplier_name || !(amt > 0)) return res.json({ ok: false, error: 'supplier_name and positive amount required' });
  if (!['cash', 'bank'].includes(method)) return res.json({ ok: false, error: "method must be 'cash' or 'bank'" });
  try {
    await ensureSupplierPaymentsTable();
    // Per-GRN settlement guard: validate the GRN belongs to this supplier and
    // block over-settling a single document (supplier-level payments stay free-form).
    let grnNo = grn_number || null;
    if (grn_id) {
      const g = await db.query(
        `SELECT g.grn_number, COALESCE(g.grn_total, g.total_value, 0) AS total,
                COALESCE((SELECT SUM(amount) FROM ap_supplier_payments WHERE grn_id = g.id), 0) AS paid
         FROM inv_grn_headers g WHERE g.id = $1 AND g.supplier_name = $2 AND g.status = 'posted'`,
        [grn_id, supplier_name]
      );
      const grn = g.rows?.[0];
      if (!grn) return res.json({ ok: false, error: 'GRN not found for this supplier (or not posted)' });
      const grnBalance = Number(grn.total) - Number(grn.paid);
      if (amt > grnBalance + 0.005)
        return res.json({ ok: false, error: `Payment $${amt.toFixed(2)} exceeds ${grn.grn_number}'s outstanding balance $${grnBalance.toFixed(2)}` });
      grnNo = grn.grn_number;
    }
    const payDate = date || new Date().toISOString().slice(0, 10);
    // Block paying into a closed period (the payment journal is dated payDate).
    try { await assertPeriodOpen(db, payDate, 'record payment'); }
    catch (pe) { if (pe.code === 'PERIOD_CLOSED') return res.json({ ok: false, error: pe.message, code: pe.code, period: pe.period }); throw pe; }
    const crAcct = method === 'cash' ? '1000' : '1100';
    const payId = await nextDocId(db, 'PAY');        // PAY-00001
    const entryId = `JV-${payId}`;                    // journal id derived from payment id
    const desc = `Supplier payment — ${supplier_name}${grnNo ? ` [${grnNo}]` : ''}${reference ? ` (${reference})` : ''} via ${method}`;
    const by = created_by || 'system';
    const ops = [
      {
        sql: `INSERT INTO gl_journal_entries
                (id, entry_date, business_date, description, reference, source, status,
                 total_debit, total_credit, is_balanced, created_by, posted_by, posted_at, inserted_at)
              VALUES ($1, $2::date, $2::date, $3, $4, 'expense', 'posted', $5, $5, true, $6, $6, NOW(), NOW())`,
        params: [entryId, payDate, desc, reference || payId, amt, by]
      },
      {
        sql: `INSERT INTO gl_journal_lines (id, journal_entry_id, gl_account_id, debit_amount, credit_amount, description, inserted_at)
              VALUES ($1, $2, '2100', $3, 0, $4, NOW()), ($5, $2, $6, 0, $3, $4, NOW())`,
        params: [`${entryId}_DR`, entryId, amt, desc, `${entryId}_CR`, crAcct]
      },
      {
        sql: `INSERT INTO ap_supplier_payments
                (id, supplier_name, amount, method, gl_cash_account, reference, journal_id, paid_at, created_by, grn_id, grn_number)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11)`,
        params: [payId, supplier_name, amt, method, crAcct, reference || null, entryId, payDate, by, grn_id || null, grnNo]
      },
    ];
    const tx = await db.transaction(ops);
    if (!tx.ok) throw new Error(tx.error || 'Transaction failed');
    res.json({ ok: true, id: payId, journal_id: entryId, supplier_name, amount: amt, method });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// GET /api/gl/journal-entries/pl — P&L summary from DB journal lines
app.get('/api/gl/journal-entries/pl', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.json({ ok: false, error: 'from and to dates required' });
  try {
    const result = await db.query(
      `SELECT a.category, a.name as account_name, jl.gl_account_id,
              COALESCE(SUM(jl.debit_amount),0)  as total_debit,
              COALESCE(SUM(jl.credit_amount),0) as total_credit,
              COALESCE(SUM(jl.credit_amount),0) - COALESCE(SUM(jl.debit_amount),0) as net_balance
       FROM gl_journal_lines jl
       JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
       LEFT JOIN gl_accounts   a  ON a.id  = jl.gl_account_id
       WHERE je.business_date >= $1::date AND je.business_date <= $2::date AND je.status = 'posted'
       GROUP BY a.category, a.name, jl.gl_account_id ORDER BY a.category, a.name`,
      [from, to]
    );
    const rows = result.rows || [];
    const revenue = rows.filter(r => r.category === 'Revenue').reduce((s, r) => s + Number(r.net_balance||0), 0);
    const expense = rows.filter(r => r.category === 'Expense').reduce((s, r) => s + Number(r.total_debit||0) - Number(r.total_credit||0), 0);
    res.json({ ok: true, from, to, lines: rows, revenue: Number(revenue.toFixed(2)), expense: Number(expense.toFixed(2)), netIncome: Number((revenue - expense).toFixed(2)) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// GET /api/gl/daily-journal-report?date=YYYY-MM-DD — daily journal + night-audit snapshot
app.get('/api/gl/daily-journal-report', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.json({ ok: false, error: 'date required' });
  try {
    const [journalRes, auditRes] = await Promise.all([
      db.query(
        `SELECT je.id, je.business_date, je.description, je.reference, je.source,
                je.total_debit, je.total_credit, je.status, je.posted_at,
                COALESCE(je.posted_by, je.created_by, 'system') AS posted_by,
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
    res.json({
      ok: true, date,
      journalEntries: journalRes.rows || [],
      nightAudit: auditRes.rows?.[0] || null,
      totalDebit:  (journalRes.rows || []).reduce((s, e) => s + Number(e.total_debit||0), 0),
      totalCredit: (journalRes.rows || []).reduce((s, e) => s + Number(e.total_credit||0), 0),
    });
  } catch (e) { res.json({ ok: false, error: e.message }); }
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
    res.json({ ok: true, rows: r.rows || [] });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// POST /api/gl/pending-batches (create)
app.post('/api/gl/pending-batches', async (req, res) => {
  const { origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount, txn_date } = req.body || {};
  if (!origin_table || !origin_id || !debit_gl_account || !credit_gl_account || amount == null)
    return res.json({ ok: false, error: 'origin_table, origin_id, debit_gl_account, credit_gl_account, amount required' });
  try {
    await db.query(`ALTER TABLE gl_pending_batches ADD COLUMN IF NOT EXISTS txn_date DATE`);
    const r = await db.query(
      `INSERT INTO gl_pending_batches (origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount, txn_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date)
       ON CONFLICT (origin_table, origin_id) DO NOTHING
       RETURNING id`,
      [origin_table, origin_id, description || null, debit_gl_account, credit_gl_account, Number(amount), txn_date || null]
    );
    const id = r.rows?.[0]?.id || null;
    res.json({ ok: true, id, created: !!id });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ─── Accounting Period Close (controller month-end lock) ─────────────────────
// GET list, POST close, POST reopen. A closed period blocks any posting dated in it.
app.get('/api/gl/periods', async (req, res) => {
  try {
    await ensureFinanceTables(db);
    const r = await db.query(
      `SELECT period_year, period_month,
              to_char(make_date(period_year, period_month, 1),'YYYY-MM') AS period,
              period_name, status, closed_by, closed_at, reopened_by, reopened_at
       FROM accounting_periods ORDER BY period_year DESC, period_month DESC`);
    res.json({ ok: true, rows: r.rows || [] });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/gl/periods/close', async (req, res) => {
  const { period, closed_by, note } = req.body || {};
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return res.json({ ok: false, error: 'period must be YYYY-MM' });
  try { const r = await setPeriodStatus(db, period, 'closed', closed_by, note); res.json({ ok: true, ...r }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/gl/periods/reopen', async (req, res) => {
  const { period, reopened_by, note } = req.body || {};
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return res.json({ ok: false, error: 'period must be YYYY-MM' });
  try { const r = await setPeriodStatus(db, period, 'open', reopened_by, note); res.json({ ok: true, ...r }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// Build the transaction ops that book one pending batch into the GL as a balanced
// posted journal entry. Source is 'adjustment' (allowed by the CHECK constraint) —
// the previous 'pending_batch' literal was NOT an allowed source and failed to post.
function batchFlushOps(batch, postedBy) {
  const entryId = `GLJE_BATCH_${batch.id}`;
  const by = postedBy || 'system';
  // business_date = the source document's TRANSACTION date (txn_date), NOT the
  // posting date — so a GRN dated 01 May posted in Aug books to May and every
  // GL-based report (P&L, TB, journals) shows it in May. Falls back to today.
  const bizDate = batch.txn_date ? String(batch.txn_date).slice(0, 10) : null;
  return { entryId, ops: [
    {
      sql: `INSERT INTO gl_journal_entries
              (id, entry_date, business_date, description, source, status,
               total_debit, total_credit, is_balanced, created_by, posted_by, posted_at, inserted_at)
            VALUES ($1, COALESCE($5::date, NOW()::date), COALESCE($5::date, NOW()::date), $2, 'adjustment', 'posted', $3, $3, true, $4, $4, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
            RETURNING id`,
      params: [entryId, batch.description || `Batch ${batch.origin_table}/${batch.origin_id}`, Number(batch.amount), by, bizDate]
    },
    {
      sql: `INSERT INTO gl_journal_lines (id, journal_entry_id, gl_account_id, debit_amount, credit_amount, description, inserted_at)
            VALUES ($1, $2, $3, $4, 0, $5, NOW()) ON CONFLICT (id) DO NOTHING`,
      params: [`${entryId}_DR`, entryId, batch.debit_gl_account, Number(batch.amount), batch.description || null]
    },
    {
      sql: `INSERT INTO gl_journal_lines (id, journal_entry_id, gl_account_id, debit_amount, credit_amount, description, inserted_at)
            VALUES ($1, $2, $3, 0, $4, $5, NOW()) ON CONFLICT (id) DO NOTHING`,
      params: [`${entryId}_CR`, entryId, batch.credit_gl_account, Number(batch.amount), batch.description || null]
    },
    {
      sql: `UPDATE gl_pending_batches SET status='POSTED', posted_at=NOW(), posted_journal_id=$1 WHERE id=$2`,
      params: [entryId, batch.id]
    }
  ] };
}

// POST /api/gl/pending-batches/flush (MUST be BEFORE /:id routes) — post ALL pending
app.post('/api/gl/pending-batches/flush', async (req, res) => {
  const { posted_by } = req.body || {};
  try {
    const pending = await db.query(
      `SELECT * FROM gl_pending_batches WHERE status='PENDING' ORDER BY created_at`
    );
    const rows = pending.rows || [];
    if (!rows.length) return res.json({ ok: true, flushed: 0, errors: [] });

    let flushed = 0;
    const errors = [];

    for (const batch of rows) {
      try {
        // Closed-period guard: block posting a batch dated into a closed period.
        await assertPeriodOpen(db, batch.txn_date || new Date(), 'post');
        const { ops } = batchFlushOps(batch, posted_by);
        const txResult = await db.transaction(ops);
        if (!txResult.ok) throw new Error(txResult.error || 'Transaction failed');
        flushed++;
      } catch (batchErr) {
        errors.push({ id: batch.id, error: batchErr.message });
      }
    }

    res.json({ ok: true, flushed, errors });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// POST /api/gl/pending-batches/:id/flush — book ONE pending batch into the GL
app.post('/api/gl/pending-batches/:id/flush', async (req, res) => {
  const { id } = req.params;
  const { posted_by } = req.body || {};
  try {
    const p = await db.query(`SELECT * FROM gl_pending_batches WHERE id=$1 AND status='PENDING'`, [id]);
    const batch = p.rows?.[0];
    if (!batch) return res.json({ ok: false, error: 'Batch not found or not pending' });
    await assertPeriodOpen(db, batch.txn_date || new Date(), 'post');
    const { entryId, ops } = batchFlushOps(batch, posted_by);
    const tx = await db.transaction(ops);
    if (!tx.ok) throw new Error(tx.error || 'Transaction failed');
    res.json({ ok: true, id, journal_id: entryId });
  } catch (e) { res.json({ ok: false, error: e.message, code: e.code, period: e.period }); }
});

// PUT /api/gl/pending-batches/:id — edit a PENDING batch's accounts/description/amount
app.put('/api/gl/pending-batches/:id', async (req, res) => {
  const { id } = req.params;
  const { debit_gl_account, credit_gl_account, description, amount } = req.body || {};
  if (!debit_gl_account || !credit_gl_account)
    return res.json({ ok: false, error: 'debit_gl_account and credit_gl_account required' });
  if (debit_gl_account === credit_gl_account)
    return res.json({ ok: false, error: 'Debit and credit accounts must differ' });
  try {
    const r = await db.query(
      `UPDATE gl_pending_batches
         SET debit_gl_account=$1, credit_gl_account=$2,
             description=COALESCE($3, description),
             amount=COALESCE($4, amount)
       WHERE id=$5 AND status='PENDING' RETURNING id`,
      [debit_gl_account, credit_gl_account, description ?? null,
       amount == null ? null : Number(amount), id]
    );
    if (!r.rows?.length) return res.json({ ok: false, error: 'Batch not found or already posted' });
    res.json({ ok: true, id });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// PATCH /api/gl/pending-batches/:id (MUST be AFTER /flush)
app.patch('/api/gl/pending-batches/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!['POSTED','IGNORED'].includes(status))
    return res.json({ ok: false, error: 'status must be POSTED or IGNORED' });
  try {
    const extra = status === 'POSTED' ? ', posted_at = NOW()' : '';
    const r = await db.query(
      `UPDATE gl_pending_batches SET status=$1${extra} WHERE id=$2 RETURNING id`,
      [status, id]
    );
    if (!r.rows?.length) return res.json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ─── System Branding (DB-backed, per-property) ───────────────────────────────
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
    res.json({ ok: true, branding: map });
  } catch (e) { res.json({ ok: false, error: e.message }); }
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
    if (ops.length === 0) return res.json({ ok: true, updated: 0 });
    const txResult = await db.transaction(ops);
    res.json({ ok: !!(txResult && txResult.ok), updated: ops.length });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ─── Room Reconciliation ──────────────────────────────────────────────────────
app.post('/api/rooms/reconcile', async (req, res) => {
  try {
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
    res.json({ ok: true, fixed, count: fixed.length });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// GET /api/setup/init-db?key=123 (Temporary workaround for no-shell environments)
// GET /api/setup/init-db?key=confirm&reset=true
app.get('/api/setup/init-db', async (req, res) => {
    const { key, reset } = req.query;

    if (key !== 'confirm') {
        return res.status(400).send('<h1>Missing confirmation</h1><p>Use <code>?key=confirm</code> to init. Add <code>&reset=true</code> to wipe DB first.</p>');
    }

    try {
        const fs = require('fs');
        const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
        if (!fs.existsSync(schemaPath)) return res.status(500).send('Schema file missing');

        const sql = fs.readFileSync(schemaPath, 'utf8');

        // If reset=true, DROP everything first
        if (reset === 'true') {
            await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
        }

        const result = await db.exec(sql);

        if (result.ok) {
            res.send('<h1>✅ Database Initialized Successfully!</h1><p>Tables created. You can now go to the home page.</p>');
        } else {
            res.status(500).send(`<h1>❌ Error</h1><pre>${result.error}</pre>`);
        }
    } catch (e) {
        res.status(500).send(`<h1>❌ Exception</h1><pre>${e.message}</pre>`);
    }
});


// ─── PRODUCT CRUD API ─────────────────────────────────────────────────────────
// These provide structured, validated endpoints for POS item management
// instead of raw SQL passthrough via /api/db/query

// GET /api/products — list all products
app.get('/api/products', async (req, res) => {
    try {
        const { department, active, category } = req.query;
        let sql = 'SELECT * FROM products WHERE 1=1';
        const params = [];
        if (department) { sql += ' AND LOWER(department) = LOWER(?)'; params.push(department); }
        if (active !== undefined) { sql += ' AND active = ?'; params.push(active === 'true'); }
        if (category) { sql += ' AND LOWER(category) = LOWER(?)'; params.push(category); }
        sql += ' ORDER BY name ASC';
        const result = await db.query(sql, params);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/products/:id
app.get('/api/products/:id', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
        if (!result.rows || result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Product not found' });
        res.json({ ok: true, row: result.rows[0] });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/products — create or upsert product
app.post('/api/products', async (req, res) => {
    const { id, name, category, department, price, cost_price, stock_level, unit, active,
            visibility, bar_visibility, restaurant_visibility, is_stock_item,
            category_id, sub_id, notes, barcodes } = req.body;
    if (!id || !name) return res.status(400).json({ ok: false, error: 'id and name are required' });
    try {
        const visJson = visibility ? (typeof visibility === 'string' ? visibility : JSON.stringify(visibility)) : '{"bar":true,"restaurant":true}';
        const barVis = bar_visibility !== undefined ? bar_visibility : true;
        const restVis = restaurant_visibility !== undefined ? restaurant_visibility : true;
        const result = await db.query(`
            INSERT INTO products (id, name, category, department, price, cost_price, stock_level, unit,
                active, visibility, bar_visibility, restaurant_visibility, is_stock_item,
                category_id, sub_id, notes, barcodes, inserted_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name, category = EXCLUDED.category, department = EXCLUDED.department,
                price = EXCLUDED.price, cost_price = EXCLUDED.cost_price,
                stock_level = EXCLUDED.stock_level, unit = EXCLUDED.unit, active = EXCLUDED.active,
                visibility = EXCLUDED.visibility, bar_visibility = EXCLUDED.bar_visibility,
                restaurant_visibility = EXCLUDED.restaurant_visibility,
                is_stock_item = EXCLUDED.is_stock_item,
                category_id = COALESCE(EXCLUDED.category_id, products.category_id),
                sub_id = COALESCE(EXCLUDED.sub_id, products.sub_id),
                notes = EXCLUDED.notes, barcodes = EXCLUDED.barcodes, updated_at = NOW()
        `, [id, name, category || 'general', department || 'Restaurant',
            Number(price || 0), Number(cost_price || 0), Number(stock_level || 0),
            unit || 'units', active !== false, visJson, barVis, restVis,
            is_stock_item !== false, category_id || null, sub_id || null,
            notes || null, barcodes ? JSON.stringify(barcodes) : '[]']);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// PUT /api/products/:id — partial update (does NOT overwrite stock_level unless provided)
app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const allowed = ['name','category','department','price','cost_price','stock_level','unit',
                     'active','visibility','bar_visibility','restaurant_visibility','is_stock_item',
                     'category_id','sub_id','notes','barcodes','cos_percent','gp_percent','gp_amount',
                     'image_bg_color','picture_data','reorder_level'];
    const fields = []; const values = [];
    for (const f of allowed) {
        if (req.body[f] !== undefined) {
            if (f === 'visibility' && typeof req.body[f] !== 'string') {
                fields.push(`${f} = ?`); values.push(JSON.stringify(req.body[f]));
            } else if (f === 'barcodes' && typeof req.body[f] !== 'string') {
                fields.push(`${f} = ?`); values.push(JSON.stringify(req.body[f]));
            } else {
                fields.push(`${f} = ?`); values.push(req.body[f]);
            }
        }
    }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No updatable fields provided' });
    values.push(id);
    try {
        const result = await db.query(`UPDATE products SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`, values);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// DELETE /api/products/:id — atomic delete from all product tables
app.delete('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.transaction([
            { sql: 'DELETE FROM products WHERE id = ?', params: [id] },
            { sql: 'DELETE FROM inventory_items WHERE id = ?', params: [id] },
            { sql: 'DELETE FROM menu_items WHERE id = ?', params: [id] },
        ]);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// DELETE /api/products — bulk delete
app.delete('/api/products', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ ok: false, error: 'ids array required' });
    try {
        const ph = ids.map(() => '?').join(',');
        const result = await db.transaction([
            { sql: `DELETE FROM products WHERE id IN (${ph})`, params: ids },
            { sql: `DELETE FROM inventory_items WHERE id IN (${ph})`, params: ids },
            { sql: `DELETE FROM menu_items WHERE id IN (${ph})`, params: ids },
        ]);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// PUT /api/products/visibility — bulk update visibility
app.put('/api/products/visibility', async (req, res) => {
    const { ids, bar, restaurant } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ ok: false, error: 'ids array required' });
    try {
        const ph = ids.map(() => '?').join(',');
        const updateFields = [];
        const params = [];
        if (bar !== undefined) { updateFields.push('bar_visibility = ?'); params.push(bar); }
        if (restaurant !== undefined) { updateFields.push('restaurant_visibility = ?'); params.push(restaurant); }
        if (!updateFields.length) return res.status(400).json({ ok: false, error: 'bar or restaurant value required' });
        params.push(...ids);
        const result = await db.query(
            `UPDATE products SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id IN (${ph})`,
            params
        );
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/products/stock — get current stock levels
app.get('/api/products/stock', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, stock_level, reorder_level, unit FROM products WHERE is_stock_item = true ORDER BY name');
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// PATCH /api/products/:id/stock — update stock level only (inventory deduction)
app.patch('/api/products/:id/stock', async (req, res) => {
    const { id } = req.params;
    const { delta, reason, user_id } = req.body; // delta = +/- quantity change
    if (delta === undefined || isNaN(Number(delta))) return res.status(400).json({ ok: false, error: 'delta required' });
    try {
        const ops = [
            {
                sql: 'UPDATE products SET stock_level = GREATEST(0, stock_level + ?), updated_at = NOW() WHERE id = ?',
                params: [Number(delta), id]
            },
            {
                sql: `INSERT INTO inventory_movements (id, item_id, delta, reason, user_id, inserted_at)
                      VALUES (gen_random_uuid()::text, ?, ?, ?, ?, NOW())`,
                params: [id, Number(delta), reason || 'POS sale', user_id || 'system']
            }
        ];
        const result = await db.transaction(ops);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// ─── POS SHIFT MANAGEMENT API ─────────────────────────────────────────────────

// GET /api/pos/shifts — list shifts
app.get('/api/pos/shifts', async (req, res) => {
    try {
        const { date, status } = req.query;
        let sql = 'SELECT * FROM pos_shifts WHERE 1=1';
        const params = [];
        if (date) { sql += ' AND business_date = ?'; params.push(date); }
        if (status) { sql += ' AND status = ?'; params.push(status); }
        sql += ' ORDER BY opened_at DESC LIMIT 100';
        const result = await db.query(sql, params);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/pos/shifts/active — get active shift for a user
app.get('/api/pos/shifts/active', async (req, res) => {
    try {
        const { user_id } = req.query;
        let sql = "SELECT * FROM pos_shifts WHERE status = 'open'";
        const params = [];
        if (user_id) { sql += ' AND opened_by = ?'; params.push(user_id); }
        sql += ' ORDER BY opened_at DESC LIMIT 1';
        const result = await db.query(sql, params);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/pos/shifts — start a shift
app.post('/api/pos/shifts', async (req, res) => {
    const { id, opened_by, opening_cash, outlet, station_id } = req.body;
    if (!id || !opened_by) return res.status(400).json({ ok: false, error: 'id and opened_by required' });
    try {
        // Enforce one open shift per user
        const existing = await db.query(
            "SELECT id FROM pos_shifts WHERE opened_by = ? AND status = 'open' LIMIT 1",
            [opened_by]
        );
        if (existing.rows && existing.rows.length > 0) {
            return res.status(409).json({ ok: false, error: 'User already has an open shift', existing_id: existing.rows[0].id });
        }
        const shiftNum = await db.query('SELECT COALESCE(MAX(shift_number),0)+1 as next FROM pos_shifts WHERE business_date = CURRENT_DATE');
        const nextNum = shiftNum.rows?.[0]?.next || 1;
        const result = await db.query(`
            INSERT INTO pos_shifts (id, outlet, shift_number, business_date, opened_by, opening_cash, status, inserted_at, updated_at)
            VALUES (?, ?, ?, CURRENT_DATE, ?, ?, 'open', NOW(), NOW())
        `, [id, outlet || 'Restaurant', nextNum, opened_by, Number(opening_cash || 0)]);
        res.json({ ...result, shift_number: nextNum });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// PUT /api/pos/shifts/:id/close — close a shift
app.put('/api/pos/shifts/:id/close', async (req, res) => {
    const { id } = req.params;
    const { closing_cash, closed_by, total_sales, total_cash, total_card, total_room_charge,
            total_voids, transaction_count, void_count, z_reading_number } = req.body;
    try {
        const expected = await db.query('SELECT opening_cash FROM pos_shifts WHERE id = ?', [id]);
        const openingCash = expected.rows?.[0]?.opening_cash || 0;
        const cashVariance = closing_cash !== undefined ? Number(closing_cash) - (Number(openingCash) + Number(total_cash || 0)) : 0;
        const result = await db.query(`
            UPDATE pos_shifts SET
                status = 'closed', closed_at = NOW(), closed_by = ?,
                closing_cash = ?, expected_cash = ?, cash_variance = ?,
                total_sales = ?, total_cash = ?, total_card = ?,
                total_room_charge = ?, total_voids = ?,
                transaction_count = ?, void_count = ?,
                z_reading_number = ?, updated_at = NOW()
            WHERE id = ?
        `, [closed_by, Number(closing_cash || 0),
            Number(openingCash) + Number(total_cash || 0), cashVariance,
            Number(total_sales || 0), Number(total_cash || 0), Number(total_card || 0),
            Number(total_room_charge || 0), Number(total_voids || 0),
            Number(transaction_count || 0), Number(void_count || 0),
            z_reading_number || null, id]);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// PUT /api/pos/shifts/:id/totals — update running totals
app.put('/api/pos/shifts/:id/totals', async (req, res) => {
    const { id } = req.params;
    const { total_sales, total_cash, total_card, total_room_charge, tx_count } = req.body;
    try {
        const result = await db.query(`
            UPDATE pos_shifts SET
                total_sales = ?, total_cash = ?, total_card = ?,
                total_room_charge = ?, transaction_count = ?, updated_at = NOW()
            WHERE id = ? AND status = 'open'
        `, [Number(total_sales || 0), Number(total_cash || 0), Number(total_card || 0),
            Number(total_room_charge || 0), Number(tx_count || 0), id]);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/pos/orders — save a POS order/bill
app.post('/api/pos/orders', async (req, res) => {
    const { id, items, total_amount, status, outlet, shift_id, payment_method,
            business_date, table_number, guest_id, opened_by, closed_by } = req.body;
    if (!id || !total_amount === undefined) return res.status(400).json({ ok: false, error: 'id required' });
    try {
        const result = await db.query(`
            INSERT INTO pos_orders (id, items, total_amount, status, outlet, shift_id,
                payment_method, business_date, table_number, guest_id, opened_by, closed_by, updated_at, created_at)
            VALUES (?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
                items = EXCLUDED.items, total_amount = EXCLUDED.total_amount,
                status = EXCLUDED.status, payment_method = EXCLUDED.payment_method,
                closed_by = EXCLUDED.closed_by, updated_at = NOW()
        `, [id, JSON.stringify(items || []), Number(total_amount || 0),
            status || 'open', outlet || 'Restaurant', shift_id || null,
            payment_method || null, business_date || new Date().toISOString().slice(0,10),
            table_number || null, guest_id || null,
            opened_by || null, closed_by || null]);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/pos/reports/daily — daily POS summary by date
app.get('/api/pos/reports/daily', async (req, res) => {
    try {
        const { date } = req.query;
        const reportDate = date || new Date().toISOString().slice(0, 10);
        const result = await db.query(`
            SELECT
                COUNT(*) as order_count,
                SUM(total_amount) as gross_sales,
                outlet,
                payment_method
            FROM pos_orders
            WHERE status = 'closed' AND business_date = ?
            GROUP BY outlet, payment_method
            ORDER BY outlet, payment_method
        `, [reportDate]);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/printer/status — printer health check
app.get('/api/printer/status', (req, res) => {
    // Browser print is always available. Real thermal printers would need a different check.
    res.json({ connected: true, method: 'browser', lastCheck: new Date().toISOString() });
});

// ─── Inventory Reconciliation API Endpoints ─────────────────────────────────────

// GET /api/inventory/periods
app.get('/api/inventory/periods', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM inventory_periods ORDER BY period_year DESC, period_month DESC'
        );
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/inventory/periods
app.post('/api/inventory/periods', async (req, res) => {
    const { period_name, period_year, period_month, start_date, end_date, status, opening_stock_value, created_by } = req.body;
    if (!period_name || !period_year || !period_month || !start_date || !end_date) {
        return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    try {
        // Enforce: only one period may be open/reconciling at a time
        const openCheck = await db.query(
            "SELECT id FROM inventory_periods WHERE status IN ('open', 'reconciling') LIMIT 1"
        );
        if (openCheck.rows && openCheck.rows.length > 0) {
            return res.status(409).json({ ok: false, error: 'Another period is already open or reconciling. Close it before creating a new one.' });
        }

        const result = await db.query(
            `INSERT INTO inventory_periods (period_name, period_year, period_month, start_date, end_date, status, opening_stock_value, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, period_name, period_year, period_month, status`,
            [period_name, period_year, period_month, start_date, end_date, status || 'open', opening_stock_value || 0, created_by]
        );
        res.json({ ok: true, rows: result.rows, id: result.rows?.[0]?.id });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// PUT /api/inventory/periods/:id
app.put('/api/inventory/periods/:id', async (req, res) => {
    const { id } = req.params;
    const fields = [];
    const values = [];
    const allowedFields = ['period_name', 'status', 'closing_stock_value', 'variance_value', 'cogs_value', 'kitchen_cogs', 'cellar_cogs', 'closed_by', 'closed_reason', 'reopened_at', 'reopened_by', 'is_locked', 'locked_at', 'locked_by'];
    
    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            fields.push(`${field} = ?`);
            values.push(req.body[field]);
        }
    }
    
    if (fields.length === 0) {
        return res.status(400).json({ ok: false, error: 'No fields to update' });
    }
    
    values.push(id);
    
    try {
        // If status is being changed to 'open' or 'reconciling', enforce singleton
        const newStatus = req.body.status;
        if (newStatus && ['open', 'reconciling'].includes(newStatus)) {
            const existing = await db.query(
                "SELECT id FROM inventory_periods WHERE status IN ('open', 'reconciling') AND id != ?",
                [id]
            );
            if (existing.rows && existing.rows.length > 0) {
                return res.status(409).json({ ok: false, error: 'Another period is already open or reconciling.' });
            }
        }
        
        const result = await db.query(
            `UPDATE inventory_periods SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
            values
        );
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/inventory/transactions
app.get('/api/inventory/transactions', async (req, res) => {
    const { period_id, limit } = req.query;
    let sql = 'SELECT * FROM inventory_transactions WHERE is_deleted = false';
    const params = [];
    
    if (period_id) {
        sql += ' AND period_id = ?';
        params.push(period_id);
    }
    
    sql += ' ORDER BY transaction_date DESC';
    
    if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit));
    }
    
    try {
        const result = await db.query(sql, params);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/inventory/transactions
app.post('/api/inventory/transactions', async (req, res) => {
    const { transaction_type, transaction_number, period_id, transaction_date, department, total_quantity, total_value, supplier_name, created_by, is_historical_backfill } = req.body;
    if (!transaction_type || !transaction_number || !transaction_date || !department) {
        return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    try {
        // Validate period exists and is not locked/closed (if period_id provided)
        if (period_id) {
            const periodCheck = await db.query('SELECT status, is_locked FROM inventory_periods WHERE id = ?', [period_id]);
            if (!periodCheck.rows || periodCheck.rows.length === 0) {
                return res.status(404).json({ ok: false, error: 'Period not found' });
            }
            const period = periodCheck.rows[0];
            if (period.is_locked) {
                return res.status(403).json({ ok: false, error: 'Period is locked. Cannot add transactions.' });
            }
            if (['closed', 'locked'].includes(period.status)) {
                return res.status(403).json({ ok: false, error: `Period is ${period.status}. Cannot add transactions.` });
            }
        }

        // Insert transaction and optionally bump period received_value (for receipts) atomically
        const ops = [
            {
                sql: `INSERT INTO inventory_transactions (transaction_type, transaction_number, period_id, transaction_date, department, total_quantity, total_value, supplier_name, created_by, is_historical_backfill)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [transaction_type, transaction_number, period_id, transaction_date, department, total_quantity || 0, total_value || 0, supplier_name, created_by, is_historical_backfill || false]
            }
        ];

        if (['purchase', 'grv'].includes(transaction_type) && period_id) {
            ops.push({
                sql: `UPDATE inventory_periods SET received_value = COALESCE(received_value,0) + ? WHERE id = ?`,
                params: [total_value || 0, period_id]
            });
        }

        const result = await db.transaction(ops);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/inventory/batch-reconcile
// Atomically process batch physical count updates, create snapshots, and generate adjustment transactions
app.post('/api/inventory/batch-reconcile', async (req, res) => {
    const { period_id, user_id, items } = req.body;  // items: [{ product_id, physical_qty, cost_price? }]
    if (!period_id || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ ok: false, error: 'Invalid request: period_id and items array required' });
    }

    // PHASE-1 FIX: db.pool.connect() was crashing (pool not exposed by db-web.cjs).
    // Refactored to use db.transaction(ops[]) for atomicity without exposing pool.
    try {
        // 1. Validate period (read — outside transaction)
        const periodRes = await db.query('SELECT status, is_locked FROM inventory_periods WHERE id = ?', [period_id]);
        if (!periodRes.rows?.length) return res.status(404).json({ ok: false, error: 'Period not found' });
        const period = periodRes.rows[0];
        if (period.is_locked) return res.status(403).json({ ok: false, error: 'Period is locked. Cannot reconcile.' });
        if (period.status !== 'reconciling') return res.status(403).json({ ok: false, error: `Period must be in 'reconciling' state, current: ${period.status}` });

        // 2. Pre-fetch all products (reads — outside transaction)
        const productIds = items.map(i => i.product_id).filter(Boolean);
        const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
        const allProds = productIds.length > 0
            ? await db.query(`SELECT id, department, stock_level, cost_price FROM products WHERE id IN (${placeholders})`, productIds)
            : { rows: [] };
        const prodMap = Object.fromEntries((allProds.rows || []).map(p => [p.id, p]));

        // 3. Build transaction ops
        const today = new Date().toISOString().split('T')[0];
        const ops = [];

        for (const item of items) {
            const { product_id, physical_qty, cost_price } = item;
            const physQty = Number(physical_qty) || 0;
            const product = prodMap[product_id];
            if (!product) continue; // skip unknown products
            const bookQty = Number(product.stock_level || 0);
            const currentCost = Number(product.cost_price || 0);
            const newCost = (cost_price != null) ? Number(cost_price) : currentCost;
            const variance = physQty - bookQty;
            const totalValue = variance * newCost;

            // Upsert snapshot (physical_qty + variance; opening/received are period-level, set 0 here)
            ops.push({
                sql: `INSERT INTO inventory_snapshots (period_id, product_id, physical_qty, variance, opening_qty, received_qty, system_usage_qty)
                      VALUES (?, ?, ?, ?, 0, 0, 0)
                      ON CONFLICT (period_id, product_id) DO UPDATE SET
                        physical_qty = EXCLUDED.physical_qty,
                        variance = EXCLUDED.variance,
                        updated_at = NOW()`,
                params: [period_id, product_id, physQty, variance]
            });

            // Adjustment transaction only when variance exists
            if (variance !== 0) {
                ops.push({
                    sql: `INSERT INTO inventory_transactions
                          (transaction_type, transaction_number, period_id, transaction_date, department, total_quantity, total_value, created_by)
                          VALUES ('adjustment', ?, ?, ?, ?, ?, ?, ?)`,
                    params: [`BATCH-${Date.now()}-${String(product_id).slice(0,8)}`, period_id, today, product.department || 'General', variance, totalValue, user_id || 'system']
                });
            }

            // Update product stock + optionally cost_price + record last reconciliation
            if (cost_price != null) {
                ops.push({ sql: 'UPDATE products SET stock_level=?, cost_price=?, last_inventory_period_id=?, last_physical_qty=?, last_physical_date=NOW(), updated_at=NOW() WHERE id=?', params: [physQty, newCost, period_id, physQty, product_id] });
            } else {
                ops.push({ sql: 'UPDATE products SET stock_level=?, last_inventory_period_id=?, last_physical_qty=?, last_physical_date=NOW(), updated_at=NOW() WHERE id=?', params: [physQty, period_id, physQty, product_id] });
            }
        }

        if (ops.length > 0) {
            const txResult = await db.transaction(ops);
            if (!txResult.ok) throw new Error(txResult.error || 'Transaction failed');
        }

        res.json({ ok: true, message: `Batch reconciled ${items.length} items` });
    } catch (e) {
        console.error('Batch reconcile error:', e);
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/inventory/audit
app.get('/api/inventory/audit', async (req, res) => {
    const { period_id, limit } = req.query;
    let sql = 'SELECT * FROM inventory_period_audit';
    const params = [];
    
    if (period_id) {
        sql += ' WHERE period_id = ?';
        params.push(period_id);
    }
    
    sql += ' ORDER BY timestamp DESC';
    
    if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit));
    }
    
    try {
        const result = await db.query(sql, params);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/inventory/close
// Finalizes a reconciliation period: creates snapshots, adjustment transactions,
// updates product stocks, and locks the period.
app.post('/api/inventory/close', async (req, res) => {
    const { period_id, closed_by, closed_reason, manager_override } = req.body;
    if (!period_id || !closed_by) {
        return res.status(400).json({ ok: false, error: 'Period ID and closed_by required' });
    }

    // PHASE-1 FIX: db.pool.connect() crash replaced with db.transaction(ops[]).
    // PHASE-2 FIX: removed broken per-product aggregation (inventory_transactions has no product_id);
    //              snapshot stores physical_qty + variance; COGS computed from period totals.
    try {
        // 1. Validate period (read)
        const periodRes = await db.query('SELECT * FROM inventory_periods WHERE id = ?', [period_id]);
        if (!periodRes.rows?.length) return res.status(404).json({ ok: false, error: 'Period not found' });
        const period = periodRes.rows[0];
        if (period.is_locked) return res.status(403).json({ ok: false, error: 'Period already locked' });
        if (period.status !== 'reconciling') return res.status(403).json({ ok: false, error: `Period must be in 'reconciling' state, current: ${period.status}` });

        // 2. Zero-capture check
        const txCountRes = await db.query(
            `SELECT COUNT(*) as cnt FROM inventory_transactions WHERE period_id = ? AND transaction_type IN ('purchase','grv')`, [period_id]
        );
        const txCount = Number(txCountRes.rows?.[0]?.cnt || 0);
        if (txCount === 0 && !manager_override) {
            return res.status(403).json({ ok: false, error: 'ZERO_CAPTURE', message: 'No inventory receipts found. Set manager_override:true to force close.' });
        }

        // 3. Fetch products with physical counts for this period
        const prodRes = await db.query(
            `SELECT id, name, department, stock_level, cost_price, last_physical_qty
             FROM products WHERE last_inventory_period_id = ?`, [period_id]
        );
        if (!prodRes.rows?.length) {
            return res.status(400).json({ ok: false, error: 'No physical counts recorded. Perform a stock take before closing.' });
        }
        const products = prodRes.rows;

        // 4. Compute closing totals
        let totalClosingValue = 0, totalVarianceValue = 0;
        let kitchenVarianceValue = 0, cellarVarianceValue = 0;
        const today = new Date().toISOString().split('T')[0];
        const ops = [];

        for (const p of products) {
            const physQty = Number(p.last_physical_qty || 0);
            const bookQty = Number(p.stock_level || 0);
            const costPrice = Number(p.cost_price || 0);
            const variance = physQty - bookQty;
            const varianceValue = variance * costPrice;
            const physValue = physQty * costPrice;

            totalClosingValue += physValue;
            totalVarianceValue += varianceValue;
            if ((p.department || '').toLowerCase() === 'kitchen') kitchenVarianceValue += varianceValue;
            else if ((p.department || '').toLowerCase() === 'cellar') cellarVarianceValue += varianceValue;

            // Upsert snapshot (physical_qty + variance; no per-product transaction breakdown available)
            ops.push({
                sql: `INSERT INTO inventory_snapshots (period_id, product_id, physical_qty, variance, opening_qty, received_qty, system_usage_qty)
                      VALUES (?, ?, ?, ?, 0, 0, 0)
                      ON CONFLICT (period_id, product_id) DO UPDATE SET
                        physical_qty = EXCLUDED.physical_qty, variance = EXCLUDED.variance, updated_at = NOW()`,
                params: [period_id, p.id, physQty, variance]
            });

            // Variance adjustment transaction
            if (variance !== 0) {
                ops.push({
                    sql: `INSERT INTO inventory_transactions (transaction_type, transaction_number, period_id, transaction_date, department, total_quantity, total_value, created_by)
                          VALUES ('adjustment', ?, ?, ?, ?, ?, ?, ?)`,
                    params: [`CLS-${Date.now()}-${p.id.slice(0,8)}`, period_id, today, p.department || 'General', variance, varianceValue, closed_by]
                });
            }

            // Update product stock to physical count
            ops.push({ sql: 'UPDATE products SET stock_level=?, updated_at=NOW() WHERE id=?', params: [physQty, p.id] });
        }

        // 5. Lock and close the period
        const openingStock = Number(period.opening_stock_value || 0);
        const receivedValue = Number(period.received_value || 0);
        const cogsValue = openingStock + receivedValue - totalClosingValue;

        ops.push({
            sql: `UPDATE inventory_periods SET status='closed', closing_stock_value=?, variance_value=?, cogs_value=?, kitchen_cogs=?, cellar_cogs=?, closed_at=NOW(), closed_by=?, closed_reason=?, is_locked=true, locked_at=NOW() WHERE id=?`,
            params: [totalClosingValue, totalVarianceValue, cogsValue, kitchenVarianceValue, cellarVarianceValue, closed_by, closed_reason || '', period_id]
        });

        // 6. Audit: zero-capture override
        if (txCount === 0 && manager_override) {
            ops.push({
                sql: `INSERT INTO inventory_period_audit (period_id, action, user_id, user_name, change_reason) VALUES (?, 'ZERO_CAPTURE_OVERRIDE', ?, ?, ?)`,
                params: [period_id, closed_by, closed_by, 'Manager override: closed period with zero receipts']
            });
        }

        const txResult = await db.transaction(ops);
        if (!txResult.ok) throw new Error(txResult.error || 'Transaction failed');

        res.json({ ok: true, message: 'Period closed successfully', closing_stock_value: totalClosingValue, variance_value: totalVarianceValue, cogs_value: cogsValue });
    } catch (e) {
        console.error('Close period error:', e);
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/inventory/reopen
app.post('/api/inventory/reopen', async (req, res) => {
    const { period_id, reopened_by } = req.body;
    if (!period_id) {
        return res.status(400).json({ ok: false, error: 'Period ID required' });
    }
    try {
        const periodRes = await db.query('SELECT * FROM inventory_periods WHERE id = ?', [period_id]);
        if (!periodRes.rows || periodRes.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Period not found' });
        }
        const period = periodRes.rows[0];
        // Only locked/closed periods can be reopened
        if (!period.is_locked) {
            return res.status(400).json({ ok: false, error: 'Period is not locked and cannot be reopened' });
        }

        const result = await db.query(
            `UPDATE inventory_periods 
             SET status = 'open', 
                 closed_at = NULL, closed_by = NULL, closed_reason = NULL,
                 is_locked = false, locked_at = NULL, locked_by = NULL,
                 reopened_at = NOW(), reopened_by = ?
             WHERE id = ?`,
            [reopened_by, period_id]
        );
        
        // Audit log for reopen
        await db.query(
            `INSERT INTO inventory_period_audit (period_id, action, user_id, user_name, change_reason)
             VALUES (?, 'PERIOD_REOPENED', ?, ?, ?)`,
            [period_id, reopened_by, reopened_by, 'Period reopened for correction']
        );
        
        res.json({ ok: true, message: 'Period reopened successfully', result });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// ============================================================================
// REPORTS API ENDPOINTS
// ============================================================================

// GET /api/reports/flash - Flash report for a specific date
app.get('/api/reports/flash', async (req, res) => {
    const { date } = req.query;
    try {
        const result = await db.query(
            `SELECT * FROM night_audit_runs WHERE business_date = $1`,
            [date]
        );
        if (result.rows && result.rows.length > 0) {
            res.json({ 
                ok: true, 
                data: result.rows[0].reports_snapshot,
                business_date: result.rows[0].business_date,
                room_revenue: result.rows[0].room_revenue,
                total_revenue: result.rows[0].total_revenue,
                occupancy_percent: result.rows[0].occupancy_percent,
                adr: result.rows[0].adr,
                revpar: result.rows[0].revpar
            });
        } else {
            res.json({ ok: false, error: 'No data for specified date' });
        }
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/reports/pos-recon - POS reconciliation for a date
app.get('/api/reports/pos-recon', async (req, res) => {
    const { date } = req.query;
    try {
        const result = await db.query(
            `SELECT * FROM pos_shifts WHERE business_date = $1 AND status = 'closed'`,
            [date]
        );
        res.json({ ok: true, rows: result.rows || [] });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/reports/trial-balance?from=YYYY-MM-DD&to=YYYY-MM-DD
// Per-account debit/credit/balance for the date range from gl_journal_lines.
// (Mirror of the Vercel api/handler.js endpoint so Render serves identical data.)
app.get('/api/reports/trial-balance', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.json({ ok: false, error: 'from and to required' });
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
            accountId: r.accountId, name: r.name, category: r.category,
            debit: Number(r.debit), credit: Number(r.credit), balance: Number(r.balance)
        }));
        res.json({ ok: true, rows });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/reports/pl?from=YYYY-MM-DD&to=YYYY-MM-DD
// Revenue/Expense per-account + GOP for the date range from gl_journal_lines.
app.get('/api/reports/pl', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.json({ ok: false, error: 'from and to required' });
    try {
        const result = await db.query(
            `SELECT
               COALESCE(a.category, 'Unknown') AS category,
               COALESCE(NULLIF(a.department, ''), 'Undistributed') AS department,
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
             GROUP BY a.category, a.department, jl.gl_account_id, a.name
             ORDER BY a.category, COALESCE(NULLIF(a.department, ''), 'Undistributed'), a.name`,
            [from, to]
        );
        const rows = result.ok ? result.rows || [] : [];
        const revenue = rows.filter(r => r.category === 'Revenue').reduce((s, r) => s + Number(r.revenue_net), 0);
        const expense = rows.filter(r => r.category === 'Expense').reduce((s, r) => s + Number(r.expense_net), 0);
        const lineItems = rows.map(r => ({
            category: r.category, department: r.department, accountId: r.accountId, name: r.name,
            amount: r.category === 'Revenue' ? Number(r.revenue_net) : Number(r.expense_net)
        }));
        res.json({ ok: true, revenue: Number(revenue.toFixed(2)), expense: Number(expense.toFixed(2)), gop: Number((revenue - expense).toFixed(2)), rows: lineItems });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/reports/journals?from=YYYY-MM-DD&to=YYYY-MM-DD[&source=...]
// Every GL posting (one row per journal LINE) in the date range, with its
// parent entry context. Powers the "Journal Postings (GL)" report — including
// the revenue journals the Baradzanwa controller posts. Posted, non-voided only.
app.get('/api/reports/journals', async (req, res) => {
    const { from, to, source } = req.query;
    if (!from || !to) return res.json({ ok: false, error: 'from and to required' });
    try {
        const params = [from, to];
        let sourceClause = '';
        if (source && source !== 'all') { params.push(source); sourceClause = ` AND je.source = $${params.length}`; }
        const result = await db.query(
            `SELECT
               je.business_date::text AS business_date,
               je.id            AS entry_id,
               je.reference     AS reference,
               je.source        AS source,
               je.description   AS entry_description,
               COALESCE(je.posted_by, je.created_by, 'system') AS posted_by,
               COALESCE(je.posted_at, je.inserted_at)::text    AS posted_at,
               jl.line_number   AS line_number,
               jl.gl_account_id AS account_id,
               COALESCE(a.name, jl.gl_account_id) AS account_name,
               COALESCE(a.category, 'Unknown')    AS account_category,
               COALESCE(NULLIF(a.department, ''), 'Undistributed') AS department,
               COALESCE(jl.description, je.description) AS line_description,
               COALESCE(jl.debit_amount, 0)::numeric(14,2)  AS debit,
               COALESCE(jl.credit_amount, 0)::numeric(14,2) AS credit
             FROM gl_journal_lines jl
             JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
             LEFT JOIN gl_accounts a    ON a.id = jl.gl_account_id
             WHERE je.business_date >= $1::date
               AND je.business_date <= $2::date
               AND je.status = 'posted'
               AND je.is_voided = false${sourceClause}
             ORDER BY je.business_date, je.id, jl.line_number`,
            params
        );
        const rows = (result.ok ? result.rows || [] : []).map(r => ({
            business_date: r.business_date, entry_id: r.entry_id, reference: r.reference,
            source: r.source, entry_description: r.entry_description, line_number: r.line_number,
            account_id: r.account_id, account_name: r.account_name, account_category: r.account_category,
            department: r.department, posted_by: r.posted_by, posted_at: r.posted_at,
            line_description: r.line_description, debit: Number(r.debit), credit: Number(r.credit)
        }));
        const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
        res.json({ ok: true, rows, totalDebit: Number(totalDebit.toFixed(2)), totalCredit: Number(totalCredit.toFixed(2)) });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// ─── Guest Folio Statement (front-office, incl. checked-out guests) ──────────
// GET /api/folio/statement?reservation_id=…  OR  ?guest_id=…  OR ?folio_id=…
// Full charge & payment history for a guest's stay with a running balance —
// works AFTER checkout (reads folio_charges, which persists post-checkout).
app.get('/api/folio/statement', async (req, res) => {
  const { reservation_id, guest_id, folio_id } = req.query;
  if (!reservation_id && !guest_id && !folio_id)
    return res.json({ ok: false, error: 'reservation_id, guest_id or folio_id required' });
  // Format a pg DATE/timestamp (returned as a JS Date at UTC midnight) or string
  // to a clean YYYY-MM-DD — String(date).slice mangles Date objects.
  const ymd = (v) => {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v);
    const m = s.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : (new Date(s).toISOString().slice(0, 10));
  };
  try {
    // Locate the charges by whichever key was supplied
    const conds = []; const params = [];
    if (reservation_id) { params.push(reservation_id); conds.push(`fc.reservation_id = $${params.length}`); }
    if (guest_id)       { params.push(guest_id);       conds.push(`fc.guest_id = $${params.length}`); }
    if (folio_id)       { params.push(folio_id);       conds.push(`fc.folio_id = $${params.length}`); }
    const where = conds.join(' OR ');

    const chargesRes = await db.query(
      `SELECT fc.id, fc.charge_type, fc.category, fc.description, fc.amount, fc.tax_amount,
              fc.total_amount, fc.source, fc.source_reference, fc.department,
              COALESCE(fc.business_date, fc.posting_date, fc.inserted_at::date) AS tx_date,
              fc.posting_date, fc.room_number, fc.is_voided, fc.guest_id, fc.reservation_id, fc.folio_id
       FROM folio_charges fc
       WHERE (${where}) AND fc.is_voided IS NOT TRUE
       ORDER BY COALESCE(fc.business_date, fc.posting_date, fc.inserted_at::date), fc.inserted_at`,
      params
    );
    const rows = chargesRes.rows || [];

    // Header: guest, room, stay dates — from reservations/guests/folios when available
    let header = { guest_name: null, room_number: null, arrival: null, departure: null, status: null, folio_id: null, reservation_id: null };
    try {
      const rid = reservation_id || rows.find(r => r.reservation_id)?.reservation_id;
      const gid = guest_id || rows.find(r => r.guest_id)?.guest_id;
      if (rid) {
        const rr = await db.query(
          `SELECT r.id AS reservation_id, r.status, r.check_in_date, r.check_out_date, r.guest_id,
                  g.full_name AS guest_name, ro.number AS room_number
           FROM reservations r
           LEFT JOIN guests g ON g.id = r.guest_id
           LEFT JOIN rooms ro ON ro.id = r.room_id
           WHERE r.id = $1 LIMIT 1`, [rid]);
        if (rr.rows?.length) {
          const x = rr.rows[0];
          header = { guest_name: x.guest_name, room_number: x.room_number || rows[0]?.room_number || null,
                     arrival: ymd(x.check_in_date), departure: ymd(x.check_out_date), status: x.status,
                     folio_id: rows[0]?.folio_id || null, reservation_id: x.reservation_id };
        }
      }
      if (!header.guest_name && gid) {
        const gr = await db.query(`SELECT full_name FROM guests WHERE id = $1 LIMIT 1`, [gid]);
        if (gr.rows?.length) header.guest_name = gr.rows[0].full_name;
      }
      if (!header.room_number && rows[0]?.room_number) header.room_number = rows[0].room_number;
    } catch { /* header best-effort */ }

    // Running balance: charges add, payments subtract
    let balance = 0, charges = 0, payments = 0;
    const lines = rows.map(r => {
      const isPayment = String(r.charge_type || '').toLowerCase() === 'payment' || String(r.category || '').toLowerCase() === 'payment';
      const gross = Number(r.total_amount ?? (Number(r.amount || 0) + Number(r.tax_amount || 0)));
      const charge = isPayment ? 0 : gross;
      const payment = isPayment ? Math.abs(gross) : 0;
      charges += charge; payments += payment; balance += charge - payment;
      return {
        date: ymd(r.tx_date),
        description: r.description || (isPayment ? 'Payment' : r.category || 'Charge'),
        category: r.category, department: r.department, reference: r.source_reference,
        charge: Number(charge.toFixed(2)), payment: Number(payment.toFixed(2)),
        balance: Number(balance.toFixed(2)),
      };
    });

    res.json({
      ok: true, header, lines,
      totalCharges: Number(charges.toFixed(2)),
      totalPayments: Number(payments.toFixed(2)),
      closingBalance: Number(balance.toFixed(2)),
    });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// GET /api/reports/balance-sheet?as_of=YYYY-MM-DD
// Classified balance sheet from gl_journal_lines up to as_of: Assets (debit-normal),
// Liabilities & Equity (credit-normal), plus Current-Year Earnings (Revenue−Expense)
// folded into Equity so the accounting equation Assets = Liabilities + Equity holds.
app.get('/api/reports/balance-sheet', async (req, res) => {
    const asOf = req.query.as_of || new Date().toISOString().slice(0, 10);
    try {
        const r = await db.query(
            `SELECT a.id, a.name, a.category,
                    COALESCE(SUM(jl.debit_amount),0)::numeric(14,2)  AS dr,
                    COALESCE(SUM(jl.credit_amount),0)::numeric(14,2) AS cr
             FROM gl_accounts a
             LEFT JOIN gl_journal_lines jl ON jl.gl_account_id = a.id
             LEFT JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
                   AND je.status = 'posted' AND je.is_voided = false
                   AND je.business_date <= $1::date
             GROUP BY a.id, a.name, a.category`,
            [asOf]
        );
        const rows = r.ok ? r.rows || [] : [];
        const bal = (x) => Number(x.dr) - Number(x.cr); // debit-normal signed balance
        const sections = { Asset: [], Liability: [], Equity: [] };
        let revenue = 0, expense = 0;
        for (const x of rows) {
            const signed = bal(x);
            if (x.category === 'Asset' && signed !== 0) sections.Asset.push({ id: x.id, name: x.name, amount: Number(signed.toFixed(2)) });
            else if (x.category === 'Liability' && signed !== 0) sections.Liability.push({ id: x.id, name: x.name, amount: Number((-signed).toFixed(2)) });
            else if (x.category === 'Equity' && signed !== 0) sections.Equity.push({ id: x.id, name: x.name, amount: Number((-signed).toFixed(2)) });
            else if (x.category === 'Revenue') revenue += -signed;   // credit-normal
            else if (x.category === 'Expense') expense += signed;    // debit-normal
        }
        const currentEarnings = Number((revenue - expense).toFixed(2));
        if (currentEarnings !== 0) sections.Equity.push({ id: 'CYE', name: 'Current-Year Earnings (net income)', amount: currentEarnings });
        const totalAssets = Number(sections.Asset.reduce((s, a) => s + a.amount, 0).toFixed(2));
        const totalLiabilities = Number(sections.Liability.reduce((s, a) => s + a.amount, 0).toFixed(2));
        const totalEquity = Number(sections.Equity.reduce((s, a) => s + a.amount, 0).toFixed(2));
        res.json({
            ok: true, as_of: asOf, sections,
            totals: { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity,
                      liabilities_plus_equity: Number((totalLiabilities + totalEquity).toFixed(2)),
                      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01 }
        });
    } catch (e) { res.json({ ok: false, error: e.message }); }
});

// GET /api/reports/aged-ar?as_of=YYYY-MM-DD
// City ledger aging: each outstanding transaction (debit>credit) with its age bucket.
app.get('/api/reports/aged-ar', async (req, res) => {
    const asOf = req.query.as_of || new Date().toISOString().split('T')[0];
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
            account: r.account_name, type: r.account_type, date: r.date,
            amount: Number(r.net_amount),
            bucket: Number(r.age_days) <= 30 ? '0-30'
                  : Number(r.age_days) <= 60 ? '31-60'
                  : Number(r.age_days) <= 90 ? '61-90'
                  : '90+'
        }));
        res.json({ ok: true, rows });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/reports/inventory-cogs - Monthly inventory COGS
app.get('/api/reports/inventory-cogs', async (req, res) => {
    const { month } = req.query;
    res.json({ ok: true, rows: [] }); // Placeholder - integrate with inventory module
});

// GET /api/reports/night-audit-runs - Get all night audit runs for date range
app.get('/api/reports/night-audit-runs', async (req, res) => {
    const { start_date, end_date } = req.query;
    try {
        const result = await db.query(
            `SELECT * FROM night_audit_runs WHERE business_date >= $1 AND business_date <= $2 ORDER BY business_date DESC`,
            [start_date, end_date]
        );
        res.json({ ok: true, rows: result.rows || [] });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/reports/load-historical - Load historical night audit data into localStorage
app.post('/api/reports/load-historical', async (req, res) => {
    const { days_back } = req.body;
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (days_back || 30));
        
        const result = await db.query(
            `SELECT * FROM night_audit_runs WHERE business_date >= $1 ORDER BY business_date DESC`,
            [startDate.toISOString().slice(0, 10)]
        );
        
        const reports = {};
        for (const row of result.rows || []) {
            const date = row.business_date;
            reports[`corepms_nightAudit_reports_${date}`] = row.reports_snapshot;
            reports[`corepms_nightAudit_reports_${date}`] = {
                date,
                roomRevenue: row.room_revenue,
                fbRevenue: row.total_revenue - row.room_revenue,
                totalRevenue: row.total_revenue,
                occupancy: row.occupancy_percent,
                avgDailyRate: row.adr,
                revPAR: row.revpar
            };
        }
        
        res.json({ ok: true, loaded_dates: Object.keys(reports), count: result.rows?.length || 0 });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// Price Management routes (with WebSocket real-time sync)
try {
  const pricesRoutes = require('./routes/prices.cjs');
  console.log('💰 Registering price routes at /api/v1/prices');
  app.use('/api/v1/prices', pricesRoutes);
} catch (error) {
  console.error('❌ Failed to load price routes:', error.message);
}

// Temporary: Add the inventory routes
try {
  const inventoryV11Routes = require('./routes/inventory-v11.cjs');
  console.log('📦 Registering inventory routes at /api/v1/inventory');
  app.use('/api/v1/inventory', inventoryV11Routes);
} catch (error) {
  console.error('❌ Failed to load inventory routes:', error.message);
}

// System / Maintenance routes
try {
  const systemRoutes = require('./routes/system.cjs');
  console.log('🛠️ Registering system routes at /api/system');
  app.use('/api/system', systemRoutes);
} catch (error) {
  console.error('❌ Failed to load system routes:', error.message);
}

// Night Audit API + SSE routes
try {
  const { router: nightAuditRoutes } = require('./routes/nightAuditApi.cjs');
  console.log('🌙 Registering night audit routes at /api/night-audit');
  app.use('/api/night-audit', nightAuditRoutes);
} catch (error) {
  console.error('❌ Failed to load night audit routes:', error.message);
}

// Catch-all handler: serve React app for client-side routing
app.use((req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// Start Server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT} (listening on all interfaces)`);
    console.log(`📊 Database URL: ${process.env.DATABASE_URL ? 'Configured' : 'Missing (Check .env)'}`);
    console.log(`🌐 Server ready at http://localhost:${PORT}`);

    // Bootstrap: ensure system_configs has business_date and schedule entries,
    // then start the nightly scheduler
    const runner = require('./services/nightAuditRunner.cjs');
    const dbMod  = require('./db-web.cjs');

    (async () => {
      // ── Auto-create critical POS/FO tables if absent ────────────────────────
      await dbMod.query(`
        CREATE TABLE IF NOT EXISTS table_status (
          table_id    TEXT PRIMARY KEY,
          status      TEXT NOT NULL DEFAULT 'open',
          last_update TIMESTAMPTZ DEFAULT NOW(),
          cost_center TEXT
        )
      `);
      // Seed 12 default tables if none exist
      const tblCheck = await dbMod.query(`SELECT COUNT(*) as c FROM table_status`);
      if (tblCheck.ok && Number(tblCheck.rows[0]?.c) === 0) {
        const inserts = Array.from({ length: 12 }, (_, i) =>
          `INSERT INTO table_status (table_id, status) VALUES ('t${i+1}', 'open') ON CONFLICT DO NOTHING`
        );
        for (const sql of inserts) await dbMod.query(sql);
        console.log('🪑 Seeded 12 default POS tables');
      }

      await dbMod.query(`
        ALTER TABLE products
          ADD COLUMN IF NOT EXISTS bar_visibility        BOOLEAN DEFAULT true,
          ADD COLUMN IF NOT EXISTS restaurant_visibility BOOLEAN DEFAULT true
      `);

      // Auto-create system_configs rows if absent
      await dbMod.query(`
        INSERT INTO system_configs (key, value, description, updated_at, updated_by)
        VALUES
          ('night_audit_schedule',
           '{"enabled":true,"hour":21,"minute":0,"timezone":"Africa/Harare"}'::jsonb,
           'Auto night audit schedule', NOW(), 'system'),
          ('night_audit_lock',
           '{"locked":false}'::jsonb,
           'Night audit system lock', NOW(), 'system'),
          ('business_date',
           json_build_object('date', to_char((NOW() AT TIME ZONE 'Africa/Harare')::date,'YYYY-MM-DD'), 'rolled_at', NOW()::text)::jsonb,
           'Current hotel business date', NOW(), 'system')
        ON CONFLICT (key) DO NOTHING
      `);

      // ── Guard: business_date can never be stored more than one day ahead of ──
      // the hotel's real calendar date (Africa/Harare). Enforced at the DB so it
      // is unbypassable by ANY writer (server roller, frontend rollover, or a raw
      // /api/db/query). This is the backstop that prevents the date ever drifting
      // ahead again, independent of which frontend bundle a client is running.
      await dbMod.query(`
        CREATE OR REPLACE FUNCTION clamp_business_date() RETURNS trigger AS $$
        DECLARE cap date;
        BEGIN
          IF NEW.key = 'business_date' AND NEW.value ? 'date' THEN
            cap := (NOW() AT TIME ZONE 'Africa/Harare')::date + 1;
            IF (NEW.value->>'date')::date > cap THEN
              NEW.value := jsonb_set(NEW.value, '{date}', to_jsonb(cap::text));
              NEW.value := jsonb_set(NEW.value, '{clamped}', 'true'::jsonb);
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await dbMod.query(`DROP TRIGGER IF EXISTS trg_clamp_business_date ON system_configs`);
      await dbMod.query(`
        CREATE TRIGGER trg_clamp_business_date
          BEFORE INSERT OR UPDATE ON system_configs
          FOR EACH ROW EXECUTE FUNCTION clamp_business_date()
      `);

      // ── Guard: night_audit_runs can never be dated more than one day ahead of ──
      // the hotel's real date. Audits only close past/current days, so a future
      // business_date is always drift (e.g. a stale-cached operator browser
      // running a client-side audit). The system_configs clamp above does not
      // cover this table, so guard it too — this blocks the phantom future audit
      // rows at the DB regardless of which client/path inserts them.
      await dbMod.query(`
        CREATE OR REPLACE FUNCTION guard_audit_run_date() RETURNS trigger AS $$
        DECLARE cap date;
        BEGIN
          -- An audit can only close today or a PAST day — never a future day.
          -- So the cap is hotel-today (CAT), not today+1. (next_business_date may
          -- legitimately be today+1; that is a different column.)
          cap := (NOW() AT TIME ZONE 'Africa/Harare')::date;
          IF NEW.business_date::date > cap THEN
            RAISE EXCEPTION 'night_audit_runs.business_date % is in the future (cap %, drift blocked)', NEW.business_date, cap;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `).catch((e) => console.warn('[bootstrap] guard_audit_run_date fn:', e.message));
      await dbMod.query(`DROP TRIGGER IF EXISTS trg_guard_audit_run_date ON night_audit_runs`).catch(() => {});
      await dbMod.query(`
        CREATE TRIGGER trg_guard_audit_run_date
          BEFORE INSERT OR UPDATE ON night_audit_runs
          FOR EACH ROW EXECUTE FUNCTION guard_audit_run_date()
      `).catch((e) => console.warn('[bootstrap] guard_audit_run_date trigger:', e.message));

      // ── GL Pending Batches tables ─────────────────────────────────────────────
      await dbMod.query(`
        CREATE TABLE IF NOT EXISTS gl_account_mappings (
          id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          source_type     TEXT NOT NULL CHECK (source_type IN ('SUPPLIER','CUSTOMER_CREDIT','STOCK_CATEGORY')),
          source_ref_id   TEXT NOT NULL,
          target_gl_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
          updated_at      TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (source_type, source_ref_id)
        )
      `);
      await dbMod.query(`
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
      await dbMod.query(`CREATE INDEX IF NOT EXISTS idx_glpb_status ON gl_pending_batches(status)`);
      await dbMod.query(`CREATE INDEX IF NOT EXISTS idx_glpb_origin ON gl_pending_batches(origin_table, origin_id)`);

      const schedule = await runner.getSystemConfig('night_audit_schedule',
        { enabled: true, hour: 21, minute: 0, timezone: 'Africa/Harare' });
      if (schedule.enabled !== false) {
        runner.startScheduler(schedule.hour, schedule.minute, schedule.timezone);
        console.log(`⏰ Night audit scheduler active — runs at ${String(schedule.hour).padStart(2,'0')}:${String(schedule.minute).padStart(2,'0')} ${schedule.timezone}`);
      }
    })().catch(console.error);
});

server.on('error', (error) => {
    console.error('❌ Server error:', error);
});

server.on('connection', (socket) => {
    console.log('📡 New connection established');
});
