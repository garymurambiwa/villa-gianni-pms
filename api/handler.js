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
  'ROOM_REVENUE','FB_REVENUE','CONF_REVENUE','TAX','CASH','CARD','ROOM_CHARGE','CITY_LEDGER'
];

// USALI-aligned safe default account numbers (seed if no user mapping exists)
const GL_USALI_DEFAULTS = {
  ROOM_REVENUE:  { accountId: '4000', name: 'Rooms Revenue',          category: 'Revenue',   usali: 'Rooms' },
  FB_REVENUE:    { accountId: '4100', name: 'F&B Revenue',            category: 'Revenue',   usali: 'F&B' },
  CONF_REVENUE:  { accountId: '4200', name: 'Conference Revenue',     category: 'Revenue',   usali: 'Catering' },
  TAX:           { accountId: '2300', name: 'VAT/Sales Tax Payable',  category: 'Liability', usali: 'Tax' },
  CASH:          { accountId: '1000', name: 'Cash on Hand',           category: 'Asset',     usali: 'Cash' },
  CARD:          { accountId: '1100', name: 'Card/Bank Clearing',     category: 'Asset',     usali: 'Bank' },
  ROOM_CHARGE:   { accountId: '1200', name: 'In-house Guest Ledger',  category: 'Asset',     usali: 'GuestLedger' },
  CITY_LEDGER:   { accountId: '1300', name: 'City Ledger/AR',         category: 'Asset',     usali: 'AR' },
  FB_COST:       { accountId: '5100', name: 'F&B Cost of Sales',      category: 'Expense',   usali: 'F&B Cost' },
  BANK:          { accountId: '1150', name: 'Bank Account',           category: 'Asset',     usali: 'Bank' },
  AP_CONTROL:    { accountId: '2100', name: 'Accounts Payable',       category: 'Liability', usali: 'AP' },
};

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

    // Advance business date
    const nextDate = new Date(date); nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = nextDate.toISOString().split('T')[0];
    await db.query(
      `INSERT INTO system_configs (key,value) VALUES ('business_date',$1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [JSON.stringify({ date: nextDateStr })]
    );

    // Record audit run
    const runId = `run_${date.replace(/-/g,'')}_${Date.now().toString(36)}`;
    await db.query(
      `INSERT INTO night_audit_runs
         (id,business_date,status,rooms_posted,occupied_rooms,available_rooms,
          room_revenue,total_revenue,occupancy_percent,adr,revpar,completed_at,inserted_at)
       VALUES ($1,$2::date,'completed',$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
       ON CONFLICT (id) DO NOTHING`,
      [runId, date, roomsPosted, totalOccupied, totalAvailable,
       roomRevenue, totalRevenue, occupancyPct, adr, revpar]
    );

    safeJson(res, { ok: true, date, roomsPosted, roomRevenue, totalRevenue, occupancyPct: occupancyPct.toFixed(1), nextBusinessDate: nextDateStr });
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
      needsInitialization: !businessDate && !lastRunRow
    });
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
  const allowed = ['period_name','status','closing_stock_value','variance_value','cogs_value','kitchen_cogs','cellar_cogs','closed_by','closed_reason'];
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

// ─── Catch-all: return JSON 404 (NOT HTML) ───────────────────────────────────
// This prevents the "Unexpected token T" error — always return JSON
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Route not found: ${req.method} ${req.path}` });
});

// ─── Vercel serverless export ─────────────────────────────────────────────────
module.exports = app;
