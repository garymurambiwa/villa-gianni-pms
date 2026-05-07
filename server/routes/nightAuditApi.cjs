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

// ─── POST /api/night-audit/backfill ─────────────────────────────────────────
// Reconstructs and inserts a missing historical night audit run for a given date.
// Uses actual reservation + folio_charges data from that date to compute revenue.
// Idempotent: if a record already exists for the date, it won't overwrite it.
router.post('/backfill', async (req, res) => {
  const { date, force } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: 'date required in YYYY-MM-DD format' });
  }

  try {
    // 1. Check if audit already exists for this date
    const existing = await db.query(
      `SELECT id, status FROM night_audit_runs WHERE business_date::date = $1::date`,
      [date]
    );
    if (existing.ok && existing.rows.length > 0 && !force) {
      return res.json({
        ok: false,
        error: `Audit already exists for ${date} (status: ${existing.rows[0].status}). Pass force:true to overwrite.`,
        existing: existing.rows[0]
      });
    }

    // 2. Get all reservations that were checked-in on this date
    const reservRes = await db.query(
      `SELECT ro.id as room_id, ro.number, ro.type,
              COALESCE(NULLIF(r.rate::numeric, 0), ro.rate, 0) as rate,
              r.id as reservation_id, r.guest_id,
              COALESCE(g.full_name, r.booking_name, 'Unknown') as guest_name,
              f.id as folio_id
       FROM reservations r
       JOIN rooms ro ON ro.id = r.room_id
       LEFT JOIN guests g ON g.id = r.guest_id
       LEFT JOIN folios f ON f.reservation_id = r.id AND f.status = 'open'
       WHERE r.check_in_date <= $1::date
         AND r.check_out_date > $1::date
         AND r.status IN ('checked-in', 'checked-out')`,
      [date]
    );

    const reservations = reservRes.ok ? reservRes.rows : [];

    // 3. Calculate room metrics
    const totalRooms = 13; // Standard available rooms
    const occupiedRooms = reservations.length;
    let roomRevenue = 0;
    let taxRevenue = 0;
    const charges = [];

    for (const room of reservations) {
      const rate = Number(room.rate || 0);
      const taxRate = 0.15; // 15% VAT inclusive
      const tax = Number((rate * (taxRate / (1 + taxRate))).toFixed(2));
      const base = Number((rate - tax).toFixed(2));
      roomRevenue += rate;
      taxRevenue += tax;

      // Check if room charges were already posted for this date
      const chargeRef = `NA_${date}_RM${room.number}`;
      const existsCharge = await db.query(
        `SELECT id FROM folio_charges WHERE source_reference = $1 LIMIT 1`,
        [chargeRef]
      );

      if (!existsCharge.ok || existsCharge.rows.length === 0) {
        // Post room charge to folio if not already there
        let folioId = room.folio_id;

        if (!folioId) {
          const newFolio = await db.query(
            `INSERT INTO folios (id, guest_id, reservation_id, room_number, status, balance, guest_name, arrival_date, inserted_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, 'open', 0, $4, $5::date, NOW(), NOW())
             RETURNING id`,
            [room.guest_id, room.reservation_id, room.number, room.guest_name, date]
          );
          folioId = newFolio.ok ? newFolio.rows[0]?.id : null;
        }

        if (folioId) {
          // Room base charge
          await db.query(
            `INSERT INTO folio_charges
               (id, folio_id, guest_id, reservation_id, room_number, charge_type, category,
                description, amount, tax_amount, total_amount, source, source_reference,
                posting_date, business_date, department, service_date, inserted_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, 'charge', 'Room',
                     $5, $6, 0, $6, 'night_audit', $7,
                     $8::date, $8::date, 'Rooms', $8::date, NOW(), NOW())`,
            [folioId, room.guest_id, room.reservation_id, room.number,
             `Room ${room.number} - ${room.type}`, base, chargeRef, date]
          );

          // Tax charge
          if (tax > 0) {
            await db.query(
              `INSERT INTO folio_charges
                 (id, folio_id, guest_id, reservation_id, room_number, charge_type, category,
                  description, amount, tax_amount, total_amount, source, source_reference,
                  posting_date, business_date, department, service_date, inserted_at, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, 'charge', 'Tax',
                       $5, $6, 0, $6, 'night_audit', $7,
                       $8::date, $8::date, 'Rooms', $8::date, NOW(), NOW())`,
              [folioId, room.guest_id, room.reservation_id, room.number,
               `Accommodation Tax - Room ${room.number}`, tax, chargeRef + '_TAX', date]
            );
          }

          // Update folio balance
          await db.query(
            `UPDATE folios SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
            [rate, folioId]
          );
        }
      }

      charges.push({ room: room.number, guest: room.guest_name, rate, base, tax });
    }

    // 4. Get any POS revenue for the date
    const posRes = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM pos_orders
       WHERE status = 'closed' AND created_at::date = $1::date`,
      [date]
    );
    const posRevenue = Number(posRes.ok ? posRes.rows[0]?.total || 0 : 0);

    // 5. Compute KPIs
    const totalRevenue = roomRevenue + posRevenue;
    const occupancyPct = totalRooms > 0 ? Number(((occupiedRooms / totalRooms) * 100).toFixed(2)) : 0;
    const adr = occupiedRooms > 0 ? Number((roomRevenue / occupiedRooms).toFixed(2)) : 0;
    const revpar = totalRooms > 0 ? Number((roomRevenue / totalRooms).toFixed(2)) : 0;

    // 6. Next business date
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    const nextDate = d.toISOString().slice(0, 10);

    const snapshot = {
      fbRevenue: posRevenue,
      occupiedRooms,
      availableRooms: totalRooms,
      roomsPosted: occupiedRooms,
      charges,
      backfilled: true,
      backfilledAt: new Date().toISOString()
    };

    // 7. Insert or update night_audit_runs
    let auditId;
    if (existing.ok && existing.rows.length > 0 && force) {
      // Update existing record
      const upRes = await db.query(
        `UPDATE night_audit_runs SET
           rooms_posted = $2, room_revenue = $3, tax_revenue = $4, total_revenue = $5,
           occupied_rooms = $6, available_rooms = $7, occupancy_percent = $8,
           adr = $9, revpar = $10, status = 'completed',
           run_by = 'BACKFILL_SYSTEM', completed_at = NOW(),
           reports_snapshot = $11::jsonb,
           next_business_date = $12::date
         WHERE business_date::date = $1::date RETURNING id`,
        [date, occupiedRooms, roomRevenue, taxRevenue, totalRevenue,
         occupiedRooms, totalRooms, occupancyPct, adr, revpar,
         JSON.stringify(snapshot), nextDate]
      );
      auditId = upRes.ok ? upRes.rows[0]?.id : null;
    } else {
      // Insert new record
      const insRes = await db.query(
        `INSERT INTO night_audit_runs
           (id, business_date, next_business_date, rooms_posted, room_revenue, tax_revenue,
            total_revenue, city_ledger_transfers, city_ledger_amount,
            occupied_rooms, available_rooms, occupancy_percent, adr, revpar,
            status, run_by, started_at, completed_at, reports_snapshot, inserted_at)
         VALUES
           (gen_random_uuid(), $1::date, $2::date, $3, $4, $5,
            $6, 0, 0,
            $7, $8, $9, $10, $11,
            'completed', 'BACKFILL_SYSTEM', $1::date, NOW(), $12::jsonb, NOW())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [date, nextDate, occupiedRooms, roomRevenue, taxRevenue, totalRevenue,
         occupiedRooms, totalRooms, occupancyPct, adr, revpar, JSON.stringify(snapshot)]
      );
      auditId = insRes.ok ? insRes.rows[0]?.id : null;
    }

    // 8. Generate and write report files to disk
    const fs = require('fs');
    const path = require('path');
    const REPORT_DIR = path.join(__dirname, '..', 'Night Audit');
    const dir = path.join(REPORT_DIR, date);
    fs.mkdirSync(dir, { recursive: true });

    const hr = '─'.repeat(60);
    const dv = '═'.repeat(60);
    const ts = new Date().toLocaleString('en-ZW', { timeZone: 'Africa/Harare' });

    // Front Office Report
    let fo = `${dv}\n  VILLA GIANNI  –  FRONT OFFICE NIGHT AUDIT REPORT\n`;
    fo += `  Business Date : ${date}  [BACKFILLED]\n  Generated     : ${ts}\n${dv}\n\n`;
    fo += `ROOM OCCUPANCY\n${hr}\n  Occupied Rooms : ${occupiedRooms}\n  Available Rooms: ${totalRooms}\n  Occupancy %    : ${occupancyPct.toFixed(1)}%\n\n`;
    fo += `ROOM REVENUE\n${hr}\n  Room Revenue   : $${roomRevenue.toFixed(2)}\n  Tax Revenue    : $${taxRevenue.toFixed(2)}\n  ADR            : $${adr.toFixed(2)}\n  RevPAR         : $${revpar.toFixed(2)}\n\n`;
    fo += `ROOM CHARGES POSTED\n${hr}\n`;
    charges.forEach(c => { fo += `  Room ${String(c.room).padEnd(4)} | ${String(c.guest).padEnd(30)} | $${c.rate.toFixed(2)}\n`; });
    fo += `\n${dv}\n  END OF FRONT OFFICE REPORT (BACKFILLED)\n${dv}\n`;
    fs.writeFileSync(path.join(dir, 'front_office_report.txt'), fo);

    // F&B Report
    let fnb = `${dv}\n  VILLA GIANNI  –  FOOD & BEVERAGE NIGHT AUDIT REPORT\n`;
    fnb += `  Business Date : ${date}  [BACKFILLED]\n  Generated     : ${ts}\n${dv}\n\n`;
    fnb += `POS REVENUE\n${hr}\n  POS / F&B Revenue : $${posRevenue.toFixed(2)}\n\n`;
    fnb += `${dv}\n  END OF F&B REPORT (BACKFILLED)\n${dv}\n`;
    fs.writeFileSync(path.join(dir, 'fnb_report.txt'), fnb);

    // Reconciliation Report
    let rec = `${dv}\n  VILLA GIANNI  –  NIGHT AUDIT RECONCILIATION\n`;
    rec += `  Business Date : ${date}  [BACKFILLED]\n  Generated     : ${ts}\n${dv}\n\n`;
    rec += `REVENUE SUMMARY\n${hr}\n  Room Revenue : $${roomRevenue.toFixed(2)}\n  Tax Revenue  : $${taxRevenue.toFixed(2)}\n  F&B Revenue  : $${posRevenue.toFixed(2)}\n  ${hr}\n  TOTAL        : $${totalRevenue.toFixed(2)}\n\n`;
    rec += `NOTE: This audit was backfilled on ${new Date().toISOString()}.\nOriginal audit was not run on ${date}. Data reconstructed from reservation records.\n`;
    rec += `\n${dv}\n  END OF RECONCILIATION REPORT (BACKFILLED)\n${dv}\n`;
    fs.writeFileSync(path.join(dir, 'reconciliation_report.txt'), rec);

    // Full JSON
    fs.writeFileSync(path.join(dir, 'full_report.json'), JSON.stringify({
      businessDate: date, generatedAt: new Date().toISOString(), backfilled: true,
      roomRevenue, taxRevenue, posRevenue, totalRevenue, occupiedRooms, availableRooms: totalRooms,
      occupancyPct, adr, revpar, charges
    }, null, 2));

    res.json({
      ok: true,
      message: `Audit backfilled for ${date}`,
      auditId,
      summary: { date, occupiedRooms, roomRevenue, taxRevenue, posRevenue, totalRevenue, occupancyPct, adr, revpar },
      charges,
      reportsWritten: dir
    });

  } catch (e) {
    console.error('[Backfill] Error:', e);
    res.json({ ok: false, error: e.message });
  }
});

module.exports = { router, broadcastSSE };
