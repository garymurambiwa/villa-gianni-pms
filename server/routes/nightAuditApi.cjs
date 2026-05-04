'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const db      = require('../db-web.cjs');
const runner  = require('../services/nightAuditRunner.cjs');

const REPORT_DIR = path.join(__dirname, '..', 'Night Audit');

// ─── SSE connected clients ────────────────────────────────────────────────────
const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

// Register broadcast with runner
runner.setBroadcast(broadcastSSE);

// ─── GET /api/night-audit/events  (SSE stream) ───────────────────────────────
router.get('/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send current lock state immediately on connect
  runner.getSystemConfig('night_audit_lock', { locked: false })
    .then(lock => res.write(`event: night_audit_lock\ndata: ${JSON.stringify(lock)}\n\n`))
    .catch(() => {});

  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 20000);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(heartbeat);
  });
});

// ─── GET /api/night-audit/status ─────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const lock     = await runner.getSystemConfig('night_audit_lock', { locked: false });
    const schedule = await runner.getSystemConfig('night_audit_schedule',
      { enabled: true, hour: 21, minute: 0, timezone: 'Africa/Harare' });
    const bizDate  = await runner.getSystemConfig('business_date', null);
    const lastRun  = await db.query(
      `SELECT business_date, total_revenue, rooms_posted, status, completed_at
       FROM night_audit_runs ORDER BY inserted_at DESC LIMIT 1`
    );
    res.json({
      ok: true,
      locked:        lock.locked || false,
      step:          lock.step   || null,
      progress:      lock.progress || 0,
      businessDate:  bizDate?.date  || null,
      schedule,
      lastRun:       lastRun.ok ? lastRun.rows[0] : null
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── POST /api/night-audit/run  (manual trigger) ─────────────────────────────
router.post('/run', async (req, res) => {
  const { force } = req.body || {};
  if (await runner.isLocked() && !force) {
    return res.json({ ok: false, error: 'Audit already in progress. Pass force:true to override.' });
  }
  // Run async — return immediately with acknowledgement
  res.json({ ok: true, message: 'Night audit triggered', startedAt: new Date().toISOString() });
  runner.runNightAudit('manual_trigger').catch(console.error);
});

// ─── GET /api/night-audit/schedule ───────────────────────────────────────────
router.get('/schedule', async (req, res) => {
  const s = await runner.getSystemConfig('night_audit_schedule',
    { enabled: true, hour: 21, minute: 0, timezone: 'Africa/Harare' });
  res.json({ ok: true, schedule: s });
});

// ─── PUT /api/night-audit/schedule ───────────────────────────────────────────
router.put('/schedule', async (req, res) => {
  const { hour, minute, enabled, timezone } = req.body;
  const current = await runner.getSystemConfig('night_audit_schedule',
    { enabled: true, hour: 21, minute: 0, timezone: 'Africa/Harare' });
  const updated = {
    ...current,
    ...(hour     !== undefined ? { hour: Number(hour) }     : {}),
    ...(minute   !== undefined ? { minute: Number(minute) } : {}),
    ...(enabled  !== undefined ? { enabled }                : {}),
    ...(timezone !== undefined ? { timezone }               : {})
  };
  await runner.getSystemConfig; // import setSystemConfig through runner indirectly
  const dbMod = require('../db-web.cjs');
  await dbMod.query(
    `INSERT INTO system_configs (key, value, description, updated_at, updated_by)
     VALUES ('night_audit_schedule', $1::jsonb, 'Night audit schedule config', NOW(), 'admin')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(updated)]
  );
  res.json({ ok: true, schedule: updated });
});

// ─── GET /api/night-audit/reports ─────────────────────────────────────────────
// Returns BOTH file-system reports AND DB-based synthetic reports for all
// completed night audit runs. This ensures all historical audits are visible.
router.get('/reports', async (req, res) => {
  try {
    // 1. Read file-system reports (have full detail files)
    const fsReports = {};
    if (fs.existsSync(REPORT_DIR)) {
      fs.readdirSync(REPORT_DIR)
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.statSync(path.join(REPORT_DIR, d)).isDirectory())
        .forEach(date => {
          const files = fs.readdirSync(path.join(REPORT_DIR, date));
          fsReports[date] = files;
        });
    }

    // 2. Read all completed audit runs from DB
    const dbResult = await db.query(
      `SELECT business_date::date::text as date,
              room_revenue, total_revenue, occupancy_percent, adr, revpar,
              rooms_posted, reports_snapshot
       FROM night_audit_runs
       WHERE status = 'completed'
       ORDER BY business_date DESC
       LIMIT 90`
    );
    const dbRuns = (dbResult.ok && dbResult.rows) ? dbResult.rows : [];

    // 3. Build synthetic virtual files for DB runs that have no fs files
    const dbDates = {};
    for (const run of dbRuns) {
      const date = run.date;
      if (!date) continue;
      const snap = run.reports_snapshot || {};
      const syntheticFiles = ['front_office_report.txt', 'fnb_report.txt', 'reconciliation_report.txt', 'full_report.json'];
      dbDates[date] = { files: syntheticFiles, dbRun: run };
    }

    // 4. Merge: prefer fs reports for dates that have them, supplement with DB dates
    const allDates = new Set([...Object.keys(fsReports), ...Object.keys(dbDates)]);
    const result = Array.from(allDates)
      .sort()
      .reverse()
      .map(date => ({
        date,
        files: fsReports[date] || (dbDates[date] ? dbDates[date].files : []),
        fromDb: !fsReports[date] && !!dbDates[date],
        dbRun: dbDates[date]?.dbRun || null
      }));

    res.json({ ok: true, reports: result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── GET /api/night-audit/reports/:date/:file ─────────────────────────────────
// Serves either a real file from disk or generates synthetic content from DB.
router.get('/reports/:date/:file', async (req, res) => {
  const { date, file } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[\w_.-]+$/.test(file)) {
    return res.status(400).json({ ok: false, error: 'Invalid path' });
  }

  // 1. Try to serve from file system first (has full detail)
  const filePath = path.join(REPORT_DIR, date, file);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(file);
    const mime = ext === '.json' ? 'application/json' : 'text/plain';
    res.setHeader('Content-Type', mime);
    return res.sendFile(filePath);
  }

  // 2. Generate synthetic report from DB for this date
  try {
    const dbResult = await db.query(
      `SELECT business_date::date::text as date,
              room_revenue, total_revenue, occupancy_percent, adr, revpar,
              rooms_posted, occupied_rooms, available_rooms, tax_revenue,
              city_ledger_transfers, city_ledger_amount,
              reports_snapshot, completed_at
       FROM night_audit_runs
       WHERE business_date::date = $1::date
       LIMIT 1`,
      [date]
    );

    if (!dbResult.ok || !dbResult.rows || dbResult.rows.length === 0) {
      return res.status(404).send('No audit data found for ' + date);
    }

    const run = dbResult.rows[0];
    const snap = run.reports_snapshot || {};
    const fbRevenue = snap.fbRevenue !== undefined
      ? Number(snap.fbRevenue)
      : Number(run.total_revenue) - Number(run.room_revenue);
    const genTime = run.completed_at ? new Date(run.completed_at).toLocaleString() : date;
    const div = '════════════════════════════════════════════════════════════';
    const sub = '────────────────────────────────────────────────────────────';

    let content = '';

    if (file === 'front_office_report.txt') {
      content = `${div}
  VILLA GIANNI  –  FRONT OFFICE NIGHT AUDIT REPORT
  Business Date : ${date}
  Generated     : ${genTime}
${div}

ROOM OCCUPANCY
${sub}
  Occupied Rooms   : ${run.occupied_rooms || 0}
  Available Rooms  : ${run.available_rooms || 13}
  Occupancy %      : ${Number(run.occupancy_percent || 0).toFixed(1)}%

ROOM REVENUE
${sub}
  Room Revenue     : $${Number(run.room_revenue || 0).toFixed(2)}
  Tax Revenue      : $${Number(run.tax_revenue || 0).toFixed(2)}
  ADR              : $${Number(run.adr || 0).toFixed(2)}
  RevPAR           : $${Number(run.revpar || 0).toFixed(2)}

ROOMS POSTED
${sub}
  Rooms Posted     : ${run.rooms_posted || 0}
  (Full room-by-room detail available in nightly file reports only)

CITY LEDGER TRANSFERS
${sub}
  Transfers        : ${run.city_ledger_transfers || 0}
  Total Amount     : $${Number(run.city_ledger_amount || 0).toFixed(2)}

${div}
  END OF FRONT OFFICE REPORT
${div}`;

    } else if (file === 'fnb_report.txt') {
      content = `${div}
  VILLA GIANNI  –  FOOD & BEVERAGE NIGHT AUDIT REPORT
  Business Date : ${date}
  Generated     : ${genTime}
${div}

POS REVENUE SUMMARY
${sub}
  F&B Revenue      : $${fbRevenue.toFixed(2)}
  Total Revenue    : $${Number(run.total_revenue || 0).toFixed(2)}
  Room Revenue     : $${Number(run.room_revenue || 0).toFixed(2)}
  (Full outlet breakdown available in nightly file reports only)

SHIFT RECONCILIATION
${sub}
  Postings Count   : ${snap.postingsCount || run.rooms_posted || 0}
  City Ledger Cnt  : ${snap.cityLedgerCount || run.city_ledger_transfers || 0}

${div}
  END OF F&B REPORT
${div}`;

    } else if (file === 'reconciliation_report.txt') {
      const variance = Number(run.total_revenue || 0) - Number(run.room_revenue || 0) - fbRevenue;
      content = `${div}
  VILLA GIANNI  –  RECONCILIATION REPORT
  Business Date : ${date}
  Generated     : ${genTime}
${div}

REVENUE RECONCILIATION
${sub}
  Room Revenue     : $${Number(run.room_revenue || 0).toFixed(2)}
  F&B Revenue      : $${fbRevenue.toFixed(2)}
  Total Revenue    : $${Number(run.total_revenue || 0).toFixed(2)}
  Variance         : $${variance.toFixed(2)} ${Math.abs(variance) < 0.01 ? '✓ BALANCED' : '⚠ CHECK REQUIRED'}

KEY METRICS
${sub}
  Occupancy        : ${Number(run.occupancy_percent || 0).toFixed(2)}%
  ADR              : $${Number(run.adr || 0).toFixed(2)}
  RevPAR           : $${Number(run.revpar || 0).toFixed(2)}
  Rooms Posted     : ${run.rooms_posted || 0}

${div}
  END OF RECONCILIATION REPORT
${div}`;

    } else if (file === 'full_report.json') {
      const jsonData = {
        date: run.date,
        generatedAt: genTime,
        source: 'database',
        roomRevenue: Number(run.room_revenue || 0),
        fbRevenue,
        taxRevenue: Number(run.tax_revenue || 0),
        totalRevenue: Number(run.total_revenue || 0),
        occupancy: Number(run.occupancy_percent || 0),
        adr: Number(run.adr || 0),
        revpar: Number(run.revpar || 0),
        roomsPosted: run.rooms_posted || 0,
        occupiedRooms: run.occupied_rooms || 0,
        availableRooms: run.available_rooms || 0,
        cityLedgerTransfers: run.city_ledger_transfers || 0,
        cityLedgerAmount: Number(run.city_ledger_amount || 0),
        snapshot: snap
      };
      res.setHeader('Content-Type', 'application/json');
      return res.json(jsonData);

    } else {
      return res.status(404).send('Unknown report file: ' + file);
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(content);
  } catch (e) {
    res.status(500).send('Error generating report: ' + e.message);
  }
});

// ─── GET /api/night-audit/history ────────────────────────────────────────────
router.get('/history', async (req, res) => {
  const { limit = 30 } = req.query;
  const r = await db.query(
    `SELECT business_date, rooms_posted, room_revenue, total_revenue,
            occupied_rooms, occupancy_percent, adr, revpar, status, completed_at
     FROM night_audit_runs ORDER BY business_date DESC LIMIT $1`,
    [Number(limit)]
  );
  res.json({ ok: true, runs: r.ok ? r.rows : [] });
});

module.exports = { router, broadcastSSE };
