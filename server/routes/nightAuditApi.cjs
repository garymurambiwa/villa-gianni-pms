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

// ─── GET /api/night-audit/reports ────────────────────────────────────────────
router.get('/reports', (req, res) => {
  try {
    if (!fs.existsSync(REPORT_DIR)) return res.json({ ok: true, dates: [] });
    const dates = fs.readdirSync(REPORT_DIR)
      .filter(d => fs.statSync(path.join(REPORT_DIR, d)).isDirectory())
      .sort()
      .reverse();
    const result = dates.map(date => {
      const dir   = path.join(REPORT_DIR, date);
      const files = fs.readdirSync(dir);
      return { date, files };
    });
    res.json({ ok: true, reports: result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── GET /api/night-audit/reports/:date/:file ─────────────────────────────────
router.get('/reports/:date/:file', (req, res) => {
  const { date, file } = req.params;
  // Security: only allow alphanumeric date and known filenames
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/^[\w_.-]+$/.test(file)) {
    return res.status(400).json({ ok: false, error: 'Invalid path' });
  }
  const filePath = path.join(REPORT_DIR, date, file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });
  const ext = path.extname(file);
  const mime = ext === '.json' ? 'application/json' : 'text/plain';
  res.setHeader('Content-Type', mime);
  res.sendFile(filePath);
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
