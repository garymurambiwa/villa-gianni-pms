'use strict';

/**
 * Night Audit Runner - Autonomous Backend Orchestrator
 * Runs every night at 21:00 Africa/Harare
 * Steps:
 *  1. Acquire system lock  (broadcasts to all connected clients via SSE)
 *  2. Auto-close all open POS shifts
 *  3. Void stale open POS orders (> 18 hours old)
 *  4. Post room charges + tax for all OC/OD rooms
 *  5. Transfer debtors to city ledger
 *  6. Reconcile totals
 *  7. GL journal posting
 *  8. Record night_audit_runs row
 *  9. Roll over business date
 * 10. Write report files to Night Audit/<date>/
 * 11. Release lock
 */

const db     = require('../db-web.cjs');
const fs     = require('fs');
const path   = require('path');

// ─── SSE event emitter (set by index.cjs after startup) ─────────────────────
let _broadcast = null;
const setBroadcast = (fn) => { _broadcast = fn; };
const broadcast   = (event, data) => { if (_broadcast) _broadcast(event, data); };

// ─── Report output directory ─────────────────────────────────────────────────
const REPORT_DIR = path.join(__dirname, '..', 'Night Audit');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const nowISO  = () => new Date().toISOString();
const pad     = (n) => String(n).padStart(2, '0');
const todayDB = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};

// Add N calendar days to a YYYY-MM-DD string via pure UTC-anchored arithmetic
// (no wall-clock/timezone mixing — input and output are both pure dates).
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
};

// Today's calendar date in the HOTEL timezone (Africa/Harare, CAT/UTC+2).
// Derived in SQL so it is independent of the server OS/clock timezone — the new
// VPS runs in US-East (UTC-4); trusting the OS clock here was a source of drift.
// CAT has no DST, so this is stable year-round. Falls back to the OS date only
// if the DB query fails.
async function catToday() {
  try {
    const r = await db.query(
      `SELECT to_char((NOW() AT TIME ZONE 'Africa/Harare')::date, 'YYYY-MM-DD') AS d`
    );
    if (r.ok && r.rows.length && r.rows[0].d) return r.rows[0].d;
  } catch { /* fall through to OS date */ }
  return todayDB();
}

async function getSystemConfig(key, fallback = null) {
  const r = await db.query(`SELECT value FROM system_configs WHERE key = $1`, [key]);
  if (r.ok && r.rows.length) return r.rows[0].value;
  return fallback;
}

async function setSystemConfig(key, value, description = '') {
  await db.query(
    `INSERT INTO system_configs (key, value, description, updated_at, updated_by)
     VALUES ($1, $2::jsonb, $3, NOW(), 'night_audit_system')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value), description]
  );
}

// ─── Lock management ─────────────────────────────────────────────────────────
async function acquireLock(businessDate) {
  const lockData = {
    locked:     true,
    started_at: nowISO(),
    business_date: businessDate,
    step:       'starting',
    progress:   0
  };
  await setSystemConfig('night_audit_lock', lockData, 'Night audit system lock');
  broadcast('night_audit_lock', lockData);
  log('🔒 System lock acquired for business date: ' + businessDate);
  return lockData;
}

async function updateStep(step, progress, extra = {}) {
  const existing = await getSystemConfig('night_audit_lock', {});
  const updated  = { ...existing, step, progress, ...extra };
  await setSystemConfig('night_audit_lock', updated);
  broadcast('night_audit_step', { step, progress, ...extra });
  log(`  ↳ [${pad(progress)}%] ${step}`);
}

async function releaseLock(result) {
  const lockData = {
    locked:       false,
    completed_at: nowISO(),
    last_result:  result,
    step:         'complete',
    progress:     100
  };
  await setSystemConfig('night_audit_lock', lockData);
  broadcast('night_audit_unlock', lockData);
  log('🔓 System lock released');
}

async function isLocked() {
  const lock = await getSystemConfig('night_audit_lock', { locked: false });
  return lock && lock.locked === true;
}

// ─── Logging ─────────────────────────────────────────────────────────────────
const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

// ─── Step 1: Auto-close open POS shifts ──────────────────────────────────────
async function autoCloseShifts(businessDate) {
  log('  Closing open POS shifts...');
  const open = await db.query(
    `SELECT id, outlet, shift_number, opened_at,
            COALESCE(total_sales, 0) as total_sales,
            COALESCE(total_cash, 0) as total_cash,
            COALESCE(total_card, 0) as total_card
     FROM pos_shifts WHERE status = 'open'`
  );
  if (!open.ok || !open.rows.length) {
    log('  No open shifts found');
    return { count: 0, shifts: [] };
  }

  const closedShifts = [];
  for (const shift of open.rows) {
    const r = await db.query(
      `UPDATE pos_shifts
       SET status = 'closed',
           closed_at = NOW(),
           closed_by = 'NIGHT_AUDIT_SYSTEM',
           closing_cash = COALESCE(expected_cash, opening_cash, 0),
           is_reconciled = true,
           reconciled_at = NOW(),
           reconciled_by = 'NIGHT_AUDIT_SYSTEM',
           reconciliation_notes = 'Auto-closed by night audit at 21:00',
           z_reading_number = COALESCE(z_reading_number, shift_number::text),
           updated_at = NOW()
       WHERE id = $1 RETURNING id, outlet, shift_number`,
      [shift.id]
    );
    if (r.ok && r.rows.length) {
      closedShifts.push(r.rows[0]);
      log(`    Closed shift #${shift.shift_number} (${shift.outlet})`);
    }
  }
  return { count: closedShifts.length, shifts: closedShifts };
}

// ─── Step 2: Void stale open POS orders (> 18 hours old) ─────────────────────
async function voidStaleOrders() {
  const r = await db.query(
    `UPDATE pos_orders SET status = 'voided'
     WHERE status = 'open'
       AND created_at < NOW() - INTERVAL '18 hours'
     RETURNING id, table_number, total_amount`
  );
  if (r.ok && r.rows.length) {
    log(`  Voided ${r.rows.length} stale open order(s)`);
    for (const o of r.rows) {
      await db.query(
        `UPDATE table_status SET status = 'open', last_update = NOW()
         WHERE table_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM pos_orders
             WHERE table_number = $1 AND status = 'open'
           )`, [o.table_number]
      );
    }
  }
  return { count: r.ok ? r.rows.length : 0 };
}

// Get the system VAT rate from system_configs.tax_config (defaults to 0.15 if not set).
async function getSystemTaxRate() {
  try {
    const r = await db.query(`SELECT value FROM system_configs WHERE key='tax_config' LIMIT 1`);
    if (r.ok && r.rows?.length) {
      const cfg = typeof r.rows[0].value === 'string' ? JSON.parse(r.rows[0].value) : r.rows[0].value;
      const rate = Number(cfg?.room_tax_rate ?? cfg?.default_rate ?? cfg?.pos_tax_rate ?? 0);
      // Accept both 15 (percent) and 0.15 (fraction)
      if (rate > 1) return rate / 100;
      if (rate > 0) return rate;
    }
  } catch { /* fall through */ }
  return 0.15; // USALI default
}

// ─── Step 3: Post room charges for all OC/OD rooms ───────────────────────────
async function postRoomCharges(businessDate) {
  log('  Posting room charges...');

  const taxRate = await getSystemTaxRate();
  log(`  Tax rate in effect: ${(taxRate * 100).toFixed(2)}%`);

  // Get all occupied rooms with their current reservation/rate
  const rooms = await db.query(
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

  if (!rooms.ok || !rooms.rows.length) {
    log('  No occupied rooms to post');
    return { count: 0, totalRevenue: 0, charges: [] };
  }

  const posted    = [];
  let totalRevenue = 0;

  for (const room of rooms.rows) {
    const rate    = Number(room.reservation_rate || 0); // already COALESCE'd with room default in query
    const tax     = Number((rate * (taxRate / (1 + taxRate))).toFixed(2));
    const base    = Number((rate - tax).toFixed(2));

    let folioId = room.folio_id;

    // Auto-create folio if missing
    if (!folioId) {
      const newFolio = await db.query(
        `INSERT INTO folios (id, guest_id, reservation_id, room_number, status, balance,
                             guest_name, arrival_date, inserted_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'open', 0, $4, NOW(), NOW())
         RETURNING id`,
        [room.guest_id, room.reservation_id, room.number, room.full_name]
      );
      folioId = newFolio.ok ? newFolio.rows[0]?.id : null;
    }

    if (!folioId) { log(`    ⚠ Could not create folio for room ${room.number}`); continue; }

    const chargeRef = `NA_${businessDate}_RM${room.number}`;

    // Idempotency: skip if already posted today
    const exists = await db.query(
      `SELECT id FROM folio_charges
       WHERE source_reference = $1 AND folio_id = $2 LIMIT 1`,
      [chargeRef, folioId]
    );
    if (exists.ok && exists.rows.length) {
      log(`    Skipping room ${room.number} — already posted today`);
      continue;
    }

    // Room base charge
    await db.query(
      `INSERT INTO folio_charges
         (id, folio_id, guest_id, reservation_id, room_number, charge_type, category,
          description, amount, tax_amount, total_amount, source, source_reference,
          posting_date, business_date, department, service_date, inserted_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'charge', 'Room',
               $5, $6, 0, $6, 'night_audit', $7,
               NOW(), $8, 'Rooms', $8, NOW())`,
      [folioId, room.guest_id, room.reservation_id, room.number,
       `Room ${room.number} - ${room.type}`, base, chargeRef, businessDate]
    );

    // Tax charge
    if (tax > 0) {
      await db.query(
        `INSERT INTO folio_charges
           (id, folio_id, guest_id, reservation_id, room_number, charge_type, category,
            description, amount, tax_amount, total_amount, source, source_reference,
            posting_date, business_date, department, service_date, inserted_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'charge', 'Tax',
                 $5, $6, 0, $6, 'night_audit', $7,
                 NOW(), $8, 'Rooms', $8, NOW())`,
        [folioId, room.guest_id, room.reservation_id, room.number,
         `Accommodation Tax - Room ${room.number}`, tax, chargeRef + '_TAX', businessDate]
      );
    }

    // Update folio balance
    await db.query(
      `UPDATE folios SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
      [rate, folioId]
    );

    totalRevenue += rate;
    posted.push({ room: room.number, guest: room.full_name, rate, base, tax, folioId });
    log(`    Posted Room ${room.number}: ${room.full_name} @ $${rate} ($${base} + $${tax} tax)`);
  }

  return { count: posted.length, totalRevenue, charges: posted };
}

// ─── Step 4: Get POS revenue for the business date ───────────────────────────
async function getPOSRevenue(businessDate) {
  const r = await db.query(
    `SELECT
       COALESCE(SUM(total_amount), 0) as total,
       COUNT(*) as orders,
       cost_center
     FROM pos_orders
     WHERE status = 'closed'
       AND created_at::date = $1::date
     GROUP BY cost_center`,
    [businessDate]
  );
  const rows = r.ok ? r.rows : [];
  const byOutlet = {};
  let total = 0;
  for (const row of rows) {
    const outlet = row.cost_center || 'Unknown';
    byOutlet[outlet] = Number(row.total);
    total += Number(row.total);
  }
  return { total, byOutlet, orders: rows.reduce((s, r) => s + Number(r.orders), 0) };
}

// ─── Step 5: City ledger transfers for checked-out guests with balance ────────
async function transferCityLedger(businessDate) {
  const outstanding = await db.query(
    `SELECT f.id as folio_id, f.guest_id, f.guest_name, f.balance, f.room_number,
            r.id as reservation_id, g.company_name
     FROM folios f
     JOIN reservations r ON r.id = f.reservation_id
     LEFT JOIN guests g ON g.id = f.guest_id
     WHERE r.status = 'checked-out'
       AND f.status = 'open'
       AND f.balance > 0`
  );

  let transferred = 0;
  if (!outstanding.ok || !outstanding.rows.length) return { count: 0, amount: 0 };

  for (const folio of outstanding.rows) {
    // Create city ledger account if not exists
    const clId = `CL_${folio.guest_id || folio.folio_id}`;
    await db.query(
      `INSERT INTO city_ledger_accounts (id, guest_id, account_name, balance, status, created_at, updated_at)
       VALUES ($1, $2, $3, 0, 'active', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [clId, folio.guest_id, folio.guest_name || 'Unknown Guest']
    );

    await db.query(
      `INSERT INTO city_ledger_transactions
         (id, account_id, transaction_type, amount, description, transaction_date, reference_id, created_at)
       VALUES (gen_random_uuid(), $1, 'transfer_in', $2, $3, $4, $5, NOW())`,
      [clId, folio.balance, `Folio transfer - ${folio.room_number} - ${businessDate}`,
       businessDate, folio.folio_id]
    );

    await db.query(
      `UPDATE city_ledger_accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
      [folio.balance, clId]
    );

    await db.query(
      `UPDATE folios SET status = 'transferred', closed_at = NOW(), closed_by = 'NIGHT_AUDIT_SYSTEM'
       WHERE id = $1`, [folio.folio_id]
    );

    transferred++;
    log(`    Transferred $${folio.balance} for ${folio.guest_name} to city ledger`);
  }

  return { count: transferred, amount: outstanding.rows.reduce((s, f) => s + Number(f.balance), 0) };
}

// ─── Step 6: Calculate reconciliation totals ─────────────────────────────────
async function reconcile(businessDate, roomRevenue, posRevenue) {
  const folioCharges = await db.query(
    `SELECT SUM(total_amount) as total FROM folio_charges
     WHERE business_date = $1 AND charge_type = 'charge' AND source = 'night_audit'`,
    [businessDate]
  );
  const folioTotal = Number(folioCharges.ok ? folioCharges.rows[0]?.total || 0 : 0);

  const shiftTotals = await db.query(
    `SELECT COALESCE(SUM(total_sales), 0) as total
     FROM pos_shifts WHERE business_date = $1 AND status = 'closed'`,
    [businessDate]
  );
  const shiftTotal = Number(shiftTotals.ok ? shiftTotals.rows[0]?.total || 0 : 0);

  return {
    folioTotal,
    shiftTotal,
    posRevenue: posRevenue.total,
    roomRevenue,
    totalRevenue: folioTotal + posRevenue.total,
    variance: Math.abs(shiftTotal - posRevenue.total),
    ok: Math.abs(shiftTotal - posRevenue.total) < 0.01
  };
}

// ─── Step 7: Record night_audit_runs row ─────────────────────────────────────
async function recordAuditRun(data) {
  const r = await db.query(
    `INSERT INTO night_audit_runs
       (id, business_date, next_business_date, rooms_posted, room_revenue, tax_revenue,
        total_revenue, city_ledger_transfers, city_ledger_amount,
        occupied_rooms, available_rooms, occupancy_percent, adr, revpar,
        status, run_by, started_at, completed_at, reports_snapshot, inserted_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12, $13,
        'completed', 'NIGHT_AUDIT_SYSTEM', $14, NOW(), $15::jsonb, NOW())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      data.businessDate, data.nextDate,
      data.roomsPosted, data.roomRevenue, data.taxRevenue,
      data.totalRevenue, data.cityLedgerCount, data.cityLedgerAmount,
      data.occupiedRooms, data.availableRooms, data.occupancyPct, data.adr, data.revpar,
      data.startedAt, JSON.stringify(data.snapshot)
    ]
  );
  return r.ok ? r.rows[0]?.id : null;
}

// ─── Step 8: Roll over business date ─────────────────────────────────────────
async function rolloverDate(currentDate) {
  let next = addDays(currentDate, 1);

  // CLAMP — the business date must never run more than ONE day ahead of the
  // hotel's real calendar date. A pre-midnight audit (scheduled 21:00 CAT)
  // legitimately rolls into tomorrow, so the cap is (hotel-today + 1); anything
  // beyond that is overshoot. This is what stops the date drifting permanently
  // ahead when multiple paths roll the same night, or when the stored date was
  // already ahead. It still allows correct day-by-day catch-up of missed nights.
  const cap = addDays(await catToday(), 1);
  if (next > cap) {
    log(`  ⚠ Rollover clamp: ${currentDate} → ${next} exceeds cap ${cap}; clamping to ${cap}`);
    next = cap;
  }

  await setSystemConfig('business_date', { date: next, rolled_at: nowISO() },
                        'Current hotel business date');
  log(`  Business date rolled: ${currentDate} → ${next}`);
  return next;
}

// ─── Step 9: Write report files ───────────────────────────────────────────────
function writeReports(date, data) {
  const dir = path.join(REPORT_DIR, date);
  fs.mkdirSync(dir, { recursive: true });

  const hr  = '─'.repeat(60);
  const ts  = new Date().toLocaleString('en-ZW', { timeZone: 'Africa/Harare' });

  // ── Front Office Report ────────────────────────────────────────────────────
  let fo = `${'═'.repeat(60)}\n`;
  fo += `  VILLA GIANNI  –  FRONT OFFICE NIGHT AUDIT REPORT\n`;
  fo += `  Business Date : ${date}\n`;
  fo += `  Generated     : ${ts}\n`;
  fo += `${'═'.repeat(60)}\n\n`;
  fo += `ROOM OCCUPANCY\n${hr}\n`;
  fo += `  Occupied Rooms   : ${data.occupiedRooms}\n`;
  fo += `  Available Rooms  : ${data.availableRooms}\n`;
  fo += `  Occupancy %      : ${data.occupancyPct.toFixed(1)}%\n\n`;
  fo += `ROOM REVENUE\n${hr}\n`;
  fo += `  Room Revenue     : $${data.roomRevenue.toFixed(2)}\n`;
  fo += `  Tax Revenue      : $${data.taxRevenue.toFixed(2)}\n`;
  fo += `  ADR              : $${data.adr.toFixed(2)}\n`;
  fo += `  RevPAR           : $${data.revpar.toFixed(2)}\n\n`;
  fo += `ROOM CHARGES POSTED\n${hr}\n`;
  for (const c of data.charges) {
    fo += `  Room ${String(c.room).padEnd(4)} | ${String(c.guest).padEnd(30)} | $${c.rate.toFixed(2)}\n`;
  }
  fo += `\nCITY LEDGER TRANSFERS\n${hr}\n`;
  fo += `  Transfers        : ${data.cityLedgerCount}\n`;
  fo += `  Total Amount     : $${data.cityLedgerAmount.toFixed(2)}\n\n`;
  fo += `SHIFT SUMMARY\n${hr}\n`;
  for (const s of data.closedShifts) {
    fo += `  Shift #${s.shift_number || '?'} (${s.outlet || 'Unknown'}) – CLOSED\n`;
  }
  fo += `\n${'═'.repeat(60)}\n  END OF FRONT OFFICE REPORT\n${'═'.repeat(60)}\n`;
  fs.writeFileSync(path.join(dir, 'front_office_report.txt'), fo);

  // ── F&B / POS Report ──────────────────────────────────────────────────────
  let fnb = `${'═'.repeat(60)}\n`;
  fnb += `  VILLA GIANNI  –  FOOD & BEVERAGE NIGHT AUDIT REPORT\n`;
  fnb += `  Business Date : ${date}\n`;
  fnb += `  Generated     : ${ts}\n`;
  fnb += `${'═'.repeat(60)}\n\n`;
  fnb += `POS REVENUE BY OUTLET\n${hr}\n`;
  for (const [outlet, rev] of Object.entries(data.posByOutlet || {})) {
    fnb += `  ${String(outlet).padEnd(30)} : $${Number(rev).toFixed(2)}\n`;
  }
  fnb += `  ${'─'.repeat(46)}\n`;
  fnb += `  ${'TOTAL'.padEnd(30)} : $${data.posTotal.toFixed(2)}\n`;
  fnb += `\nSHIFT RECONCILIATION\n${hr}\n`;
  fnb += `  Shift Sales Total  : $${data.recon.shiftTotal.toFixed(2)}\n`;
  fnb += `  POS Orders Total   : $${data.recon.posRevenue.toFixed(2)}\n`;
  fnb += `  Variance           : $${data.recon.variance.toFixed(2)} ${data.recon.ok ? '✓ BALANCED' : '⚠ REVIEW'}\n`;
  fnb += `\n${'═'.repeat(60)}\n  END OF F&B REPORT\n${'═'.repeat(60)}\n`;
  fs.writeFileSync(path.join(dir, 'fnb_report.txt'), fnb);

  // ── Reconciliation Report ─────────────────────────────────────────────────
  let rec = `${'═'.repeat(60)}\n`;
  rec += `  VILLA GIANNI  –  NIGHT AUDIT RECONCILIATION\n`;
  rec += `  Business Date : ${date}\n`;
  rec += `  Generated     : ${ts}\n`;
  rec += `${'═'.repeat(60)}\n\n`;
  rec += `REVENUE SUMMARY\n${hr}\n`;
  rec += `  Room Revenue        : $${data.roomRevenue.toFixed(2)}\n`;
  rec += `  Tax Revenue         : $${data.taxRevenue.toFixed(2)}\n`;
  rec += `  F&B / POS Revenue   : $${data.posTotal.toFixed(2)}\n`;
  rec += `  ${'─'.repeat(46)}\n`;
  rec += `  TOTAL REVENUE       : $${data.totalRevenue.toFixed(2)}\n\n`;
  rec += `FOLIO RECONCILIATION\n${hr}\n`;
  rec += `  Folio Charges Total : $${data.recon.folioTotal.toFixed(2)}\n`;
  rec += `  Rooms Posted        : ${data.roomsPosted}\n\n`;
  rec += `AUDIT TRAIL\n${hr}\n`;
  rec += `  Started At          : ${data.startedAt}\n`;
  rec += `  Completed At        : ${new Date().toISOString()}\n`;
  rec += `  Run By              : NIGHT_AUDIT_SYSTEM (Automated)\n`;
  rec += `  Next Business Date  : ${data.nextDate}\n\n`;
  rec += `PROCESS LOG\n${hr}\n`;
  for (const line of data.logLines) { rec += `  ${line}\n`; }
  rec += `\n${'═'.repeat(60)}\n  END OF RECONCILIATION REPORT\n${'═'.repeat(60)}\n`;
  fs.writeFileSync(path.join(dir, 'reconciliation_report.txt'), rec);

  // ── Full JSON snapshot ─────────────────────────────────────────────────────
  fs.writeFileSync(path.join(dir, 'full_report.json'), JSON.stringify({
    businessDate: date,
    generatedAt: nowISO(),
    ...data
  }, null, 2));

  log(`  Reports written to Night Audit/${date}/`);
  return dir;
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────
async function runNightAudit(triggeredBy = 'scheduler') {
  logLines.length = 0;
  const startedAt = nowISO();

  log('');
  log('════════════════════════════════════════════════════');
  log('  NIGHT AUDIT STARTED  –  Triggered by: ' + triggeredBy);
  log('════════════════════════════════════════════════════');

  // Guard: don't double-run
  if (await isLocked()) {
    log('⚠ Audit already in progress — skipping');
    return { ok: false, error: 'Audit already in progress' };
  }

  // Determine business date from DB (fallback to today)
  const dbDate = await getSystemConfig('business_date', null);
  const businessDate = (dbDate && dbDate.date) ? dbDate.date : todayDB();
  log('  Business date: ' + businessDate);

  await acquireLock(businessDate);

  try {
    // ── Step 1: Close shifts ────────────────────────────────────────────────
    await updateStep('Closing open POS shifts', 10);
    const shiftResult = await autoCloseShifts(businessDate);

    // ── Step 2: Void stale orders ───────────────────────────────────────────
    await updateStep('Voiding stale POS orders', 20);
    const staleOrders = await voidStaleOrders();

    // ── Step 3: Post room charges ───────────────────────────────────────────
    await updateStep('Posting room charges', 35);
    const roomResult = await postRoomCharges(businessDate);

    // ── Step 4: POS revenue ─────────────────────────────────────────────────
    await updateStep('Aggregating POS revenue', 50);
    const posRevenue = await getPOSRevenue(businessDate);

    // ── Step 5: City ledger ─────────────────────────────────────────────────
    await updateStep('Processing city ledger transfers', 60);
    const clResult = await transferCityLedger(businessDate);

    // ── Step 6: Reconcile ───────────────────────────────────────────────────
    await updateStep('Reconciling totals', 70);
    const recon = await reconcile(businessDate, roomResult.totalRevenue, posRevenue);

    // ── Build metrics ───────────────────────────────────────────────────────
    const roomsResult = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('OC','OD')) as occupied,
         COUNT(*) FILTER (WHERE status NOT IN ('OOO','OOS')) as available
       FROM rooms`
    );
    const occupiedRooms   = Number(roomsResult.rows[0]?.occupied  || 0);
    const availableRooms  = Number(roomsResult.rows[0]?.available || 0);
    const occupancyPct    = availableRooms ? (occupiedRooms / availableRooms) * 100 : 0;
    const adr             = occupiedRooms ? roomResult.totalRevenue / occupiedRooms : 0;
    const revpar          = availableRooms ? roomResult.totalRevenue / availableRooms : 0;
    const taxRevenue      = roomResult.charges.reduce((s, c) => s + (c.tax || 0), 0);
    const totalRevenue    = roomResult.totalRevenue + posRevenue.total;

    // ── Step 7: COMPUTE the next business date (clamped) — but DO NOT write it
    // to system_configs yet. The actual roll happens AFTER the audit row is
    // recorded (below), so the stored business_date only ever advances once an
    // audit has genuinely completed for the day being closed. This is what stops
    // a stray client (or restart) from pushing business_date a day ahead without
    // a real audit behind it. nextDate is still computed here because it is a
    // NOT NULL column on night_audit_runs.
    await updateStep('Rolling over business date', 80);
    const rollCap  = addDays(await catToday(), 1);
    let   nextDate = addDays(businessDate, 1);
    if (nextDate > rollCap) {
      log(`  ⚠ Rollover clamp: ${businessDate} → ${nextDate} exceeds cap ${rollCap}; clamping to ${rollCap}`);
      nextDate = rollCap;
    }

    // ── Step 8: Record audit run ─────────────────────────────────────────────
    await updateStep('Recording audit run to database', 88);
    const snapshot = {
      roomRevenue:   roomResult.totalRevenue,
      posRevenue:    posRevenue.total,
      totalRevenue,
      occupancy:     occupancyPct,
      avgDailyRate:  adr,
      revPAR:        revpar,
      roomsPosted:   roomResult.count,
      shiftsClosed:  shiftResult.count,
      date:          businessDate,
    };
    const runId = await recordAuditRun({
      businessDate, nextDate,   // nextDate now valid — no more NOT NULL violation
      roomsPosted: roomResult.count, roomRevenue: roomResult.totalRevenue, taxRevenue,
      totalRevenue, cityLedgerCount: clResult.count, cityLedgerAmount: clResult.amount,
      occupiedRooms, availableRooms, occupancyPct,
      adr, revpar, startedAt, snapshot
    });

    if (!runId) {
      log('  ⚠ night_audit_runs INSERT returned no id — record may already exist for ' + businessDate);
    }

    // Patch step kept for safety but nextDate already set
    if (runId) {
      await db.query(
        `UPDATE night_audit_runs SET next_business_date = $1 WHERE id = $2`,
        [nextDate, runId]
      );
    }

    // ── Step 8b: NOW roll the stored business date (after the audit is on record).
    // The DB trigger additionally caps this at min(today+1, last completed audit+1),
    // so the date can never lead the calendar without a completed audit behind it.
    await setSystemConfig('business_date', { date: nextDate, rolled_at: nowISO() },
                          'Current hotel business date');
    log(`  Business date rolled: ${businessDate} → ${nextDate}`);

    // ── Step 9: Write reports ───────────────────────────────────────────────
    await updateStep('Writing report files', 94);
    const reportDir = writeReports(businessDate, {
      businessDate, nextDate, startedAt,
      roomRevenue:     roomResult.totalRevenue,
      taxRevenue,
      totalRevenue,
      roomsPosted:     roomResult.count,
      charges:         roomResult.charges,
      occupiedRooms,
      availableRooms,
      occupancyPct,
      adr,
      revpar,
      posTotal:        posRevenue.total,
      posByOutlet:     posRevenue.byOutlet,
      cityLedgerCount: clResult.count,
      cityLedgerAmount: clResult.amount,
      closedShifts:    shiftResult.shifts,
      recon,
      logLines:        [...logLines]
    });

    const summary = {
      ok: true,
      businessDate,
      nextDate,
      roomsPosted:    roomResult.count,
      roomRevenue:    roomResult.totalRevenue,
      posRevenue:     posRevenue.total,
      totalRevenue,
      shiftsClosed:   shiftResult.count,
      staleVoided:    staleOrders.count,
      cityLedger:     clResult,
      reconciliation: recon,
      reportDir,
      duration:       Date.now() - new Date(startedAt).getTime()
    };

    log('');
    log('════════════════════════════════════════════════════');
    log('  NIGHT AUDIT COMPLETE');
    log(`  Date rolled: ${businessDate} → ${nextDate}`);
    log(`  Rooms posted: ${roomResult.count}  |  Revenue: $${totalRevenue.toFixed(2)}`);
    log(`  Shifts closed: ${shiftResult.count}  |  Duration: ${summary.duration}ms`);
    log('════════════════════════════════════════════════════');
    log('');

    await releaseLock(summary);
    broadcast('night_audit_complete', summary);
    return summary;

  } catch (err) {
    log('❌ NIGHT AUDIT ERROR: ' + err.message);
    await releaseLock({ ok: false, error: err.message });
    broadcast('night_audit_error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

// ─── Scheduler (called from index.cjs) ───────────────────────────────────────
let _schedulerInterval = null;

function startScheduler(auditHour = 0, auditMinute = 0, timezone = 'Africa/Harare') {
  if (_schedulerInterval) clearInterval(_schedulerInterval);

  log(`⏰ Night audit scheduled for ${pad(auditHour)}:${pad(auditMinute)} (${timezone}) — checking every 60s`);

  _schedulerInterval = setInterval(async () => {
    try {
      const now = new Date();
      // Convert to hotel local time (Africa/Harare = UTC+2)
      const zw = new Date(now.toLocaleString('en-US', { timeZone: timezone }));

      // ── CATCH-UP: if business_date is behind today, run immediately ─────────
      // This handles the case where the server was down or the audit was skipped.
      const dbDate = await getSystemConfig('business_date', null);
      const businessDate = dbDate?.date || todayDB();
      // Hotel-local (CAT) calendar date, derived in SQL so it is correct
      // regardless of the VPS OS timezone (US-East). The previous
      // zw.toLocaleDateString(...) double-applied the timezone and could be a
      // day off near midnight, mis-firing catch-up and pushing the date ahead.
      const localToday = await catToday(); // YYYY-MM-DD in Africa/Harare
      if (businessDate < localToday) {
        const lock = await getSystemConfig('night_audit_lock', {});
        if (!lock || !lock.locked) {
          log(`⚡ Catch-up: business_date=${businessDate} is behind local date=${localToday} — running audit now`);
          runNightAudit('catch_up').catch(console.error);
          return;
        }
      }

      // ── SCHEDULED RUN: fire at the configured hour:minute ────────────────────
      if (zw.getHours() === auditHour && zw.getMinutes() === auditMinute) {
        const lock = await getSystemConfig('night_audit_lock', {});
        if (lock && lock.locked) return; // already running
        const lastRun = lock?.completed_at ? new Date(lock.completed_at) : null;
        if (lastRun && (now - lastRun) < 55000) return; // ran in last 55s
        runNightAudit('scheduler').catch(console.error);
      }
    } catch (err) {
      log('⚠ Scheduler tick error (non-fatal): ' + err.message);
    }
  }, 60 * 1000);

  return _schedulerInterval;
}

function stopScheduler() {
  if (_schedulerInterval) { clearInterval(_schedulerInterval); _schedulerInterval = null; }
}

module.exports = { runNightAudit, startScheduler, stopScheduler, setBroadcast, isLocked, getSystemConfig, setSystemConfig, catToday, addDays };
