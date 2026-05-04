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

// ─── Night Audit (simplified for Vercel — no SSE/file system) ────────────────
app.get('/api/night-audit/status', async (req, res) => {
  try {
    const lastRun = await db.query(
      `SELECT business_date, total_revenue, rooms_posted, status, completed_at
       FROM night_audit_runs ORDER BY inserted_at DESC LIMIT 1`
    );
    const bizDate = await db.query(`SELECT value FROM system_configs WHERE key='business_date'`);
    safeJson(res, {
      ok: true, locked: false, step: null, progress: 0,
      businessDate: bizDate.rows?.[0]?.value?.date || null,
      lastRun: lastRun.ok ? lastRun.rows?.[0] : null
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

// ─── Catch-all: return JSON 404 (NOT HTML) ───────────────────────────────────
// This prevents the "Unexpected token T" error — always return JSON
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Route not found: ${req.method} ${req.path}` });
});

// ─── Vercel serverless export ─────────────────────────────────────────────────
module.exports = app;
