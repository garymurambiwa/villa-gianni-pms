/**
 * COREPMS v11 Inventory Module - Express API Routes
 * Location: server/routes/inventory-v11.cjs
 *
 * Self-bootstrapping: automatically creates all inventory tables on first load
 * if they do not exist. This means the module works on any clean database
 * (fresh Baradzanwa deployment, new property, etc.) without manual migration.
 *
 * Also syncs with POS cost_centres table:
 * - Every cost_centre is reflected as an inv_locations Outlet
 * - Creating/deleting a location also updates cost_centres (and vice versa)
 */

const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const { randomUUID } = require('crypto');
const fs = require('fs');

// Import utility functions for robust ID generation and error handling with fallbacks
let generateSecureShortId, generateAlphanumericShortId, validateShortId;
let handleShortIdConstraintViolation, databaseErrorHandler, safeInventoryOperation;

try {
  const shortIdUtils = require('../utils/shortIdGenerator');
  generateSecureShortId = shortIdUtils.generateSecureShortId;
  generateAlphanumericShortId = shortIdUtils.generateAlphanumericShortId;
  validateShortId = shortIdUtils.validateShortId;
} catch (e) {
  console.warn('[inventory-v11] Failed to load shortIdGenerator utilities, using fallbacks:', e.message);
  // Fallback implementations
  const { randomUUID } = require('crypto');
  generateSecureShortId = (length = 10) => {
    // Generate cryptographically secure random ID
    const randomBytes = require('crypto').randomBytes(Math.ceil(length * 0.75));
    return randomBytes.toString('base64url').slice(0, length);
  };
  generateAlphanumericShortId = (length = 10) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * chars.length);
      id += chars[randomIndex];
    }
    return id;
  };
  validateShortId = (shortId) => {
    if (shortId === null) return { valid: true, message: 'Short ID is null (allowed)' };
    if (typeof shortId !== 'string') return { valid: false, message: 'Short ID must be a string or null' };
    const length = shortId.length;
    if (length > 10) return { valid: false, message: `Short ID exceeds maximum length of 10 characters`, providedLength: length, maxAllowed: 10 };
    return { valid: true, message: `Short ID is valid (length: ${length})`, length: length };
  };
}

try {
  const dbErrorUtils = require('../utils/dbErrorHandler');
  handleShortIdConstraintViolation = dbErrorUtils.handleShortIdConstraintViolation;
  databaseErrorHandler = dbErrorUtils.databaseErrorHandler;
  safeInventoryOperation = dbErrorUtils.safeInventoryOperation;
} catch (e) {
  console.warn('[inventory-v11] Failed to load dbErrorHandler utilities, using fallbacks:', e.message);
  // Fallback implementations
  handleShortIdConstraintViolation = (error, itemData) => {
    // Simple fallback - return null to let other error handling take over
    return null;
  };
  databaseErrorHandler = (error, req, res, next) => {
    // Simple fallback - send generic error
    console.error('Database error:', error);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  };
  safeInventoryOperation = async (operationFn, itemData) => {
    try {
      const result = await operationFn();
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };
}

// Load environment
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 10000,
  max: 10,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

// ============================================================================
// SEED FUNCTIONS — extracted so they can be called from BOTH branches of bootstrap
// (first boot AND existing-tables path). All use ON CONFLICT DO NOTHING — idempotent.
// ============================================================================

const UOM_SEED = [
  ['uom_unit',   'UNIT',   'Unit',        'Count'],
  ['uom_case',   'CASE',   'Case',        'Count'],
  ['uom_bottle', 'BOTTLE', 'Bottle',      'Count'],
  ['uom_can',    'CAN',    'Can',         'Count'],
  ['uom_crate',  'CRATE',  'Crate',       'Count'],
  ['uom_dozen',  'DOZ',    'Dozen',       'Count'],
  ['uom_box',    'BOX',    'Box',         'Count'],
  ['uom_bag',    'BAG',    'Bag',         'Count'],
  ['uom_pkt',    'PKT',    'Packet',      'Count'],
  ['uom_drum',   'DRUM',   'Drum',        'Count'],
  ['uom_portion','POR',    'Portion',     'Count'],
  ['uom_liter',  'LITER',  'Litre',       'Volume'],
  ['uom_ml',     'ML',     'Millilitre',  'Volume'],
  ['uom_tot',    'TOT',    'Tot',         'Volume'],
  ['uom_g',      'G',      'Gram',        'Weight'],
  ['uom_kg',     'KG',     'Kilogram',    'Weight'],
];

const STORAGE_SEED = [
  ['loc_main_cellar', 'Main Cellar',            'Storage'],
  ['loc_dry_goods',   'Dry Goods Store',         'Storage'],
  ['loc_freezer',     'Freezer / Perishables',   'Storage'],
  ['loc_perishables', 'Perishables',             'Storage'],
];

async function seedUomDefinitions(client) {
  let seeded = 0;
  for (const [id, code, name, cat] of UOM_SEED) {
    const r = await client.query(
      `INSERT INTO public.inv_uom_definitions (id, code, name, category)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [id, code, name, cat]
    );
    seeded += r.rowCount || 0;
  }
  if (seeded > 0) console.log(`[inv-v11] Seeded ${seeded} UOM definitions`);
  return seeded;
}

async function seedDefaultLocations(client) {
  for (const [id, name, type] of STORAGE_SEED) {
    await client.query(
      `INSERT INTO public.inv_locations (id, name, location_type)
       VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [id, name, type]
    );
  }
}

// ============================================================================
// ITEM ID GENERATION: Generate short item IDs (first 4 letters + # + 3 digits)
// ============================================================================

async function generateShortItemId(name) {
  if (!name) return 'UNKN#001';

  // Extract first 4 letters (uppercase alphanumeric)
  const letters = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 4);
  const prefix = letters.padEnd(4, 'X'); // Pad with X if less than 4 chars

  // Find the highest existing number for this prefix
  const res = await pool.query(
    `SELECT id FROM public.inv_items WHERE id LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`${prefix}#___`]
  );

  let nextNum = 1;
  if (res.rows.length > 0) {
    const lastId = res.rows[0].id;
    const numPart = lastId.split('#')[1];
    if (numPart && !isNaN(numPart)) {
      nextNum = parseInt(numPart, 10) + 1;
    }
  }

  return `${prefix}#${String(nextNum).padStart(3, '0')}`;
}

// ============================================================================
// AUTO-BOOTSTRAP: Create inventory tables on first load if missing
// ============================================================================

async function ensureInventoryTables() {
  const client = await pool.connect();
  try {
    // Check if inv_locations already exists — if so, tables are set up
    const check = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name='inv_locations' LIMIT 1`
    );
    if (check.rows.length > 0) {
      // Some tables exist — but others (stock ledger, transfer, variance) may be
      // missing on deployments that were created before v11. Run CREATE IF NOT EXISTS
      // for every table so a partial schema is always completed idempotently.
      await client.query(`ALTER TABLE public.inv_locations ADD COLUMN IF NOT EXISTS description TEXT`);
      await client.query(`ALTER TABLE public.inv_locations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
      await client.query(`ALTER TABLE public.inv_uom_definitions ADD COLUMN IF NOT EXISTS description TEXT`);
      await client.query(`ALTER TABLE public.inv_items ADD COLUMN IF NOT EXISTS selling_price NUMERIC(10,2) DEFAULT 0.00`);
      await client.query(`ALTER TABLE public.inv_items ADD COLUMN IF NOT EXISTS short_id TEXT UNIQUE`);
      // Enforce 10-char max on short_id via CHECK constraint (idempotent — ignore if already exists)
      await client.query(`ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS inv_items_short_len`).catch(() => {});
      await client.query(`ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS inv_items_short_id_len`).catch(() => {});
      await client.query(
        `DO $$ BEGIN
           ALTER TABLE public.inv_items ADD CONSTRAINT inv_items_short_id_len CHECK (short_id IS NULL OR char_length(short_id) <= 10);
         EXCEPTION WHEN duplicate_object THEN NULL; END $$`
      );
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS posted_by TEXT`);
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS supplier_id TEXT`);
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS supplier_invoice_number TEXT`);
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS receipt_date DATE`);

      // Ensure inventory_transactions has columns needed by GRN post route
      await client.query(`ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'grv'`).catch(() => {});
      await client.query(`ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS is_historical_backfill BOOLEAN DEFAULT false`).catch(() => {});
      await client.query(`ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS department TEXT`).catch(() => {});

      // Period close columns
      await client.query(`ALTER TABLE public.inventory_periods ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked'))`).catch(() => {});
      await client.query(`ALTER TABLE public.inventory_periods ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ`).catch(() => {});
      await client.query(`ALTER TABLE public.inventory_periods ADD COLUMN IF NOT EXISTS locked_by TEXT`).catch(() => {});

      // Append-only audit trail for period/sheet reopen actions
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inventory_period_audit (
          id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          period_id     TEXT,
          action        TEXT NOT NULL,
          user_id       TEXT,
          user_name     TEXT,
          change_reason TEXT,
          created_at    TIMESTAMPTZ DEFAULT now()
        )
      `).catch(() => {});

      // ── ISSUE 1 FIX: inv_grn_lines column alignment ───────────────────────
      // Older deployments created inv_grn_lines with `uom_id` (wrong name).
      // The backend INSERT and frontend payload both use `received_uom_id`.
      // Add the correct column if missing; copy existing uom_id data across.
      await client.query(`ALTER TABLE public.inv_grn_lines ADD COLUMN IF NOT EXISTS received_uom_id TEXT REFERENCES public.inv_uom_definitions(id)`);
      await client.query(`ALTER TABLE public.inv_grn_lines ADD COLUMN IF NOT EXISTS expiry_date DATE`);
      await client.query(`ALTER TABLE public.inv_grn_lines ADD COLUMN IF NOT EXISTS notes TEXT`);
      // ISSUE 1 FIX cont.: old schema has total_cost, new schema has line_total — align both
      // Add line_total for old schemas (total_cost → line_total rename via new column + back-fill)
      await client.query(`ALTER TABLE public.inv_grn_lines ADD COLUMN IF NOT EXISTS line_total NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await client.query(`UPDATE public.inv_grn_lines SET line_total = total_cost WHERE line_total = 0 AND total_cost IS NOT NULL AND total_cost > 0`).catch(() => {});
      // Back-fill received_uom_id from uom_id where column existed but was named wrong
      await client.query(`UPDATE public.inv_grn_lines SET received_uom_id = uom_id WHERE received_uom_id IS NULL AND uom_id IS NOT NULL`).catch(() => {});

      // Ensure advanced tables that may be missing on older deployments
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_grn_lines (
          id TEXT PRIMARY KEY,
          grn_header_id TEXT NOT NULL REFERENCES public.inv_grn_headers(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL REFERENCES public.inv_items(id),
          qty_received NUMERIC(12,4) NOT NULL CHECK (qty_received > 0),
          received_uom_id TEXT REFERENCES public.inv_uom_definitions(id),
          uom_id TEXT REFERENCES public.inv_uom_definitions(id),
          unit_cost NUMERIC(10,4) DEFAULT 0,
          total_cost NUMERIC(12,2) DEFAULT 0,
          line_number INTEGER NOT NULL,
          notes TEXT,
          inserted_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_transfer_headers (
          id TEXT PRIMARY KEY,
          transfer_number TEXT UNIQUE NOT NULL,
          from_location_id TEXT REFERENCES public.inv_locations(id),
          to_location_id TEXT REFERENCES public.inv_locations(id),
          source_location_id TEXT REFERENCES public.inv_locations(id),
          destination_location_id TEXT REFERENCES public.inv_locations(id),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
          requested_by TEXT,
          created_by TEXT,
          approved_by TEXT,
          notes TEXT,
          reference_text TEXT,
          inserted_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      // Align column names: old schema uses from/to, new uses source/destination — add both.
      // Some DBs were created without the from/to pair; the transfer INSERT still
      // writes them for backward compatibility, so they must exist.
      await client.query(`ALTER TABLE public.inv_transfer_headers ADD COLUMN IF NOT EXISTS from_location_id TEXT REFERENCES public.inv_locations(id)`).catch(()=>{});
      await client.query(`ALTER TABLE public.inv_transfer_headers ADD COLUMN IF NOT EXISTS to_location_id TEXT REFERENCES public.inv_locations(id)`).catch(()=>{});
      await client.query(`ALTER TABLE public.inv_transfer_headers ADD COLUMN IF NOT EXISTS source_location_id TEXT REFERENCES public.inv_locations(id)`);
      await client.query(`ALTER TABLE public.inv_transfer_headers ADD COLUMN IF NOT EXISTS destination_location_id TEXT REFERENCES public.inv_locations(id)`);
      await client.query(`ALTER TABLE public.inv_transfer_headers ADD COLUMN IF NOT EXISTS created_by TEXT`);
      await client.query(`ALTER TABLE public.inv_transfer_headers ADD COLUMN IF NOT EXISTS reference_text TEXT`);
      // Reversal support: extend status CHECK and add linkage columns
      await client.query(`ALTER TABLE public.inv_transfer_headers DROP CONSTRAINT IF EXISTS inv_transfer_headers_status_check`).catch(()=>{});
      await client.query(`ALTER TABLE public.inv_transfer_headers ADD CONSTRAINT inv_transfer_headers_status_check CHECK (status IN ('pending','approved','rejected','cancelled','reversed'))`).catch(()=>{});
      await client.query(`ALTER TABLE public.inv_transfer_headers ADD COLUMN IF NOT EXISTS reversed_by TEXT`).catch(()=>{});
      await client.query(`ALTER TABLE public.inv_transfer_headers ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ`).catch(()=>{});
      // Back-fill new columns from old column names (idempotent)
      await client.query(`UPDATE public.inv_transfer_headers SET source_location_id=from_location_id WHERE source_location_id IS NULL AND from_location_id IS NOT NULL`).catch(()=>{});
      await client.query(`UPDATE public.inv_transfer_headers SET destination_location_id=to_location_id WHERE destination_location_id IS NULL AND to_location_id IS NOT NULL`).catch(()=>{});
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_transfer_lines (
          id TEXT PRIMARY KEY,
          transfer_header_id TEXT NOT NULL REFERENCES public.inv_transfer_headers(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL REFERENCES public.inv_items(id),
          qty_requested NUMERIC(12,4) NOT NULL CHECK (qty_requested > 0),
          source_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
          breakdown_flag BOOLEAN DEFAULT false,
          destination_uom_id TEXT REFERENCES public.inv_uom_definitions(id),
          current_source_balance NUMERIC(12,4),
          line_number INTEGER NOT NULL,
          inserted_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(transfer_header_id, line_number)
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_stock_ledger (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES public.inv_items(id),
          location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
          ledger_type TEXT NOT NULL CHECK (ledger_type IN ('GRN','TRANSFER_IN','TRANSFER_OUT','SALE_DEPLETION','ADJUSTMENT','WASTE')),
          reference_number TEXT,
          quantity_change NUMERIC(12,4) NOT NULL,
          base_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
          cost_per_unit NUMERIC(10,4),
          total_cost NUMERIC(12,2),
          posted_by TEXT,
          gl_account_code TEXT,
          transaction_date TIMESTAMPTZ DEFAULT NOW(),
          inserted_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      // Transfer-line idempotency guard. A FULL unique constraint over these columns
      // cannot be created on databases with historical duplicate GRN/WASTE rows (the
      // old ADD CONSTRAINT silently failed via .catch, and the transfer INSERTs'
      // "ON CONFLICT ON CONSTRAINT uq_ledger_transfer_line" then crashed every Post).
      // A PARTIAL unique index over transfer rows only is sufficient and always creatable.
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_transfer_line_idx
           ON public.inv_stock_ledger (reference_number, ledger_type, location_id, item_id)
           WHERE ledger_type IN ('TRANSFER_IN','TRANSFER_OUT')`
      ).catch((e)=>{ console.error('[inventory] uq_ledger_transfer_line_idx create failed:', e.message); });
      await client.query(`ALTER TABLE public.inv_stock_ledger ADD COLUMN IF NOT EXISTS inserted_at TIMESTAMPTZ DEFAULT NOW()`);
      // Enforce 10-char max on short_id
      await client.query(`ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS inv_items_short_len`).catch(() => {});
      await client.query(`ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS inv_items_short_id_len`).catch(() => {});
      await client.query(
        `DO $$ BEGIN
           ALTER TABLE public.inv_items ADD CONSTRAINT inv_items_short_id_len CHECK (short_id IS NULL OR char_length(short_id) <= 10);
         EXCEPTION WHEN duplicate_object THEN NULL; END $$`
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_recipes (
          id TEXT PRIMARY KEY,
          menu_item_id TEXT NOT NULL,
          version_number INTEGER DEFAULT 1,
          is_current BOOLEAN DEFAULT true,
          created_by TEXT,
          total_cost NUMERIC(10,4) DEFAULT 0.00,
          notes TEXT,
          inserted_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(menu_item_id, version_number)
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_recipe_lines (
          id TEXT PRIMARY KEY,
          recipe_id TEXT NOT NULL REFERENCES public.inv_recipes(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL REFERENCES public.inv_items(id),
          qty_required NUMERIC(10,4) NOT NULL CHECK (qty_required > 0),
          prep_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
          wastage_pct NUMERIC(5,2) DEFAULT 0.00,
          line_number INTEGER NOT NULL,
          inserted_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(recipe_id, line_number)
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_physical_counts (
          id TEXT PRIMARY KEY,
          location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
          count_date DATE NOT NULL DEFAULT CURRENT_DATE,
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
          counted_by TEXT,
          inserted_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_physical_count_lines (
          id TEXT PRIMARY KEY,
          count_id TEXT NOT NULL REFERENCES public.inv_physical_counts(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL REFERENCES public.inv_items(id),
          physical_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
          uom_id TEXT REFERENCES public.inv_uom_definitions(id),
          notes TEXT,
          inserted_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_variance_reports (
          id TEXT PRIMARY KEY,
          report_number TEXT UNIQUE NOT NULL,
          location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
          period_start DATE NOT NULL,
          period_end DATE NOT NULL,
          generated_by TEXT,
          total_items INTEGER DEFAULT 0,
          ok_count INTEGER DEFAULT 0,
          warning_count INTEGER DEFAULT 0,
          critical_count INTEGER DEFAULT 0,
          inserted_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_variance_lines (
          id TEXT PRIMARY KEY,
          variance_report_id TEXT NOT NULL REFERENCES public.inv_variance_reports(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL REFERENCES public.inv_items(id),
          theoretical_qty NUMERIC(12,4) NOT NULL,
          physical_qty NUMERIC(12,4) NOT NULL,
          variance_qty NUMERIC(12,4) NOT NULL,
          variance_percentage NUMERIC(12,4) NOT NULL,
          alert_level TEXT NOT NULL CHECK (alert_level IN ('OK','WARNING','CRITICAL')),
          item_cost NUMERIC(10,4),
          variance_value NUMERIC(12,2),
          inserted_at TIMESTAMPTZ DEFAULT NOW()
        )`);

      // Existing DBs created variance_percentage as NUMERIC(7,4) (max ±999.9999):
      // any variance over 1,000% — trivially reached when theoretical stock is
      // near zero — blew up Reconcile with "numeric field overflow". Widen it.
      await client.query(`ALTER TABLE public.inv_variance_lines ALTER COLUMN variance_percentage TYPE NUMERIC(12,4)`)
        .catch((e)=>{ console.error('[inventory] variance_percentage widen failed:', e.message); });

      // Indexes — safe with IF NOT EXISTS
      await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_ledger_item_loc ON public.inv_stock_ledger(item_id, location_id)`).catch(()=>{});
      await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_ledger_type ON public.inv_stock_ledger(ledger_type)`).catch(()=>{});

      // Stock Take tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_stock_take_sheets (
          id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          location_id   TEXT NOT NULL REFERENCES public.inv_locations(id),
          period_start  DATE NOT NULL,
          period_end    DATE NOT NULL,
          status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked')),
          created_by    TEXT,
          created_at    TIMESTAMPTZ DEFAULT now(),
          locked_at     TIMESTAMPTZ,
          locked_by     TEXT,
          UNIQUE (location_id, period_start, period_end)
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.inv_stock_take_lines (
          id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          sheet_id              TEXT NOT NULL REFERENCES public.inv_stock_take_sheets(id) ON DELETE CASCADE,
          item_id               TEXT NOT NULL REFERENCES public.inv_items(id),
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
        )`);

      // ALWAYS re-seed UOMs and default storage locations
      await seedUomDefinitions(client);
      await seedDefaultLocations(client);
      await syncCostCentresToLocations(client);
      return;
    }

    console.log('[inv-v11] First boot detected — creating inventory tables...');

    // ── UOM Definitions ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_uom_definitions (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Count',
        description TEXT,
        inserted_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    // ── Locations ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location_type TEXT NOT NULL CHECK (location_type IN ('Storage','Outlet')),
        parent_location_id TEXT REFERENCES public.inv_locations(id),
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    // ── Item Master ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Food',
        sub_category TEXT,
        base_uom_id TEXT NOT NULL DEFAULT 'uom_unit' REFERENCES public.inv_uom_definitions(id),
        sku TEXT UNIQUE,
        barcode TEXT,
        selling_price NUMERIC(10,2) DEFAULT 0.00,
        last_cost_price NUMERIC(10,4) DEFAULT 0.00,
        average_cost NUMERIC(10,4) DEFAULT 0.00,
        weighted_avg_cost NUMERIC(10,4) DEFAULT 0.00,
        default_wastage_pct NUMERIC(5,2) DEFAULT 0.00,
        par_level NUMERIC(12,4) DEFAULT 0.00,
        reorder_level NUMERIC(12,4) DEFAULT 0.00,
        reorder_qty NUMERIC(12,4) DEFAULT 0.00,
        expiry_tracking BOOLEAN DEFAULT false,
        default_location_id TEXT,
        supplier_id TEXT,
        media_url TEXT,
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    // ── UOM Conversions ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_uom_conversions (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        from_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
        to_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
        conversion_factor NUMERIC(10,4) NOT NULL CHECK (conversion_factor > 0),
        breakdown_allowed BOOLEAN DEFAULT false,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(item_id, from_uom_id, to_uom_id)
      )`);

    // ── GRN ───────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_grn_headers (
        id TEXT PRIMARY KEY,
        grn_number TEXT UNIQUE NOT NULL,
        supplier_name TEXT NOT NULL,
        supplier_id TEXT,
        supplier_invoice_number TEXT,
        destination_location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
        created_by TEXT NOT NULL,
        total_value NUMERIC(12,2) DEFAULT 0.00,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
        posted_at TIMESTAMPTZ,
        posted_by TEXT,
        notes TEXT,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_grn_lines (
        id TEXT PRIMARY KEY,
        grn_header_id TEXT NOT NULL REFERENCES public.inv_grn_headers(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES public.inv_items(id),
        qty_received NUMERIC(12,4) NOT NULL CHECK (qty_received > 0),
        received_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
        unit_cost NUMERIC(10,4) NOT NULL DEFAULT 0,
        line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        expiry_date DATE,
        line_number INTEGER NOT NULL,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(grn_header_id, line_number)
      )`);

    // ── Transfers ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_transfer_headers (
        id TEXT PRIMARY KEY,
        transfer_number TEXT UNIQUE NOT NULL,
        source_location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
        destination_location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
        transfer_date DATE DEFAULT CURRENT_DATE,
        reference_text TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        created_by TEXT NOT NULL,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CHECK (source_location_id != destination_location_id)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_transfer_lines (
        id TEXT PRIMARY KEY,
        transfer_header_id TEXT NOT NULL REFERENCES public.inv_transfer_headers(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES public.inv_items(id),
        qty_requested NUMERIC(12,4) NOT NULL CHECK (qty_requested > 0),
        source_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
        breakdown_flag BOOLEAN DEFAULT false,
        destination_uom_id TEXT REFERENCES public.inv_uom_definitions(id),
        current_source_balance NUMERIC(12,4),
        line_number INTEGER NOT NULL,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(transfer_header_id, line_number)
      )`);

    // ── Stock Ledger (single source of truth) ─────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_stock_ledger (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES public.inv_items(id),
        location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
        ledger_type TEXT NOT NULL CHECK (ledger_type IN ('GRN','TRANSFER_IN','TRANSFER_OUT','SALE_DEPLETION','ADJUSTMENT','WASTE')),
        reference_number TEXT,
        quantity_change NUMERIC(12,4) NOT NULL,
        base_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
        cost_per_unit NUMERIC(10,4),
        total_cost NUMERIC(12,2),
        posted_by TEXT,
        gl_account_code TEXT,
        transaction_date TIMESTAMPTZ DEFAULT NOW(),
        inserted_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await client.query(`ALTER TABLE public.inv_stock_ledger ADD CONSTRAINT uq_ledger_transfer_line UNIQUE (reference_number, ledger_type, location_id, item_id)`).catch(()=>{});

    // ── Recipes ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_recipes (
        id TEXT PRIMARY KEY,
        menu_item_id TEXT NOT NULL,
        version_number INTEGER DEFAULT 1,
        is_current BOOLEAN DEFAULT true,
        created_by TEXT,
        total_cost NUMERIC(10,4) DEFAULT 0.00,
        notes TEXT,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(menu_item_id, version_number)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_recipe_lines (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL REFERENCES public.inv_recipes(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES public.inv_items(id),
        qty_required NUMERIC(10,4) NOT NULL CHECK (qty_required > 0),
        prep_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
        wastage_pct NUMERIC(5,2) DEFAULT 0.00,
        line_number INTEGER NOT NULL,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(recipe_id, line_number)
      )`);

    // ── Physical Counts ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_physical_counts (
        id TEXT PRIMARY KEY,
        location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
        count_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
        counted_by TEXT,
        inserted_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_physical_count_lines (
        id TEXT PRIMARY KEY,
        count_id TEXT NOT NULL REFERENCES public.inv_physical_counts(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES public.inv_items(id),
        physical_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
        uom_id TEXT REFERENCES public.inv_uom_definitions(id),
        notes TEXT,
        inserted_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    // ── Variance Reports ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_variance_reports (
        id TEXT PRIMARY KEY,
        report_number TEXT UNIQUE NOT NULL,
        location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        generated_by TEXT,
        total_items INTEGER DEFAULT 0,
        ok_count INTEGER DEFAULT 0,
        warning_count INTEGER DEFAULT 0,
        critical_count INTEGER DEFAULT 0,
        inserted_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_variance_lines (
        id TEXT PRIMARY KEY,
        variance_report_id TEXT NOT NULL REFERENCES public.inv_variance_reports(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES public.inv_items(id),
        theoretical_qty NUMERIC(12,4) NOT NULL,
        physical_qty NUMERIC(12,4) NOT NULL,
        variance_qty NUMERIC(12,4) NOT NULL,
        variance_percentage NUMERIC(7,4) NOT NULL,
        alert_level TEXT NOT NULL CHECK (alert_level IN ('OK','WARNING','CRITICAL')),
        item_cost NUMERIC(10,4),
        variance_value NUMERIC(12,2),
        inserted_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_stock_take_sheets (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        location_id   TEXT NOT NULL REFERENCES public.inv_locations(id),
        period_start  DATE NOT NULL,
        period_end    DATE NOT NULL,
        status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked')),
        created_by    TEXT,
        created_at    TIMESTAMPTZ DEFAULT now(),
        locked_at     TIMESTAMPTZ,
        locked_by     TEXT,
        UNIQUE (location_id, period_start, period_end)
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inv_stock_take_lines (
        id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        sheet_id              TEXT NOT NULL REFERENCES public.inv_stock_take_sheets(id) ON DELETE CASCADE,
        item_id               TEXT NOT NULL REFERENCES public.inv_items(id),
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
      )`);

    // Append-only audit trail for period/sheet reopen actions
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.inventory_period_audit (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        period_id     TEXT,
        action        TEXT NOT NULL,
        user_id       TEXT,
        user_name     TEXT,
        change_reason TEXT,
        created_at    TIMESTAMPTZ DEFAULT now()
      )`);

    // ── Performance Indexes ────────────────────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_items_category ON public.inv_items(category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_items_active ON public.inv_items(is_active)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_grn_status ON public.inv_grn_headers(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_transfer_status ON public.inv_transfer_headers(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_ledger_item_loc ON public.inv_stock_ledger(item_id, location_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_ledger_type ON public.inv_stock_ledger(ledger_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_ledger_ref ON public.inv_stock_ledger(reference_number) WHERE reference_number IS NOT NULL`);

    // ── Seed standard UOM definitions + default locations ─────────────────
    await seedUomDefinitions(client);
    await seedDefaultLocations(client);

    // Sync all existing cost_centres as Outlet locations
    await syncCostCentresToLocations(client);

    console.log('[inv-v11] ✅ Inventory tables created and seeded successfully');

  } catch (err) {
    console.error('[inv-v11] Table creation error (non-fatal — routes will work if tables already exist):', err.message);
  } finally {
    client.release();
  }
}

/**
 * Sync cost_centres → inv_locations (Outlets only).
 * Called on boot and when a cost centre is added/deleted.
 * Idempotent: ON CONFLICT DO NOTHING.
 */
async function syncCostCentresToLocations(client) {
  try {
    // Check cost_centres table exists before querying
    const tableCheck = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cost_centres' LIMIT 1`
    );
    if (!tableCheck.rows.length) return;

    // Ensure no unique constraint on name blocks the sync
    await client.query(
      `ALTER TABLE public.inv_locations DROP CONSTRAINT IF EXISTS inv_locations_name_key`
    ).catch(() => {}); // ignore if already dropped

    const centres = await client.query(`SELECT id, name, description FROM cost_centres WHERE active=true`);
    const syncedIds = [];

    for (const cc of centres.rows) {
      const locId = `loc_cc_${cc.id}`;
      try {
        await client.query(
          `INSERT INTO public.inv_locations (id, name, location_type, description, is_active, inserted_at, updated_at)
           VALUES ($1,$2,'Outlet',$3,true,NOW(),NOW())
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, is_active=true, updated_at=NOW()`,
          [locId, cc.name, cc.description || null]
        );
        syncedIds.push(locId);
      } catch (rowErr) {
        // Per-row error tolerance — log and continue (don't stop entire sync)
        console.warn(`[inv-v11] Could not sync cost centre "${cc.name}" to locations:`, rowErr.message);
      }
    }

    // Deactivate orphaned cost_centre-linked locations (cost centre was deleted)
    if (syncedIds.length > 0) {
      const placeholders = syncedIds.map((_, i) => `$${i+1}`).join(',');
      await client.query(
        `UPDATE public.inv_locations SET is_active=false, updated_at=NOW()
         WHERE id LIKE 'loc_cc_%' AND id NOT IN (${placeholders})`,
        syncedIds
      ).catch(() => {});
    }
    if (syncedIds.length > 0) {
      console.log(`[inv-v11] Synced ${syncedIds.length} cost centres to inv_locations`);
    }
  } catch (err) {
    console.warn('[inv-v11] Cost centre sync warning:', err.message);
  }
}

// Run on startup — async, non-blocking
// Catches ALL errors so a failed DB connection never crashes the module load
ensureInventoryTables().catch(err => {
  console.warn('[inv-v11] Bootstrap warning (tables may not exist yet):', err.message);
});

// ── Manual init endpoint ───────────────────────────────────────────────────────
// GET /api/v1/inventory/init?key=confirm
// Triggers table creation on demand — useful for fresh Vercel/Baradzanwa deployments
// where DATABASE_URL was just configured and bootstrap already ran (and failed)
router.get('/init', async (req, res) => {
  if (req.query.key !== 'confirm') {
    return res.json({
      ok: false,
      error: 'Pass ?key=confirm to initialise inventory tables',
      example: '/api/v1/inventory/init?key=confirm'
    });
  }
  try {
    await ensureInventoryTables();
    // Verify tables now exist
    const check = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name LIKE 'inv_%'
       ORDER BY table_name`
    );
    res.json({
      ok: true,
      message: 'Inventory tables initialised successfully',
      tables: check.rows.map(r => r.table_name),
      count: check.rows.length
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// GRN (Goods Received Note) Endpoints

// ============================================================================
// GRN (Goods Received Note) Endpoints
// ============================================================================

/**
 * POST /api/v1/inventory/grn
 * Create new GRN header and optional line items
 */
router.post('/grn', async (req, res) => {
  const { supplier_name, destination_location_id, created_by, lines } = req.body;

  if (!supplier_name || !destination_location_id || !created_by) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }
  // Validate destination is an active location — prevents posting to inactive/seeded locations
  // that are no longer visible in the frontend dropdown
  const locCheck = await pool.query(
    `SELECT id, name, is_active FROM public.inv_locations WHERE id = $1 LIMIT 1`,
    [destination_location_id]
  );
  if (!locCheck.rows.length) {
    return res.status(400).json({ ok: false, error: `Destination location '${destination_location_id}' does not exist` });
  }
  if (locCheck.rows[0].is_active === false) {
    return res.status(400).json({ ok: false, error: `Destination location '${locCheck.rows[0].name}' is inactive. Please select an active location from the dropdown.` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get next GRN number
    const grnCountRes = await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(grn_number FROM 10) AS INTEGER)), 0) + 1 as next_num
       FROM public.inv_grn_headers 
       WHERE grn_number ~ ('^GRN-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-\\d+$')`
    );
    const nextNum = grnCountRes.rows[0].next_num;
    const grnNumber = 'GRN-' + new Date().getFullYear() + '-' + String(nextNum).padStart(4, '0');

    // Create GRN header
    const grnRes = await client.query(
      `INSERT INTO public.inv_grn_headers 
      (id, grn_number, supplier_name, destination_location_id, created_by, status, inserted_at)
      VALUES ($1, $2, $3, $4, $5, 'draft', $6)
      RETURNING *`,
      [randomUUID(), grnNumber, supplier_name, destination_location_id, created_by, new Date()]
    );

    const grn = grnRes.rows[0];

    // Ensure VAT columns exist (additive — safe on every request, no-op when present)
    try {
      await client.query(`ALTER TABLE public.inv_grn_lines ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(6,3) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE public.inv_grn_lines ADD COLUMN IF NOT EXISTS row_vat NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS vat_total NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS grn_total NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS notes TEXT`);
      // Invalidate cached column list so the new ones get picked up below
      client._grn_cols_checked = false;
    } catch (e) { /* non-fatal — columns may already exist or the DB user lacks DDL privileges */ }

    // Add line items if provided
    if (Array.isArray(lines) && lines.length > 0) {
      let totalValue = 0;
      let totalVat = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineTotal = line.qty_received * line.unit_cost;
        const vatRate = Number(line.vat_rate || 0);
        const rowVat = Number((lineTotal * (vatRate / 100)).toFixed(2));
        totalValue += lineTotal;
        totalVat += rowVat;

        // Ensure item exists, create if necessary
        let itemId = line.item_id;
        const itemCheckRes = await client.query(
          `SELECT id FROM public.inv_items WHERE id = $1 LIMIT 1`,
          [itemId]
        );
        
        if (itemCheckRes.rows.length === 0) {
          // Create item if it doesn't exist - use provided name as ID for consistency
          const newItemId = itemId || `item-${Date.now()}-${i}`;
          await client.query(
            `INSERT INTO public.inv_items (id, name, category, base_uom_id, inserted_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [newItemId, itemId || 'Item', 'Food', 'uom_case', new Date()]
          );
          itemId = newItemId;
        }

        // ISSUE 1 FIX: resolved_uom is the UOM ID from frontend (sent as received_uom_id).
        // We write it into BOTH received_uom_id and uom_id for backward compat across
        // schema versions (some DBs have uom_id, some have received_uom_id).
        const resolvedUomId = line.received_uom_id || line.uom_id || 'uom_unit';
        const expiryDate = line.expiry_date || null;

        // Detect which column names actually exist in this DB instance (cached once per request).
        // Handles schema divergence: old = (uom_id, total_cost), new = (received_uom_id, line_total).
        // VAT columns (vat_rate, row_vat) are checked here too so the ALTER TABLE above is picked up.
        if (!client._grn_cols_checked) {
          const colCheck = await client.query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema='public' AND table_name='inv_grn_lines'
             AND column_name IN ('received_uom_id','uom_id','expiry_date','notes','line_total','total_cost','vat_rate','row_vat')`
          );
          client._grn_cols = colCheck.rows.map(r => r.column_name);
          client._grn_cols_checked = true;
        }
        const hasCols     = client._grn_cols || [];
        const hasReceived = hasCols.includes('received_uom_id');
        const hasUomId    = hasCols.includes('uom_id');
        const hasExpiry   = hasCols.includes('expiry_date');
        const hasNotes    = hasCols.includes('notes');
        const hasVatRate  = hasCols.includes('vat_rate');
        const hasRowVat   = hasCols.includes('row_vat');
        // line_total (new schema) vs total_cost (old schema) — use whichever exists
        const lineTotalCol = hasCols.includes('line_total') ? 'line_total'
                           : hasCols.includes('total_cost') ? 'total_cost'
                           : 'line_total'; // fallback assumes new schema

        // Build INSERT dynamically — works on both old and new schema versions
        const colNames = ['id','grn_header_id','item_id','qty_received','unit_cost', lineTotalCol,'line_number','inserted_at'];
        const colVals  = [randomUUID(), grn.id, itemId, line.qty_received, line.unit_cost, lineTotal, i + 1, new Date()];
        if (hasReceived) { colNames.push('received_uom_id'); colVals.push(resolvedUomId); }
        if (hasUomId)    { colNames.push('uom_id');          colVals.push(resolvedUomId); }
        if (hasExpiry)   { colNames.push('expiry_date');     colVals.push(expiryDate); }
        if (hasNotes && line.notes) { colNames.push('notes'); colVals.push(line.notes); }
        if (hasVatRate)  { colNames.push('vat_rate');        colVals.push(vatRate); }
        if (hasRowVat)   { colNames.push('row_vat');         colVals.push(rowVat); }
        const placeholders = colVals.map((_, idx) => `$${idx + 1}`).join(', ');
        await client.query(
          `INSERT INTO public.inv_grn_lines (${colNames.join(', ')}) VALUES (${placeholders})`,
          colVals
        );
      }

      // Update GRN totals + header fields. total_value stays as the sub-total
      // for backward compatibility with downstream consumers; vat_total and
      // grn_total are the new VAT-aware columns.
      const grnTotal = Number((totalValue + totalVat).toFixed(2));
      const headerNotes = req.body.header_notes || req.body.notes || null;
      await client.query(
        `UPDATE public.inv_grn_headers SET
           total_value = $1,
           vat_total = $2,
           grn_total = $3,
           supplier_invoice_number = COALESCE($4, supplier_invoice_number),
           receipt_date = COALESCE($5::date, receipt_date),
           notes = COALESCE($6, notes)
         WHERE id = $7`,
        [totalValue, totalVat, grnTotal,
         req.body.supplier_invoice_number || null,
         req.body.receipt_date || null,
         headerNotes,
         grn.id]
      ).catch(() => {
        // Fallback for older schema without VAT columns — still updates total_value
        return client.query(
          `UPDATE public.inv_grn_headers SET total_value = $1,
              supplier_invoice_number = COALESCE($2, supplier_invoice_number),
              receipt_date = COALESCE($3::date, receipt_date)
            WHERE id = $4`,
          [totalValue, req.body.supplier_invoice_number || null, req.body.receipt_date || null, grn.id]
        );
      });
    }

    // Fetch updated GRN with final total
    const finalGrnRes = await client.query(`SELECT * FROM public.inv_grn_headers WHERE id = $1`, [grn.id]);
    const finalGrn = finalGrnRes.rows[0];

    await client.query('COMMIT');
    return res.json({ ok: true, data: finalGrn });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/inventory/grn
 * List GRNs (paginated, filterable)
 */
router.get('/grn', async (req, res) => {
  const { status, location_id, limit = 50, offset = 0 } = req.query;
  let sql = 'SELECT * FROM public.inv_grn_headers WHERE 1=1';
  const params = [];

  if (status) {
    sql += ` AND status = $${params.length + 1}`;
    params.push(status);
  }

  if (location_id) {
    sql += ` AND destination_location_id = $${params.length + 1}`;
    params.push(location_id);
  }

  sql += ` ORDER BY inserted_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  try {
    const result = await pool.query(sql, params);
    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/v1/inventory/grn/:id/post
 * Post GRN to ledger and trigger GL entry
 */
router.post('/grn/:id/post', async (req, res) => {
  const { id } = req.params;
  const { posted_by } = req.body;

  if (!posted_by) {
    return res.status(400).json({ ok: false, error: 'posted_by required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get GRN
    const grnRes = await client.query(`SELECT * FROM public.inv_grn_headers WHERE id = $1`, [id]);
    if (!grnRes.rows.length) throw new Error('GRN not found');

    const grn = grnRes.rows[0];
    if (grn.status === 'posted') {
      await client.query('ROLLBACK');
      client.release();
      return res.json({ ok: true, message: 'GRN already posted — no-op' });
    }

    // Get lines
    const linesRes = await client.query(`SELECT * FROM public.inv_grn_lines WHERE grn_header_id = $1`, [id]);

    // FIX: Create ledger entries + correct WAC calculation
    for (const line of linesRes.rows) {
      const itemRes = await client.query(
        `SELECT i.base_uom_id, i.weighted_avg_cost, COALESCE(SUM(sl.quantity_change),0) as current_qty
         FROM public.inv_items i
         LEFT JOIN public.inv_stock_ledger sl ON sl.item_id = i.id AND sl.location_id = $2
         WHERE i.id = $1
         GROUP BY i.base_uom_id, i.weighted_avg_cost`,
        [line.item_id, grn.destination_location_id]
      );
      const baseUomId    = itemRes.rows[0]?.base_uom_id || line.received_uom_id || line.uom_id;
      const existingQty  = Number(itemRes.rows[0]?.current_qty || 0);
      const existingWac  = Number(itemRes.rows[0]?.weighted_avg_cost || 0);
      const newQty       = Number(line.qty_received);
      const newUnitCost  = Number(line.unit_cost);

      // ── Weighted Average Cost formula (industry standard) ──────────────────
      // WAC = (existing_qty * existing_wac + received_qty * unit_cost) / (existing_qty + received_qty)
      const newWac = (existingQty + newQty) > 0
        ? ((existingQty * existingWac) + (newQty * newUnitCost)) / (existingQty + newQty)
        : newUnitCost;

      // Create GRN stock ledger entry
      await client.query(
        `INSERT INTO public.inv_stock_ledger
         (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, cost_per_unit, total_cost, posted_by, gl_account_code, inserted_at)
         VALUES ($1,$2,$3,'GRN',$4,$5,$6,$7,$8,$9,'INVENTORY_ASSET',NOW())`,
        [randomUUID(), line.item_id, grn.destination_location_id, grn.grn_number + '-L' + line.line_number,
         newQty, baseUomId, newUnitCost, line.line_total || line.total_cost || (newQty * newUnitCost), posted_by]
      );

      // ── Update inv_items WAC (SAVEPOINT — weighted_avg_cost may not exist on all schemas) ──
      try {
        await client.query('SAVEPOINT items_wac_sp');
        await client.query(
          `UPDATE public.inv_items SET
             last_cost_price   = $1,
             weighted_avg_cost = $2,
             updated_at        = NOW()
           WHERE id = $3`,
          [newUnitCost, parseFloat(newWac.toFixed(4)), line.item_id]
        );
        await client.query('RELEASE SAVEPOINT items_wac_sp');
      } catch (wacErr) {
        await client.query('ROLLBACK TO SAVEPOINT items_wac_sp').catch(() => {});
        console.warn('[inv-v11] inv_items WAC update skipped:', wacErr.message);
      }

      // ── Sync updated cost to products table (SAVEPOINT) ───────────────────
      try {
        await client.query('SAVEPOINT products_sp');
        await client.query(
          `UPDATE public.products SET cost_price = $1, updated_at = NOW() WHERE id = $2`,
          [newUnitCost, line.item_id]
        );
        await client.query('RELEASE SAVEPOINT products_sp');
      } catch (prodErr) {
        await client.query('ROLLBACK TO SAVEPOINT products_sp').catch(() => {});
        // non-fatal — products sync failure shouldn't block GRN posting
      }
    }

    // FIX: Use correct variable names (was postedBy/grnHeaderId — undefined!)
    await client.query(
      `UPDATE public.inv_grn_headers SET status = 'posted', posted_by = $1, posted_at = NOW() WHERE id = $2`,
      [posted_by, id]
    );

    // ── Integrate with Inventory Reconciliation period (FIX: use $N placeholders) ──
    const grnDate = new Date(grn.inserted_at || grn.created_at || Date.now()).toISOString().split('T')[0];
    const periodRes = await client.query(
      `SELECT id FROM inventory_periods
       WHERE status IN ('open', 'reconciling')
         AND $1 BETWEEN start_date AND end_date
       LIMIT 1`,
      [grnDate]
    );
    const periodId = periodRes.rows?.[0]?.id || null;

    // Insert inventory_transactions for reconciliation period.
    // CRITICAL FIX: Use SAVEPOINT not bare try/catch.
    // When a statement fails inside a PostgreSQL transaction, the connection enters
    // "aborted transaction" state. All subsequent statements (INCLUDING COMMIT) silently
    // no-op and PostgreSQL converts COMMIT → ROLLBACK. The pg driver doesn't throw on this,
    // so JavaScript sees {ok:true} but the entire transaction was rolled back.
    // SAVEPOINT allows partial rollback while keeping the outer transaction valid.
    try {
      await client.query('SAVEPOINT inv_tx_sp');
      for (const line of linesRes.rows) {
        const txNum      = `GRN-${grn.grn_number}-L${line.line_number}`;
        const totalValue = Number(line.qty_received) * Number(line.unit_cost);
        await client.query(
          `INSERT INTO inventory_transactions
           (transaction_type, transaction_number, period_id, transaction_date, department,
            total_quantity, total_value, supplier_name, created_by, is_historical_backfill)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
           ON CONFLICT (transaction_number) DO NOTHING`,
          ['grv', txNum, periodId, grnDate, 'Kitchen',
           line.qty_received, totalValue, grn.supplier_name, posted_by]
        );
      }
      await client.query('RELEASE SAVEPOINT inv_tx_sp');
    } catch (txErr) {
      // Rollback to savepoint — outer transaction stays valid and can still COMMIT
      await client.query('ROLLBACK TO SAVEPOINT inv_tx_sp').catch(() => {});
      console.warn('[inv-v11] inventory_transactions insert skipped (schema mismatch):', txErr.message);
    }

    // period update — also protected by SAVEPOINT
    if (periodId) {
      try {
        await client.query('SAVEPOINT period_sp');
        const totalGrnValue = linesRes.rows.reduce((s, l) => s + Number(l.qty_received) * Number(l.unit_cost), 0);
        await client.query(
          `UPDATE inventory_periods SET received_value = COALESCE(received_value,0) + $1 WHERE id = $2`,
          [totalGrnValue, periodId]
        );
        await client.query('RELEASE SAVEPOINT period_sp');
      } catch (periodErr) {
        await client.query('ROLLBACK TO SAVEPOINT period_sp').catch(() => {});
        console.warn('[inv-v11] period update skipped:', periodErr.message);
      }
    }

    await client.query('COMMIT');

    // ── GL Pending Batch (post-commit, non-fatal) ──────────────────────────────
    const glGrnValue = linesRes.rows.reduce((s, l) => s + Number(l.qty_received) * Number(l.unit_cost), 0);
    if (glGrnValue > 0) {
      try {
        await pool.query(
          `INSERT INTO gl_pending_batches (origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount)
           VALUES ('inv_grn_headers', $1, $2, '1400', '2100', $3)
           ON CONFLICT (origin_table, origin_id) DO NOTHING`,
          [id, `GRN ${grn.grn_number} — stock receipt`, glGrnValue]
        );
      } catch (glErr) {
        console.warn('[inv-v11] gl_pending_batches insert skipped for GRN:', glErr.message);
      }
    }

    res.json({ ok: true, message: `GRN ${grn.grn_number} posted successfully` });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/inventory/grn/:id
 * Fetch single GRN with its line items
 */
router.get('/grn/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const header = await pool.query(`SELECT * FROM public.inv_grn_headers WHERE id=$1`, [id]);
    if (!header.rows.length) return res.status(404).json({ ok: false, error: 'GRN not found' });
    const lines = await pool.query(
      `SELECT gl.*, i.name as item_name FROM public.inv_grn_lines gl
       LEFT JOIN public.inv_items i ON i.id = gl.item_id
       WHERE gl.grn_header_id=$1 ORDER BY gl.line_number`, [id]
    );
    res.json({ ok: true, data: { ...header.rows[0], lines: lines.rows } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/**
 * DELETE /api/v1/inventory/grn/:id
 * Delete a GRN and reverse its stock ledger entries (if posted)
 */
/**
 * PUT /api/v1/inventory/grn/:id
 * Update a draft GRN. Posted GRNs are immutable — they would require reversing
 * the stock ledger which we don't expose. Replaces header fields and lines.
 */
router.put('/grn/:id', async (req, res) => {
  const { id } = req.params;
  const { supplier_name, supplier_id, supplier_invoice_number, destination_location_id,
          receipt_date, notes, lines } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT id, status FROM public.inv_grn_headers WHERE id=$1`, [id]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'GRN not found' }); }
    if (cur.rows[0].status === 'posted') {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Cannot edit a posted GRN. Delete it and create a new one instead.' });
    }

    // Ensure VAT columns exist (idempotent)
    try {
      await client.query(`ALTER TABLE public.inv_grn_lines ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(6,3) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE public.inv_grn_lines ADD COLUMN IF NOT EXISTS row_vat NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS vat_total NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS grn_total NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS notes TEXT`);
    } catch { /* non-fatal */ }

    // Detect available columns on inv_grn_lines (same logic as POST handler)
    const colCheck = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='inv_grn_lines'
       AND column_name IN ('received_uom_id','uom_id','expiry_date','notes','line_total','total_cost','vat_rate','row_vat')`
    );
    const hasCols = colCheck.rows.map(r => r.column_name);
    const hasReceived = hasCols.includes('received_uom_id');
    const hasUomId    = hasCols.includes('uom_id');
    const hasExpiry   = hasCols.includes('expiry_date');
    const hasVatRate  = hasCols.includes('vat_rate');
    const hasRowVat   = hasCols.includes('row_vat');
    const lineTotalCol = hasCols.includes('line_total') ? 'line_total'
                       : hasCols.includes('total_cost') ? 'total_cost'
                       : 'line_total';

    // Replace lines: delete-then-insert is simpler than diffing
    await client.query(`DELETE FROM public.inv_grn_lines WHERE grn_header_id=$1`, [id]);

    let totalValue = 0;
    let totalVat = 0;
    if (Array.isArray(lines)) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineTotal = Number(line.qty_received || 0) * Number(line.unit_cost || 0);
        const vatRate = Number(line.vat_rate || 0);
        const rowVat = Number((lineTotal * (vatRate / 100)).toFixed(2));
        totalValue += lineTotal;
        totalVat += rowVat;
        const resolvedUomId = line.received_uom_id || line.uom_id || 'uom_unit';

        const colNames = ['id','grn_header_id','item_id','qty_received','unit_cost', lineTotalCol, 'line_number','inserted_at'];
        const colVals  = [randomUUID(), id, line.item_id, line.qty_received, line.unit_cost, lineTotal, i + 1, new Date()];
        if (hasReceived) { colNames.push('received_uom_id'); colVals.push(resolvedUomId); }
        if (hasUomId)    { colNames.push('uom_id');          colVals.push(resolvedUomId); }
        if (hasExpiry)   { colNames.push('expiry_date');     colVals.push(line.expiry_date || null); }
        if (hasVatRate)  { colNames.push('vat_rate');        colVals.push(vatRate); }
        if (hasRowVat)   { colNames.push('row_vat');         colVals.push(rowVat); }
        const placeholders = colVals.map((_, idx) => `$${idx + 1}`).join(', ');
        await client.query(`INSERT INTO public.inv_grn_lines (${colNames.join(', ')}) VALUES (${placeholders})`, colVals);
      }
    }

    const grnTotal = Number((totalValue + totalVat).toFixed(2));
    await client.query(
      `UPDATE public.inv_grn_headers SET
         supplier_name = COALESCE($1, supplier_name),
         supplier_id   = COALESCE($2, supplier_id),
         supplier_invoice_number = COALESCE($3, supplier_invoice_number),
         destination_location_id = COALESCE($4, destination_location_id),
         receipt_date  = COALESCE($5::date, receipt_date),
         notes         = COALESCE($6, notes),
         total_value   = $7,
         vat_total     = $8,
         grn_total     = $9,
         updated_at    = NOW()
       WHERE id = $10`,
      [supplier_name || null, supplier_id || null, supplier_invoice_number || null,
       destination_location_id || null, receipt_date || null, notes || null,
       totalValue, totalVat, grnTotal, id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, data: { id, total_value: totalValue, vat_total: totalVat, grn_total: grnTotal } });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: e.message });
  } finally { client.release(); }
});

router.delete('/grn/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const grnRes = await client.query(`SELECT * FROM public.inv_grn_headers WHERE id=$1`, [id]);
    if (!grnRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'GRN not found' }); }
    const grn = grnRes.rows[0];
    // Reverse ledger entries if posted
    if (grn.status === 'posted') {
      await client.query(
        `DELETE FROM public.inv_stock_ledger WHERE ledger_type='GRN' AND reference_number=$1`,
        [grn.grn_number]
      );
    }
    // Delete lines then header (FK cascade handles lines if set, but explicit is safer)
    await client.query(`DELETE FROM public.inv_grn_lines WHERE grn_header_id=$1`, [id]);
    await client.query(`DELETE FROM public.inv_grn_headers WHERE id=$1`, [id]);
    await client.query('COMMIT');
    res.json({ ok: true, deleted: id });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: e.message });
  } finally { client.release(); }
});

// ============================================================================
// STOCK TRANSFER Endpoints
// ============================================================================

/**
 * GET /api/v1/inventory/transfer
 * List transfers (paginated, filterable by status/date)
 */
router.get('/transfer', async (req, res) => {
  const { limit = 30, offset = 0, status } = req.query;
  try {
    let sql = `SELECT h.*,
                 COALESCE(h.source_location_id, h.from_location_id) as resolved_source,
                 COALESCE(h.destination_location_id, h.to_location_id) as resolved_destination
               FROM public.inv_transfer_headers h
               WHERE 1=1`;
    const params = [];
    if (status) { sql += ` AND h.status = $${params.length+1}`; params.push(status); }
    sql += ` ORDER BY h.inserted_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(Number(limit), Number(offset));
    const result = await pool.query(sql, params);
    // Normalize source/destination to unified field names for frontend
    const data = (result.rows || []).map(function(r) {
      return Object.assign({}, r, {
        source_location_id:      r.source_location_id      || r.from_location_id,
        destination_location_id: r.destination_location_id || r.to_location_id,
      });
    });
    res.json({ ok: true, data });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/**
 * POST /api/v1/inventory/transfer
 * Create stock transfer
 */
router.post('/transfer', async (req, res) => {
  // FIX: Accept both reference_note (frontend) and reference_text (legacy)
  const { source_location_id, destination_location_id, created_by, lines } = req.body;
  const reference_text = req.body.reference_text || req.body.reference_note || null;

  if (!source_location_id || !destination_location_id || !created_by) {
    return res.status(400).json({ ok: false, error: 'Missing required fields: source_location_id, destination_location_id, created_by' });
  }
  if (source_location_id === destination_location_id) {
    return res.status(400).json({ ok: false, error: 'Source and destination locations must be different' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get next transfer number
    const transCountRes = await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(transfer_number FROM 12) AS INTEGER)), 0) + 1 as next_num
       FROM public.inv_transfer_headers 
       WHERE transfer_number ~ ('^TRANS-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-\\d+$')`
    );
    const nextNum = transCountRes.rows[0].next_num;
    const transferNumber = 'TRANS-' + new Date().getFullYear() + '-' + String(nextNum).padStart(4, '0');

    // Create transfer header — write to BOTH old (from/to) and new (source/destination) columns
    // so the record is readable regardless of which schema version each deployment has.
    // Insert transfer header — try full schema first, fall back via SAVEPOINT.
    // Avoids information_schema query inside the hot path (slow on cold start).
    let transRes;
    await client.query('SAVEPOINT th_insert');
    try {
      // Primary: canonical source/destination columns only (no dependency on the
      // legacy from/to pair, which some production DBs were created without).
      transRes = await client.query(
        `INSERT INTO public.inv_transfer_headers
         (id, transfer_number, source_location_id, destination_location_id,
          created_by, reference_text, status, inserted_at)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING *`,
        [randomUUID(), transferNumber, source_location_id, destination_location_id, created_by, reference_text, new Date()]
      );
      await client.query('RELEASE SAVEPOINT th_insert');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT th_insert');
      // Fallback for ancient schemas that have only the from/to pair.
      transRes = await client.query(
        `INSERT INTO public.inv_transfer_headers
         (id, transfer_number, from_location_id, to_location_id, status, inserted_at)
         VALUES ($1,$2,$3,$4,'pending',$5) RETURNING *`,
        [randomUUID(), transferNumber, source_location_id, destination_location_id, new Date()]
      );
    }

    const transfer = transRes.rows[0];

    // Add line items
    if (Array.isArray(lines) && lines.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Get current source balance
        const balRes = await client.query(
          `SELECT COALESCE(SUM(quantity_change), 0) as balance 
          FROM public.inv_stock_ledger 
          WHERE item_id = $1 AND location_id = $2`,
          [line.item_id, source_location_id]
        );

        const currentBalance = Number(balRes.rows[0]?.balance || 0);

        await client.query(
          `INSERT INTO public.inv_transfer_lines 
          (id, transfer_header_id, item_id, qty_requested, source_uom_id, breakdown_flag, destination_uom_id, current_source_balance, line_number, inserted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [randomUUID(), transfer.id, line.item_id, line.qty_requested, line.source_uom_id, line.breakdown_flag || false, line.destination_uom_id, currentBalance, i + 1, new Date()]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, data: transfer });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

/**
 * Shared helper — executes per-line transfer operations inside an active pg client transaction.
 * Caller is responsible for BEGIN/COMMIT/ROLLBACK and releasing the client.
 */
async function executeTransferLines(client, lines, sourceLocId, destLocId, transferNumber, actorId) {
  let idx = 1;
  for (const line of lines) {
    const lnum = line.line_number || idx++;
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`,
      [line.item_id, sourceLocId]
    );

    const balRes = await client.query(
      `SELECT COALESCE(SUM(quantity_change), 0) AS balance
       FROM public.inv_stock_ledger
       WHERE item_id = $1 AND location_id = $2`,
      [line.item_id, sourceLocId]
    );
    const balance = Number(balRes.rows[0]?.balance || 0);
    const requested = Number(line.qty_requested);
    if (balance < requested) {
      throw new Error(
        `Insufficient stock for item ${line.item_id}: available ${balance.toFixed(3)}, requested ${requested.toFixed(3)}`
      );
    }

    await client.query(
      `INSERT INTO public.inv_stock_ledger
       (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by, inserted_at)
       VALUES ($1,$2,$3,'TRANSFER_OUT',$4,$5,$6,$7,NOW())
       ON CONFLICT (reference_number, ledger_type, location_id, item_id)
         WHERE ledger_type IN ('TRANSFER_IN','TRANSFER_OUT') DO NOTHING`,
      [randomUUID(), line.item_id, sourceLocId, transferNumber + '-L' + lnum, -requested, line.source_uom_id, actorId]
    );

    let destQty = requested;
    const destUomId = line.destination_uom_id || line.source_uom_id;
    if (line.breakdown_flag && line.destination_uom_id && line.destination_uom_id !== line.source_uom_id) {
      const convRes = await client.query(
        `SELECT conversion_factor FROM public.inv_uom_conversions
         WHERE item_id=$1 AND from_uom_id=$2 AND to_uom_id=$3 AND breakdown_allowed=true`,
        [line.item_id, line.source_uom_id, line.destination_uom_id]
      );
      if (convRes.rows.length) {
        destQty = destQty * Number(convRes.rows[0].conversion_factor);
      } else {
        const globalConv = await client.query(
          `SELECT conversion_factor FROM public.inv_uom_conversions
           WHERE from_uom_id=$1 AND to_uom_id=$2 AND breakdown_allowed=true LIMIT 1`,
          [line.source_uom_id, line.destination_uom_id]
        );
        if (globalConv.rows.length) {
          destQty = destQty * Number(globalConv.rows[0].conversion_factor);
        }
      }
    }

    await client.query(
      `INSERT INTO public.inv_stock_ledger
       (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by, inserted_at)
       VALUES ($1,$2,$3,'TRANSFER_IN',$4,$5,$6,$7,NOW())
       ON CONFLICT (reference_number, ledger_type, location_id, item_id)
         WHERE ledger_type IN ('TRANSFER_IN','TRANSFER_OUT') DO NOTHING`,
      [randomUUID(), line.item_id, destLocId, transferNumber + '-L' + lnum, destQty, destUomId, actorId]
    );
  }
}

/**
 * POST /api/v1/inventory/transfer/execute
 * Atomic transfer: creates header + lines + posts TRANSFER_OUT and TRANSFER_IN in one transaction.
 * Body: { source_location_id, destination_location_id, created_by, reference_text?, items: [{item_id, qty_requested, source_uom_id, breakdown_flag?, destination_uom_id?}] }
 */
router.post('/transfer/execute', async (req, res) => {
  const { source_location_id, destination_location_id, created_by, items } = req.body;
  const reference_text = req.body.reference_text || req.body.reference_note || null;

  if (!source_location_id || !destination_location_id || !created_by) {
    return res.status(400).json({ ok: false, error: 'Missing required fields: source_location_id, destination_location_id, created_by' });
  }
  if (source_location_id === destination_location_id) {
    return res.status(400).json({ ok: false, error: 'Source and destination locations must be different' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'items must be a non-empty array' });
  }
  for (const it of items) {
    if (!it.item_id || !(Number(it.qty_requested) > 0)) {
      return res.status(400).json({ ok: false, error: `Invalid line: item_id and qty_requested > 0 required` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const transCountRes = await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(transfer_number FROM 12) AS INTEGER)), 0) + 1 AS next_num
       FROM public.inv_transfer_headers
       WHERE transfer_number ~ ('^TRANS-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-\\d+$')`
    );
    const nextNum = transCountRes.rows[0].next_num;
    const transferNumber = 'TRANS-' + new Date().getFullYear() + '-' + String(nextNum).padStart(4, '0');

    let headerId;
    await client.query('SAVEPOINT th_exec');
    try {
      const hRes = await client.query(
        `INSERT INTO public.inv_transfer_headers
         (id, transfer_number, source_location_id, destination_location_id,
          created_by, reference_text,
          status, approved_by, approved_at, inserted_at)
         VALUES ($1,$2,$3,$4,$5,$6,'approved',$5,NOW(),NOW()) RETURNING id`,
        [randomUUID(), transferNumber, source_location_id, destination_location_id, created_by, reference_text]
      );
      await client.query('RELEASE SAVEPOINT th_exec');
      headerId = hRes.rows[0].id;
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT th_exec');
      const hRes = await client.query(
        `INSERT INTO public.inv_transfer_headers
         (id, transfer_number, from_location_id, to_location_id, status, inserted_at)
         VALUES ($1,$2,$3,$4,'approved',NOW()) RETURNING id`,
        [randomUUID(), transferNumber, source_location_id, destination_location_id]
      );
      headerId = hRes.rows[0].id;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await client.query(
        `INSERT INTO public.inv_transfer_lines
         (id, transfer_header_id, item_id, qty_requested, source_uom_id, breakdown_flag, destination_uom_id, line_number, inserted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [randomUUID(), headerId, it.item_id, it.qty_requested, it.source_uom_id || 'uom_bottle',
         it.breakdown_flag || false, it.destination_uom_id || null, i + 1]
      );
    }

    await executeTransferLines(client, items, source_location_id, destination_location_id, transferNumber, created_by);

    const destLoc = await client.query(
      `SELECT name, location_type FROM public.inv_locations WHERE id = $1`, [destination_location_id]
    );
    if (destLoc.rows.length) {
      const { name: locName, location_type } = destLoc.rows[0];
      if (location_type === 'Outlet') {
        const isBar        = /bar/i.test(locName);
        const isRestaurant = /restaurant|kitchen|room.service/i.test(locName);
        for (const it of items) {
          await client.query(`
            UPDATE public.products SET
              bar_visibility        = CASE WHEN $2 THEN true ELSE bar_visibility END,
              restaurant_visibility = CASE WHEN $3 THEN true ELSE restaurant_visibility END,
              active                = true,
              updated_at            = NOW()
            WHERE id = $1
          `, [it.item_id, isBar, isRestaurant]);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, transfer_id: headerId, transfer_number: transferNumber, lines_moved: items.length });
  } catch (error) {
    await client.query('ROLLBACK');
    const statusCode = error.message.startsWith('Insufficient stock') ? 409 : 500;
    res.status(statusCode).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/inventory/transfer/:id/approve
 * Approve and execute transfer
 */
router.post('/transfer/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { approved_by } = req.body;

  if (!approved_by) {
    return res.status(400).json({ ok: false, error: 'approved_by required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get transfer
    const transRes = await client.query(`SELECT * FROM public.inv_transfer_headers WHERE id = $1`, [id]);
    if (!transRes.rows.length) throw new Error('Transfer not found');

    const transfer = transRes.rows[0];
    if (transfer.status === 'approved') {
      await client.query('ROLLBACK');
      client.release();
      return res.json({ ok: true, message: `Transfer ${transfer.transfer_number} already approved — no-op` });
    }

    // Get lines
    const linesRes = await client.query(`SELECT * FROM public.inv_transfer_lines WHERE transfer_header_id = $1`, [id]);

    // Resolve location IDs once at function scope (used in loop AND after loop)
    const resolvedSource = transfer.source_location_id || transfer.from_location_id;
    const resolvedDest   = transfer.destination_location_id || transfer.to_location_id;

    // Process each line
    await executeTransferLines(client, linesRes.rows, resolvedSource, resolvedDest, transfer.transfer_number, approved_by);

    // Update transfer status (use SAVEPOINT to keep transaction valid if approved_at column missing)
    try {
      await client.query('SAVEPOINT approve_sp');
      await client.query(
        `UPDATE public.inv_transfer_headers SET status='approved', approved_by=$1, approved_at=$2 WHERE id=$3`,
        [approved_by, new Date(), id]
      );
      await client.query('RELEASE SAVEPOINT approve_sp');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT approve_sp').catch(()=>{});
      await client.query(`UPDATE public.inv_transfer_headers SET status='approved', approved_by=$1 WHERE id=$2`, [approved_by, id]);
    }

    // ── Sync POS product visibility based on destination outlet ────────────
    const destLoc = await client.query(
      `SELECT name, location_type FROM public.inv_locations WHERE id = $1`, [resolvedDest]
    );
    if (destLoc.rows.length) {
      const { name: locName, location_type } = destLoc.rows[0];
      if (location_type === 'Outlet') {
        const isBar        = /bar/i.test(locName);
        const isRestaurant = /restaurant|kitchen|room.service/i.test(locName);
        const itemIds = linesRes.rows.map(l => l.item_id);
        for (const itemId of itemIds) {
          await client.query(`
            UPDATE public.products SET
              bar_visibility        = CASE WHEN $2 THEN true ELSE bar_visibility END,
              restaurant_visibility = CASE WHEN $3 THEN true ELSE restaurant_visibility END,
              active                = true,
              updated_at            = NOW()
            WHERE id = $1
          `, [itemId, isBar, isRestaurant]);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, message: `Transfer ${transfer.transfer_number} approved` });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// INVENTORY BALANCE & LEDGER Endpoints
// ============================================================================

/**
  * GET /api/v1/inventory/balance/:location_id
  * Get current balances per location
  */
router.get('/balance/:location_id', async (req, res) => {
  const { location_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
        item_id,
        COALESCE(SUM(quantity_change), 0) as current_balance
      FROM public.inv_stock_ledger
      WHERE location_id = $1
      GROUP BY item_id
      ORDER BY item_id`,
      [location_id]
    );

    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/v1/inventory/adjust
 * Manual stock adjustment — writes a single ADJUSTMENT row to the ledger.
 * Body: { item_id, location_id, delta, reason?, adjusted_by? }
 * delta may be positive (stock in) or negative (stock out). Refuses to drive
 * the on-hand balance below zero.
 */
router.post('/adjust', async (req, res) => {
  const { item_id, location_id, delta, reason, adjusted_by } = req.body || {};
  const d = Number(delta);
  if (!item_id || !location_id) {
    return res.status(400).json({ ok: false, error: 'item_id and location_id are required' });
  }
  if (!Number.isFinite(d) || d === 0) {
    return res.status(400).json({ ok: false, error: 'delta must be a non-zero number' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize concurrent adjustments to the same item+location
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [item_id, location_id]);

    const balRes = await client.query(
      `SELECT COALESCE(SUM(quantity_change), 0) AS balance
       FROM public.inv_stock_ledger WHERE item_id = $1 AND location_id = $2`,
      [item_id, location_id]
    );
    const balance = Number(balRes.rows[0]?.balance || 0);
    if (balance + d < 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        ok: false,
        error: `Adjustment would set stock below zero (current ${balance}, delta ${d})`,
      });
    }

    // Most-recent UOM for this item, fallback to the item master base UOM
    const uomRes = await client.query(
      `SELECT base_uom_id FROM public.inv_items WHERE id = $1`, [item_id]
    );
    const uomId = uomRes.rows[0]?.base_uom_id || 'uom_unit';

    const ledgerId = randomUUID();
    await client.query(
      `INSERT INTO public.inv_stock_ledger
         (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by, inserted_at)
       VALUES ($1, $2, $3, 'ADJUSTMENT', $4, $5, $6, $7, NOW())`,
      [ledgerId, item_id, location_id, `ADJ-${Date.now()}`, d, uomId, adjusted_by || 'system']
    );

    // Audit the manual adjustment (append-only trail shared with reopen/reverse)
    await client.query(
      `INSERT INTO public.inventory_period_audit (period_id, action, user_id, user_name, change_reason)
       VALUES ($1, 'STOCK_ADJUSTMENT', $2, $2, $3)`,
      [item_id, adjusted_by || 'system',
       `${location_id}: delta ${d}${reason ? ` — ${String(reason).trim()}` : ''}`]
    ).catch(() => {});

    await client.query('COMMIT');
    res.json({ ok: true, ledger_id: ledgerId, new_balance: balance + d });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/inventory/report/stock-on-hand
 * Stock balance per item for a location as of a point in time.
 * Query: location_id (required), as_of (optional ISO timestamp, defaults to NOW)
 */
router.get('/report/stock-on-hand', async (req, res) => {
  const { location_id } = req.query;
  const as_of = req.query.as_of || new Date().toISOString();
  if (!location_id) {
    return res.status(400).json({ ok: false, error: 'location_id is required' });
  }
  try {
    const result = await pool.query(
      `SELECT i.id,
              i.sku,
              i.name,
              i.category,
              i.weighted_avg_cost AS cost_price,
              COALESCE(SUM(sl.quantity_change), 0) AS balance,
              i.base_uom_id AS uom
       FROM public.inv_items i
       LEFT JOIN public.inv_stock_ledger sl
         ON sl.item_id = i.id
         AND sl.location_id = $1
         AND sl.inserted_at <= $2::timestamptz
       GROUP BY i.id, i.sku, i.name, i.category, i.weighted_avg_cost, i.base_uom_id
       ORDER BY i.category, i.name`,
      [location_id, as_of]
    );
    res.json({ ok: true, rows: result.rows, location_id, as_of });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/v1/inventory/report/movement
 * Stock ledger movement for a location between two dates.
 * Query: location_id (required), from (YYYY-MM-DD), to (YYYY-MM-DD)
 */
router.get('/report/movement', async (req, res) => {
  const { location_id } = req.query;
  const from = req.query.from || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  if (!location_id) {
    return res.status(400).json({ ok: false, error: 'location_id is required' });
  }
  try {
    const result = await pool.query(
      `WITH start_balances AS (
         SELECT item_id, COALESCE(SUM(quantity_change), 0) as start_bal
         FROM public.inv_stock_ledger
         WHERE location_id = $1 AND inserted_at < $2::date
         GROUP BY item_id
       ),
       period_movements AS (
         SELECT sl.inserted_at::date AS date,
                i.id,
                i.sku,
                i.name AS item_name,
                i.category,
                i.weighted_avg_cost AS avg_cost,
                sl.cost_per_unit AS cost_price,
                sl.item_id,
                sl.ledger_type,
                sl.reference_number,
                sl.quantity_change,
                sl.base_uom_id AS uom,
                sl.posted_by,
                sl.inserted_at
         FROM public.inv_stock_ledger sl
         JOIN public.inv_items i ON i.id = sl.item_id
         WHERE sl.location_id = $1
           AND sl.inserted_at >= $2::date
           AND sl.inserted_at < ($3::date + interval '1 day')
       )
       SELECT m.date,
              m.id,
              m.sku,
              m.item_name,
              m.category,
              m.cost_price,
              m.avg_cost,
              m.ledger_type,
              m.reference_number,
              m.quantity_change,
              m.uom,
              m.posted_by,
              COALESCE(sb.start_bal, 0) + SUM(m.quantity_change) OVER (
                PARTITION BY m.item_id
                ORDER BY m.inserted_at
                ROWS UNBOUNDED PRECEDING
              ) AS running_balance
       FROM period_movements m
       LEFT JOIN start_balances sb ON m.item_id = sb.item_id
       ORDER BY m.inserted_at DESC`,
      [location_id, from, to]
    );
    res.json({ ok: true, rows: result.rows, location_id, from, to });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

 /**
  * GET /api/v1/inventory/items-with-balance/:location_id
  * Get inventory items with their current balances for a location
  */
router.get('/items-with-balance/:location_id', async (req, res) => {
  const { location_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
        i.id,
        i.short_id,
        i.name,
        i.category,
        COALESCE(SUM(sl.quantity_change), 0) as current_balance
      FROM public.inv_items i
      LEFT JOIN public.inv_stock_ledger sl ON sl.item_id = i.id AND sl.location_id = $1
      WHERE i.is_active = true
      GROUP BY i.id, i.short_id, i.name, i.category
      HAVING COALESCE(SUM(sl.quantity_change), 0) > 0
      ORDER BY i.name`,
      [location_id]
    );

    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

 /**
  * GET /api/v1/inventory/stock-sheet/:location_id
  * Full physical stock-count sheet for a location: every active item with a
  * non-zero on-hand balance, returning name / sku / category / UOM /
  * weighted-average cost / total value. Fixes the Stock Sheet Report which
  * previously hit /balance (only {item_id, current_balance}) and rendered
  * NaN balances and blank name/cost columns.
  */
router.get('/stock-sheet/:location_id', async (req, res) => {
  const { location_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         i.id                                          AS item_id,
         i.name                                        AS item_name,
         COALESCE(NULLIF(i.sku, ''), i.short_id, i.id) AS sku,
         COALESCE(i.category, '')                      AS category,
         COALESCE(SUM(sl.quantity_change), 0)          AS balance,
         COALESCE(u.name, u.code, i.base_uom_id, '')   AS uom_symbol,
         COALESCE(i.weighted_avg_cost, 0)              AS weighted_avg_cost
       FROM public.inv_items i
       LEFT JOIN public.inv_stock_ledger sl ON sl.item_id = i.id AND sl.location_id = $1
       LEFT JOIN public.inv_uom_definitions u ON u.id = i.base_uom_id
       WHERE i.is_active = true
       GROUP BY i.id, i.name, i.sku, i.short_id, i.category, u.name, u.code, i.base_uom_id, i.weighted_avg_cost
       HAVING COALESCE(SUM(sl.quantity_change), 0) <> 0
       ORDER BY i.name`,
      [location_id]
    );
    const rows = result.rows.map(r => ({
      ...r,
      balance: Number(r.balance),
      weighted_avg_cost: Number(r.weighted_avg_cost),
      total_value: Number(r.balance) * Number(r.weighted_avg_cost),
    }));
    res.json({ ok: true, data: rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/v1/inventory/ledger
 * Query stock ledger entries
 */
router.get('/ledger', async (req, res) => {
  const { item_id, location_id, type, limit = 100, offset = 0 } = req.query;
  let sql = 'SELECT * FROM public.inv_stock_ledger WHERE 1=1';
  const params = [];

  if (item_id) {
    sql += ` AND item_id = $${params.length + 1}`;
    params.push(item_id);
  }
  if (location_id) {
    sql += ` AND location_id = $${params.length + 1}`;
    params.push(location_id);
  }
  if (type) {
    sql += ` AND ledger_type = $${params.length + 1}`;
    params.push(type);
  }

  sql += ` ORDER BY posted_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  try {
    const result = await pool.query(sql, params);
    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================================
// RECIPE Endpoints
// ============================================================================

/**
 * GET /api/v1/inventory/recipe/:menu_item_id
 * Fetch recipe with costing
 */
router.get('/recipe/:menu_item_id', async (req, res) => {
  const { menu_item_id } = req.params;

  try {
    const recipeRes = await pool.query(
      `SELECT * FROM public.inv_recipes WHERE menu_item_id = $1 AND is_current = true`,
      [menu_item_id]
    );

    if (!recipeRes.rows.length) {
      return res.json({ ok: true, data: null });
    }

    const recipe = recipeRes.rows[0];

    // Get ingredient lines
    const linesRes = await pool.query(
      `SELECT rl.*, ii.name, ii.weighted_avg_cost FROM public.inv_recipe_lines rl
       JOIN public.inv_items ii ON rl.item_id = ii.id
       WHERE rl.recipe_id = $1
       ORDER BY rl.line_number`,
      [recipe.id]
    );

    res.json({ ok: true, data: { recipe, lines: linesRes.rows } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/v1/inventory/recipe
 * Create or update recipe version
 */
router.post('/recipe', async (req, res) => {
  const { menu_item_id, lines, ingredients, created_by } = req.body;
  // The Recipe Builder client historically sent `ingredients` [{item_id, qty,
  // uom_id, wastage_pct}] while this endpoint only read `lines` [{item_id,
  // qty_required, prep_uom_id, …}] — so every recipe saved its header with ZERO
  // ingredient lines ("empty recipe"). Accept both shapes, normalized.
  const rawLines = Array.isArray(lines) && lines.length ? lines : ingredients;
  const normLines = Array.isArray(rawLines)
    ? rawLines.map(l => ({
        item_id: l.item_id,
        qty_required: Number(l.qty_required ?? l.qty ?? 0),
        prep_uom_id: l.prep_uom_id ?? l.uom_id ?? l.uom ?? null,
        wastage_pct: Number(l.wastage_pct || 0),
      })).filter(l => l.item_id && l.qty_required > 0)
    : [];

  if (!menu_item_id || !created_by) {
    return res.status(400).json({ ok: false, error: 'menu_item_id and created_by required' });
  }
  if (!normLines.length) {
    return res.status(400).json({ ok: false, error: 'At least one ingredient line with a positive quantity is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mark previous recipe as not current
    await client.query(`UPDATE public.inv_recipes SET is_current = false WHERE menu_item_id = $1`, [menu_item_id]);

    // Create new recipe. version_number must be assigned explicitly: the table
    // has UNIQUE (menu_item_id, version_number) and the column default collides
    // on the second save for the same menu item ("duplicate key ..._version_number_key").
    const recipeRes = await client.query(
      `INSERT INTO public.inv_recipes (id, menu_item_id, version_number, is_current, created_by, inserted_at)
      VALUES ($1, $2,
              (SELECT COALESCE(MAX(version_number), 0) + 1 FROM public.inv_recipes WHERE menu_item_id = $2),
              true, $3, $4)
      RETURNING *`,
      [randomUUID(), menu_item_id, created_by, new Date()]
    );

    const recipe = recipeRes.rows[0];

    // Add lines
    for (let i = 0; i < normLines.length; i++) {
      const line = normLines[i];
      await client.query(
        `INSERT INTO public.inv_recipe_lines
        (id, recipe_id, item_id, qty_required, prep_uom_id, wastage_pct, line_number, inserted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), recipe.id, line.item_id, line.qty_required, line.prep_uom_id, line.wastage_pct, i + 1, new Date()]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, data: recipe, lines_saved: normLines.length });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// VARIANCE REPORT Endpoints
// ============================================================================

/**
 * POST /api/v1/inventory/variance/generate
 * Generate variance report comparing theoretical stock (from ledger) vs physical count.
 *
 * FIX: Replaced broken duplicate handler. Uses correct column names matching
 * the actual inv_variance_lines schema:
 *   pos_theoretical_qty, physical_count_qty, variance_qty, variance_pct,
 *   variance_value, alert_level, base_uom_id
 * Also fixed: uses inserted_at (not posted_at) for date filtering on inv_stock_ledger.
 */
router.post('/variance/generate', async (req, res) => {
  const { location_id, period_start, period_end, generated_by, physical_count_id } = req.body;
  if (!location_id || !period_start || !period_end) {
    return res.status(400).json({ ok: false, error: 'location_id, period_start, period_end required' });
  }

  const client = await pool.connect();
  try {
    // ── Guard: ensure inventory tables exist (fail gracefully if not) ──────
    const tableCheck = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name='inv_stock_ledger' LIMIT 1`
    );
    if (!tableCheck.rows.length) {
      client.release();
      return res.status(503).json({
        ok: false,
        error: 'Inventory tables not yet initialised. Visit /api/v1/inventory/init?key=confirm to set up.'
      });
    }

    await client.query('BEGIN');

    // ── Theoretical qty: opening + GRNs + transfers in − transfers out − sales ──
    // FIX: uses inserted_at (actual column on inv_stock_ledger, not posted_at)
    const theoreticalRes = await client.query(`
      SELECT
        sl.item_id,
        i.name,
        i.sku,
        i.category,
        i.base_uom_id,
        COALESCE(u.code, 'UNIT') AS uom_code,
        SUM(CASE
          WHEN sl.ledger_type IN ('GRN','TRANSFER_IN') THEN ABS(sl.quantity_change)
          WHEN sl.ledger_type IN ('TRANSFER_OUT','SALE_DEPLETION','WASTE') THEN -ABS(sl.quantity_change)
          WHEN sl.quantity_change > 0 THEN sl.quantity_change
          ELSE -ABS(sl.quantity_change)
        END) AS theoretical_qty,
        COALESCE(AVG(NULLIF(sl.cost_per_unit, 0)), i.weighted_avg_cost, 0) AS avg_cost
      FROM public.inv_stock_ledger sl
      JOIN public.inv_items i ON i.id = sl.item_id
      LEFT JOIN public.inv_uom_definitions u ON u.id = i.base_uom_id
      WHERE sl.location_id = $1
        AND sl.inserted_at BETWEEN $2::timestamptz AND $3::date + interval '1 day'
        AND i.is_active = true
      GROUP BY sl.item_id, i.name, i.sku, i.category, i.base_uom_id, u.code, i.weighted_avg_cost
      HAVING SUM(ABS(sl.quantity_change)) > 0
    `, [location_id, period_start, period_end]);

    // ── Physical counts ───────────────────────────────────────────────────
    // Priority: an explicitly-linked count session; otherwise the most recent
    // LOCKED stock-take sheet for this location overlapping the period. This
    // unifies the on-demand variance report with the authoritative stock-take
    // counts — without a real count it would otherwise show zero variance.
    const physicalMap = {};
    let physicalSource = null;
    if (physical_count_id) {
      const physRes = await client.query(
        `SELECT item_id, physical_qty FROM public.inv_physical_count_lines WHERE count_id=$1`,
        [physical_count_id]
      );
      for (const row of physRes.rows) physicalMap[row.item_id] = Number(row.physical_qty);
      physicalSource = 'count_session';
    } else {
      const stRes = await client.query(
        `SELECT stl.item_id, stl.physical_qty
         FROM public.inv_stock_take_lines stl
         JOIN public.inv_stock_take_sheets sts ON sts.id = stl.sheet_id
         WHERE sts.location_id = $1 AND sts.status = 'locked'
           AND stl.physical_qty IS NOT NULL
           AND sts.period_end >= $2::date AND sts.period_start <= $3::date
           AND sts.locked_at = (
             SELECT MAX(s2.locked_at) FROM public.inv_stock_take_sheets s2
             WHERE s2.location_id = $1 AND s2.status = 'locked'
               AND s2.period_end >= $2::date AND s2.period_start <= $3::date
           )`,
        [location_id, period_start, period_end]
      ).catch(() => ({ rows: [] }));
      for (const row of stRes.rows) physicalMap[row.item_id] = Number(row.physical_qty);
      if (stRes.rows.length) physicalSource = 'stock_take';
    }

    // ── Report number — safe: count existing reports + 1 ─────────────────
    const numRes = await client.query(`SELECT COUNT(*)+1 AS n FROM public.inv_variance_reports`);
    const reportNum = 'VAR-' + String(numRes.rows[0].n).padStart(4,'0');
    const reportId  = randomUUID();

    let okCount = 0, warnCount = 0, critCount = 0;
    const lines = [];

    for (const row of theoreticalRes.rows) {
      const theoretical = Math.max(0, Number(row.theoretical_qty || 0));
      // Physical from the count/stock-take map; items not counted fall back to
      // theoretical (zero variance) so they don't show as false shrinkage.
      const physical    = (row.item_id in physicalMap) ? physicalMap[row.item_id] : theoretical;
      const variance    = physical - theoretical;
      // Cap so extreme ratios (tiny theoretical) can never overflow NUMERIC(12,4)
      const variancePct = Math.min(theoretical > 0 ? Math.abs(variance / theoretical) * 100 : 0, 99999999.9999);
      const cost        = Number(row.avg_cost || 0);
      const varianceVal = Math.abs(variance) * cost;

      let alert = 'OK';
      if (variancePct >= 5)      { alert = 'CRITICAL'; critCount++; }
      else if (variancePct >= 2) { alert = 'WARNING';  warnCount++; }
      else                       { okCount++; }

      lines.push({
        item_id: row.item_id, name: row.name, sku: row.sku, category: row.category,
        uom_code: row.uom_code, theoretical, physical, variance, variancePct, varianceVal, alert, cost
      });
    }

    // ── Insert report header ───────────────────────────────────────────────
    await client.query(`
      INSERT INTO public.inv_variance_reports
        (id, report_number, location_id, period_start, period_end, generated_by,
         ok_count, warning_count, critical_count, total_items, inserted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
      [reportId, reportNum, location_id, period_start, period_end, generated_by||'system',
       okCount, warnCount, critCount, lines.length]
    );

    // ── Insert variance lines (using actual DB column names) ───────────────
    for (const l of lines) {
      await client.query(`
        INSERT INTO public.inv_variance_lines
          (id, variance_report_id, item_id,
           theoretical_qty, physical_qty, variance_qty,
           variance_percentage, variance_value, alert_level, item_cost)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [randomUUID(), reportId, l.item_id,
         l.theoretical, l.physical, l.variance,
         l.variancePct, l.varianceVal, l.alert, l.cost]
      );
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      data: {
        id: reportId,
        report_number: reportNum,
        location_id,
        period_start,
        period_end,
        ok_count:       okCount,
        warning_count:  warnCount,
        critical_count: critCount,
        total_items:    lines.length,
        physical_source: physicalSource,   // 'count_session' | 'stock_take' | null (no real count → zero-variance)
        lines
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[inv-v11] variance/generate error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

/**
 * GET /api/v1/inventory/variance/:report_id
 * Fetch variance report detail
 */
router.get('/variance/:report_id', async (req, res) => {
  const { report_id } = req.params;

  try {
    const reportRes = await pool.query(`SELECT * FROM public.inv_variance_reports WHERE id = $1`, [report_id]);

    if (!reportRes.rows.length) {
      return res.status(404).json({ ok: false, error: 'Report not found' });
    }

    const report = reportRes.rows[0];

    // Get lines
    const linesRes = await pool.query(
      `SELECT vl.*, ii.name FROM public.inv_variance_lines vl
       JOIN public.inv_items ii ON vl.item_id = ii.id
       WHERE vl.variance_report_id = $1
       ORDER BY vl.alert_level DESC`,
      [report_id]
    );

    // Calculate total variance value
    const totalVarianceValue = linesRes.rows.reduce((sum, line) => sum + parseFloat(line.variance_value || 0), 0);

    res.json({
      ok: true,
      data: {
        ...report,
        total_variance_value: totalVarianceValue,
        lines: linesRes.rows
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/v1/inventory/items
 * Get inventory items with optional filtering and search
 */
router.get('/items', async (req, res) => {
  console.log('📦 Inventory items API called');
  try {
    const { category, search, limit = 1000 } = req.query;

    let query = `
      SELECT
        i.id, i.name, i.category, i.sub_category,
        COALESCE(i.sku, '') AS sku,
        COALESCE(i.barcode, '') AS barcode,
        i.base_uom_id,
        u.code AS base_uom_code,
        u.name AS base_uom_name,
        COALESCE(i.weighted_avg_cost, 0) AS weighted_avg_cost,
        COALESCE(i.last_cost_price, 0)   AS last_cost_price,
        COALESCE(i.average_cost, 0)      AS average_cost,
        i.default_wastage_pct,
        i.reorder_level, i.par_level,
        i.expiry_tracking,
        i.default_location_id,
        i.supplier_id,
        i.media_url, i.notes,
        i.is_active, i.inserted_at, i.updated_at
      FROM public.inv_items i
      LEFT JOIN public.inv_uom_definitions u ON i.base_uom_id = u.id
      WHERE i.is_active = true
    `;

    const params = [];
    const conditions = [];

    if (category && category !== 'all') {
      conditions.push(`i.category = $${params.length + 1}`);
      params.push(category);
    }

    if (search) {
      conditions.push(`(i.name ILIKE $${params.length + 1} OR i.id ILIKE $${params.length + 1} OR i.sku ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }

    query += ` ORDER BY i.name LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({
      ok: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Items fetch error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch items',
      message: error.message
    });
  }
});


// ============================================================================
// ITEM MASTER — create / update / delete
// ============================================================================

/** POST /api/v1/inventory/items  — create or upsert an item */
router.post('/items', async (req, res) => {
  const {
    id, name, category, sub_category, base_uom_id, sku, barcode,
    last_cost_price, selling_price, expiry_tracking, default_location_id, supplier_id,
    media_url, notes, par_level, reorder_level, default_wastage_pct
  } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });

   // Declared outside try so the catch block can reference them
   let generatedShortId;
   let client;
   try {
     // Generate a compliant short ID using our utility function
     // Fallback to the original method if needed, but ensure it's compliant
     if (!id) {
       // For new items, generate a compliant short ID
       generatedShortId = generateSecureShortId(10);
     } else {
       // For updates, use provided ID or generate from name if it matches pattern
       const potentialId = id || (await generateShortItemId(name));
       generatedShortId = potentialId.match(/^[A-Z0-9]{4}#[0-9]{3}$/) ? potentialId : generateSecureShortId(10);
     }
     
     // Validate the generated short ID
     const validation = validateShortId(generatedShortId);
     if (!validation.valid) {
       // Fallback to a safe default if validation fails
       generatedShortId = `ITEM${Date.now().toString(36).toUpperCase().substring(0, 6)}`;
       // Ensure it's still valid
       const fallbackValidation = validateShortId(generatedShortId);
       if (!fallbackValidation.valid) {
         generatedShortId = 'ITEM001'; // Last resort fallback
       }
     }

     // Auto-generate SKU if not provided
     const skuVal = sku || null;

     // itemId: use provided id for updates, generate a new UUID for creates
     const itemId = id || randomUUID();

     // Atomic: item upsert + POS products sync commit or roll back together,
     // so an item can never exist in inventory but be missing from the POS.
     client = await pool.connect();
     await client.query('BEGIN');

     const r = await client.query(`
       INSERT INTO public.inv_items
         (id, short_id, name, category, sub_category, base_uom_id, sku, barcode,
          last_cost_price, weighted_avg_cost, average_cost,
          expiry_tracking, default_location_id, supplier_id,
          media_url, notes, par_level, reorder_level, default_wastage_pct,
          is_active, inserted_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,true,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET
         short_id           = COALESCE(public.inv_items.short_id, EXCLUDED.short_id),
         name               = EXCLUDED.name,
         category           = EXCLUDED.category,
         sub_category       = EXCLUDED.sub_category,
         base_uom_id        = EXCLUDED.base_uom_id,
         sku                = COALESCE(EXCLUDED.sku, public.inv_items.sku),
         barcode            = EXCLUDED.barcode,
         last_cost_price    = EXCLUDED.last_cost_price,
         expiry_tracking    = EXCLUDED.expiry_tracking,
         default_location_id= EXCLUDED.default_location_id,
         supplier_id        = EXCLUDED.supplier_id,
         media_url          = EXCLUDED.media_url,
         notes              = EXCLUDED.notes,
         par_level          = EXCLUDED.par_level,
         reorder_level      = EXCLUDED.reorder_level,
         default_wastage_pct= EXCLUDED.default_wastage_pct,
         updated_at         = NOW()
       RETURNING *
     `, [itemId, generatedShortId, name, category||'Food', sub_category||null, base_uom_id||'uom_unit',
         skuVal, barcode||null, Number(last_cost_price||0),
         !!expiry_tracking, default_location_id||null, supplier_id||null,
         media_url||null, notes||null, Number(par_level||0), Number(reorder_level||0),
         Number(default_wastage_pct||0)]);

    const item = r.rows[0];

    // ── Sync to products table so item appears in POS ─────────────────────
    // category drives department; sub_category maps to products.category
    const isBeverage = String(category || '').toLowerCase().includes('beverage')
                    || String(category || '').toLowerCase().includes('bar')
                    || String(category || '').toLowerCase().includes('cellar');
    const dept       = isBeverage ? 'Bar' : 'Restaurant';
    const uomRes     = await client.query(`SELECT code FROM public.inv_uom_definitions WHERE id=$1`, [base_uom_id||'uom_unit']);
    const uomCode    = uomRes.rows[0]?.code || 'units';

    await client.query(`
      INSERT INTO public.products
        (id, name, category, department, price, cost_price, stock_level, unit,
         active, visibility, bar_visibility, restaurant_visibility,
         category_id, notes, picture_data, inserted_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,0,$7,true,'{}',false,false,$8,$9,$10,NOW(),NOW())
      ON CONFLICT (id) DO UPDATE SET
        name                 = EXCLUDED.name,
        department           = EXCLUDED.department,
        category             = EXCLUDED.category,
        price                = CASE WHEN EXCLUDED.price > 0 THEN EXCLUDED.price ELSE products.price END,
        cost_price           = EXCLUDED.cost_price,
        unit                 = EXCLUDED.unit,
        notes                = EXCLUDED.notes,
        picture_data         = EXCLUDED.picture_data,
        updated_at           = NOW()
    `, [item.id, name, sub_category || (isBeverage ? 'bar' : 'restaurant'), dept,
        Number(selling_price || 0), Number(last_cost_price || 0), uomCode,
        sub_category || null, notes || null, media_url || null]);

    await client.query('COMMIT');
    res.json({ ok: true, data: item });
   } catch (err) {
     if (client) await client.query('ROLLBACK').catch(() => {});
     // Handle specific constraint violations with our error handler
     const constraintError = handleShortIdConstraintViolation(err, {
       short_id: generatedShortId,
       name: name,
       category: category
     });
     
     if (constraintError) {
       // Return formatted error response for constraint violations
       const statusCode = constraintError.error === 'VALIDATION_ERROR' ? 400 : 
                         constraintError.error === 'CONFLICT' ? 409 : 500;
       return res.status(statusCode).json(constraintError);
     }
     
     // ── FK Constraint Guard: auto-seed UOMs and retry if missing ─────────────
     // Catches: "insert or update on table inv_items violates foreign key constraint
     //           inv_items_base_uom_id_fkey"
     // Root cause: inv_uom_definitions exists but is empty (bootstrap seeding failed)
     if (err.code === '23503' && err.message.includes('uom')) {
       console.warn('[inv-v11] UOM FK violation — auto-seeding UOM definitions and retrying...');
       try {
         const client = await pool.connect();
         await seedUomDefinitions(client);
         client.release();
         // Retry the request (will now find the UOM)
         return res.status(409).json({
           ok: false,
           error: 'UOM definitions were missing — they have been seeded automatically. Please try saving again.',
           retry: true,
           hint: 'The Unit of Measure table was empty. It has now been populated. Click Save again.'
         });
       } catch (seedErr) {
         console.error('[inv-v11] Auto-seed failed:', seedErr.message);
       }
     }
     
     // For unexpected errors, use our database error handler or fallback to generic
     console.error('[inv-v11] items POST error:', err.message);
     // Try to use our database error handler first
     try {
       // Create a mock req/res for the error handler
       const mockReq = { headers: {} };
       const mockRes = {
         status: function(code) {
           this.statusCode = code;
           return this;
         },
         json: function(data) {
           return res.status(this.statusCode || 500).json(data);
         }
       };
       databaseErrorHandler(err, mockReq, mockRes, () => {});
     } catch (handlerErr) {
       // Fallback to generic error if handler fails
       res.status(500).json({ ok: false, error: err.message });
     }
   } finally {
     if (client) client.release();
   }
});

/** PUT /api/v1/inventory/items/:id — full update (FIX: was broken router.handle pattern) */
router.put('/items/:id', async (req, res) => {
  // Merge ID into body and forward to POST upsert handler properly
  req.body = { ...req.body, id: req.params.id };
  // Re-invoke POST handler logic inline (router.handle is unreliable)
  const {
    id, name, category, sub_category, base_uom_id, sku, barcode,
    last_cost_price, selling_price, expiry_tracking, default_location_id, supplier_id,
    media_url, notes, par_level, reorder_level, default_wastage_pct
  } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
  try {
    const r = await pool.query(`
      UPDATE public.inv_items SET
        name               = $2,
        category           = $3,
        sub_category       = $4,
        base_uom_id        = $5,
        sku                = COALESCE($6, sku),
        barcode            = $7,
        last_cost_price    = $8,
        expiry_tracking    = $9,
        default_location_id= $10,
        supplier_id        = $11,
        media_url          = $12,
        notes              = $13,
        par_level          = $14,
        reorder_level      = $15,
        default_wastage_pct= $16,
        updated_at         = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, name, category||'Food', sub_category||null, base_uom_id||'uom_unit',
        sku||null, barcode||null, Number(last_cost_price||0),
        !!expiry_tracking, default_location_id||null, supplier_id||null,
        media_url||null, notes||null, Number(par_level||0), Number(reorder_level||0),
        Number(default_wastage_pct||0)]);

    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Item not found' });
    const item = r.rows[0];

    // Sync selling price and cost to products table
    const isBeverage = String(category||'').toLowerCase().includes('beverage') ||
                       String(category||'').toLowerCase().includes('bar');
    const dept = isBeverage ? 'Bar' : 'Restaurant';
    const uomRes = await pool.query(`SELECT code FROM public.inv_uom_definitions WHERE id=$1`, [base_uom_id||'uom_unit']);
    const uomCode = uomRes.rows[0]?.code || 'units';
    await pool.query(`
      UPDATE public.products SET
        name           = $2,
        department     = $3,
        category       = $4,
        price          = CASE WHEN $5 > 0 THEN $5 ELSE price END,
        cost_price     = $6,
        unit           = $7,
        notes          = $8,
        picture_data   = $9,
        updated_at     = NOW()
      WHERE id = $1
    `, [item.id, name, dept, sub_category||(isBeverage?'bar':'restaurant'),
        Number(selling_price||0), Number(last_cost_price||0), uomCode, notes||null, media_url||null]);

    res.json({ ok: true, data: item });
   } catch (err) {
     // Handle specific constraint violations with our error handler
     const constraintError = handleShortIdConstraintViolation(err, {
       short_id: null, // PUT doesn't modify short_id, but check if there's an existing issue
       name: name,
       category: category
     });
     
     if (constraintError) {
       // Return formatted error response for constraint violations
       const statusCode = constraintError.error === 'VALIDATION_ERROR' ? 400 : 
                         constraintError.error === 'CONFLICT' ? 409 : 500;
       return res.status(statusCode).json(constraintError);
     }
     
     // Same FK guard as POST — auto-seed if UOM missing
     if (err.code === '23503' && err.message.includes('uom')) {
       const c = await pool.connect();
       await seedUomDefinitions(c).catch(() => {});
       c.release();
       return res.status(409).json({
         ok: false, error: 'UOM definitions were missing — now seeded. Please retry.',
         retry: true
       });
     }
     res.status(500).json({ ok: false, error: err.message });
   }
});

/** DELETE /api/v1/inventory/items/:id — soft-delete (FIX: also deactivates in products table) */
router.delete('/items/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Soft-delete in inv_items
    const r = await client.query(
      `UPDATE public.inv_items SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING id, name`,
      [req.params.id]
    );
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'Item not found' }); }
    // FIX: Also deactivate in products so item disappears from POS menu
    await client.query(`UPDATE public.products SET active=false, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true, message: `${r.rows[0].name} deactivated from inventory and POS` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

// ============================================================================
// LOCATIONS — Full CRUD
// ============================================================================
router.get('/locations', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, location_type, parent_location_id, description, is_active
       FROM public.inv_locations WHERE is_active=true ORDER BY location_type, name`
    );
    res.json({ ok: true, data: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** POST /api/v1/inventory/locations — create new location */
router.post('/locations', async (req, res) => {
  const { name, location_type, parent_location_id, description } = req.body;
  if (!name || !location_type) return res.status(400).json({ ok: false, error: 'name and location_type required' });
  if (!['Storage','Outlet'].includes(location_type)) return res.status(400).json({ ok: false, error: 'location_type must be Storage or Outlet' });
  try {
    // Generate a clean ID from name
    const id = 'loc_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g,'_').slice(0,30) + '_' + Date.now().toString(36);
    const r = await pool.query(
      `INSERT INTO public.inv_locations (id, name, location_type, parent_location_id, description, is_active, inserted_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,true,NOW(),NOW()) RETURNING *`,
      [id, name, location_type, parent_location_id||null, description||null]
    );
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** PUT /api/v1/inventory/locations/:id — update location name/description */
router.put('/locations/:id', async (req, res) => {
  const { name, description, parent_location_id } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  try {
    const r = await pool.query(
      `UPDATE public.inv_locations SET name=$2, description=$3, parent_location_id=$4, updated_at=NOW() WHERE id=$1 AND is_active=true RETURNING *`,
      [req.params.id, name, description||null, parent_location_id||null]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Location not found' });
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** DELETE /api/v1/inventory/locations/:id — soft-delete with balance guard */
router.delete('/locations/:id', async (req, res) => {
  try {
    // Guard: block deletion if location has active stock
    const balCheck = await pool.query(
      `SELECT COALESCE(SUM(quantity_change),0) as total_balance FROM public.inv_stock_ledger WHERE location_id=$1`,
      [req.params.id]
    );
    const totalBalance = Number(balCheck.rows[0]?.total_balance || 0);
    if (totalBalance > 0) {
      return res.status(409).json({
        ok: false,
        error: `Cannot delete location with active stock (balance: ${totalBalance.toFixed(3)}). Transfer all stock out first.`
      });
    }
    // Guard: block if there are open GRNs or transfers referencing this location
    const openGrn = await pool.query(
      `SELECT COUNT(*) as cnt FROM public.inv_grn_headers WHERE destination_location_id=$1 AND status='draft'`,
      [req.params.id]
    );
    if (Number(openGrn.rows[0]?.cnt) > 0) {
      return res.status(409).json({ ok: false, error: 'Cannot delete location with open (draft) GRNs' });
    }
    await pool.query(`UPDATE public.inv_locations SET is_active=false, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, message: 'Location deactivated' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ============================================================================
// UOM DEFINITIONS — Full CRUD
// ============================================================================
router.get('/uom', async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, code, name, category, description FROM public.inv_uom_definitions ORDER BY category, name`);
    res.json({ ok: true, data: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** POST /api/v1/inventory/uom — create new UOM */
router.post('/uom', async (req, res) => {
  const { code, name, category, description } = req.body;
  if (!code || !name) return res.status(400).json({ ok: false, error: 'code and name required' });
  if (!['Count','Volume','Weight'].includes(category||'Count')) {
    return res.status(400).json({ ok: false, error: 'category must be Count, Volume or Weight' });
  }
  try {
    const id = 'uom_' + code.toLowerCase().replace(/[^a-z0-9]/g,'_');
    const r = await pool.query(
      `INSERT INTO public.inv_uom_definitions (id, code, name, category, description, inserted_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, description=EXCLUDED.description
       RETURNING *`,
      [id, code.toUpperCase(), name, category||'Count', description||null]
    );
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** PUT /api/v1/inventory/uom/:id — update UOM name/description (code is immutable) */
router.put('/uom/:id', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  try {
    const r = await pool.query(
      `UPDATE public.inv_uom_definitions SET name=$2, description=$3 WHERE id=$1 RETURNING *`,
      [req.params.id, name, description||null]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'UOM not found' });
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** DELETE /api/v1/inventory/uom/:id — block if items or conversions use this UOM */
router.delete('/uom/:id', async (req, res) => {
  try {
    // Guard: UOM in use by items
    const inUse = await pool.query(
      `SELECT COUNT(*) as cnt FROM public.inv_items WHERE base_uom_id=$1 AND is_active=true`,
      [req.params.id]
    );
    if (Number(inUse.rows[0]?.cnt) > 0) {
      return res.status(409).json({ ok: false, error: `UOM is assigned to ${inUse.rows[0].cnt} active items. Reassign items first.` });
    }
    // Guard: UOM in use by conversions
    const convInUse = await pool.query(
      `SELECT COUNT(*) as cnt FROM public.inv_uom_conversions WHERE from_uom_id=$1 OR to_uom_id=$1`,
      [req.params.id]
    );
    if (Number(convInUse.rows[0]?.cnt) > 0) {
      return res.status(409).json({ ok: false, error: `UOM is used in ${convInUse.rows[0].cnt} conversion rules. Remove conversions first.` });
    }
    await pool.query(`DELETE FROM public.inv_uom_definitions WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, message: 'UOM deleted' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ============================================================================
// PHYSICAL COUNT (for variance reports)
// ============================================================================

/** POST /api/v1/inventory/physical-count — open a new physical count session */
router.post('/physical-count', async (req, res) => {
  const { location_id, count_date, counted_by } = req.body;
  if (!location_id) return res.status(400).json({ ok: false, error: 'location_id required' });
  try {
    const r = await pool.query(
      `INSERT INTO public.inv_physical_counts (id, location_id, count_date, status, counted_by, inserted_at, updated_at)
       VALUES ($1,$2,$3,'draft',$4,NOW(),NOW()) RETURNING *`,
      [randomUUID(), location_id, count_date || new Date().toISOString().slice(0,10), counted_by||'system']
    );
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** GET /api/v1/inventory/physical-count — list counts */
router.get('/physical-count', async (req, res) => {
  const { location_id, status } = req.query;
  try {
    let sql = `SELECT pc.*, l.name AS location_name FROM public.inv_physical_counts pc
               LEFT JOIN public.inv_locations l ON l.id = pc.location_id WHERE 1=1`;
    const params = [];
    if (location_id) { sql += ` AND pc.location_id=$${++params.length}`; params.push(location_id); }
    if (status)      { sql += ` AND pc.status=$${++params.length}`;      params.push(status); }
    sql += ' ORDER BY pc.inserted_at DESC LIMIT 50';
    const r = await pool.query(sql, params);
    res.json({ ok: true, data: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** POST /api/v1/inventory/physical-count/:id/lines — save count lines */
router.post('/physical-count/:id/lines', async (req, res) => {
  const { id } = req.params;
  const { lines } = req.body; // [{item_id, physical_qty, uom_id, notes}]
  if (!Array.isArray(lines)) return res.status(400).json({ ok: false, error: 'lines[] required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM public.inv_physical_count_lines WHERE count_id=$1`, [id]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO public.inv_physical_count_lines (id, count_id, item_id, physical_qty, uom_id, notes, inserted_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [randomUUID(), id, l.item_id, Number(l.physical_qty||0), l.uom_id||null, l.notes||null]
      );
    }
    await client.query(`UPDATE public.inv_physical_counts SET status='submitted', updated_at=NOW() WHERE id=$1`, [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

// (Duplicate variance/generate handler removed — see definitive handler above)

// ============================================================================
// STOCK BALANCE with location name (enhanced)
// ============================================================================
router.get('/stock-summary', async (req, res) => {
  const { location_id } = req.query;
  try {
    let sql = `
      SELECT
        sl.item_id,
        i.name, i.category, i.sku,
        COALESCE(i.weighted_avg_cost,0) AS unit_cost,
        SUM(CASE WHEN sl.ledger_type IN ('GRN','TRANSFER_IN','ADJUSTMENT_IN') THEN sl.quantity_change
                 ELSE -sl.quantity_change END) AS qty_on_hand,
        u.code AS uom,
        l.name AS location_name
      FROM public.inv_stock_ledger sl
      JOIN public.inv_items i ON i.id = sl.item_id
      JOIN public.inv_locations l ON l.id = sl.location_id
      LEFT JOIN public.inv_uom_definitions u ON u.id = i.base_uom_id
      WHERE i.is_active = true`;
    const params = [];
    if (location_id) { sql += ` AND sl.location_id=$1`; params.push(location_id); }
    sql += ` GROUP BY sl.item_id,i.name,i.category,i.sku,i.weighted_avg_cost,u.code,l.name
             HAVING SUM(CASE WHEN sl.ledger_type IN ('GRN','TRANSFER_IN','ADJUSTMENT_IN') THEN sl.quantity_change ELSE -sl.quantity_change END) > 0
             ORDER BY l.name, i.category, i.name`;
    const r = await pool.query(sql, params);
    res.json({ ok: true, data: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ============================================================================
// SALE DEPLETION — Called from POS on bill close (background, never blocks POS)
// ============================================================================

/**
 * POST /api/v1/inventory/sale-depletion
 *
 * Posts SALE_DEPLETION entries to inv_stock_ledger for each sold item.
 * Uses recipe lookup: if a recipe exists for the menu item, deducts INGREDIENTS;
 * if not, deducts the menu item directly.
 *
 * DESIGN PRINCIPLES:
 * - ALWAYS returns 200 OK (even on failure) so POS never sees an error
 * - Uses ON CONFLICT DO NOTHING for idempotency (safe to call twice)
 * - Never throws — all errors are caught and logged only
 * - Uses a single DB transaction per bill for atomicity
 *
 * @body { bill_id, shift_id, location_id, outlet, items: [{item_id, qty}] }
 */
router.post('/sale-depletion', async (req, res) => {
  // Always return 200 — POS must never see inventory errors
  const { bill_id, shift_id, location_id, outlet, items } = req.body;

  if (!bill_id || !Array.isArray(items) || items.length === 0) {
    return res.json({ ok: true, skipped: true, reason: 'No items or bill_id' });
  }

  const client = await pool.connect();

  // ── Resolve the depletion location from the OUTLET NAME ──────────────────
  // The POS client sends a hardcoded location guess (e.g. every "*bar*" → loc_bar1),
  // which depleted the wrong outlet. Resolve by matching the outlet name to an
  // active inv_locations row so each outlet (Pool bar, Main Bar, …) depletes its
  // OWN stock. Fall back to the passed location_id, then loc_restaurant.
  let locId = location_id || 'loc_restaurant';
  if (outlet) {
    try {
      const m = await client.query(
        `SELECT id FROM public.inv_locations
         WHERE LOWER(name) = LOWER($1) AND is_active IS DISTINCT FROM false
         ORDER BY (location_type = 'Outlet') DESC LIMIT 1`,
        [String(outlet).trim()]
      );
      if (m.rows.length) locId = m.rows[0].id;
    } catch { /* fall back to passed location_id */ }
  }

  try {
    await client.query('BEGIN');

    let totalDeductions = 0;

    for (const sold of items) {
      const { item_id, qty } = sold;
      if (!item_id || !qty || Number(qty) <= 0) continue;

      // ── Look up current recipe for this menu item ─────────────────────────
      // FIX: use actual column names from inv_recipe_lines
      // columns: qty_required, prep_uom_id, wastage_pct (NOT quantity_required/uom_id/wastage_override)
      const recipeRes = await client.query(
        `SELECT rl.item_id AS ingredient_id, rl.qty_required, rl.prep_uom_id AS uom_id,
                rl.wastage_pct, ii.base_uom_id, ii.weighted_avg_cost
         FROM public.inv_recipes r
         JOIN public.inv_recipe_lines rl ON rl.recipe_id = r.id
         JOIN public.inv_items ii ON ii.id = rl.item_id
         WHERE r.menu_item_id = $1 AND r.is_current = true AND ii.is_active = true`,
        [item_id]
      );

      if (recipeRes.rows.length > 0) {
        // ── Recipe-based depletion: deduct each ingredient ──────────────────
        for (const ingredient of recipeRes.rows) {
          const wasteFactor = 1 + (Number(ingredient.wastage_pct || 0) / 100);
          const depletQty   = Number(ingredient.qty_required) * Number(qty) * wasteFactor;
          const refNum      = `SALE-${bill_id}-${item_id}-${ingredient.ingredient_id}`;

          // Idempotency: only insert if reference doesn't already exist (safe for retries)
          const alreadyPosted = await client.query(
            `SELECT 1 FROM public.inv_stock_ledger WHERE reference_number=$1 AND ledger_type='SALE_DEPLETION' LIMIT 1`,
            [refNum]
          );
          if (!alreadyPosted.rows.length) {
            await client.query(
              `INSERT INTO public.inv_stock_ledger
                 (id, item_id, location_id, ledger_type, reference_number, quantity_change,
                  base_uom_id, cost_per_unit, total_cost, posted_by, inserted_at)
               VALUES ($1,$2,$3,'SALE_DEPLETION',$4,$5,$6,$7,$8,'POS_SYSTEM',NOW())`,
              [
                randomUUID(),
                ingredient.ingredient_id,
                locId,
                refNum,
                -Math.abs(depletQty),
                ingredient.uom_id || ingredient.base_uom_id,
                Number(ingredient.weighted_avg_cost || 0),
                Number(ingredient.weighted_avg_cost || 0) * depletQty
              ]
            );
            totalDeductions++;
          }
        }
      } else {
        // ── Direct depletion: no recipe, deduct menu item itself ─────────────
        // Only if item exists in inv_items
        const itemCheck = await client.query(
          `SELECT i.base_uom_id, i.weighted_avg_cost
           FROM public.inv_items i WHERE i.id = $1 AND i.is_active = true`,
          [item_id]
        );

        if (itemCheck.rows.length > 0) {
          const item    = itemCheck.rows[0];
          const refNum  = `SALE-${bill_id}-${item_id}`;

          const alreadyPostedDirect = await client.query(
            `SELECT 1 FROM public.inv_stock_ledger WHERE reference_number=$1 AND ledger_type='SALE_DEPLETION' LIMIT 1`,
            [refNum]
          );
          if (!alreadyPostedDirect.rows.length) {
          await client.query(
            `INSERT INTO public.inv_stock_ledger
               (id, item_id, location_id, ledger_type, reference_number, quantity_change,
                base_uom_id, cost_per_unit, total_cost, posted_by, inserted_at)
             VALUES ($1,$2,$3,'SALE_DEPLETION',$4,$5,$6,$7,$8,'POS_SYSTEM',NOW())`,
            [
              randomUUID(),
              item_id,
              locId,
              refNum,
              -Math.abs(Number(qty)),
              item.base_uom_id || 'uom_unit',
              Number(item.weighted_avg_cost || 0),
              Number(item.weighted_avg_cost || 0) * Number(qty)
            ]
          );
          totalDeductions++;
          } // end idempotency check
        }
        // If item doesn't exist in inv_items, silently skip (POS item not in inventory)
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, bill_id, deductions: totalDeductions });

  } catch (err) {
    // Always rollback + respond OK — POS must not fail due to inventory issues
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('[Inventory] sale-depletion background error (non-fatal):', err?.message || err);
    res.json({ ok: true, skipped: true, reason: 'Background inventory error — POS unaffected' });
  } finally {
    client.release();
  }
});

// ============================================================================
// STOCK-SUMMARY with balance check
// ============================================================================
router.get('/balance-check/:item_id', async (req, res) => {
  const { item_id } = req.params;
  const { location_id } = req.query;
  try {
    let sql = `SELECT sl.location_id, l.name as location_name,
               COALESCE(SUM(sl.quantity_change),0) as balance,
               i.base_uom_id, u.code as uom_code
               FROM public.inv_stock_ledger sl
               JOIN public.inv_items i ON i.id = sl.item_id
               JOIN public.inv_locations l ON l.id = sl.location_id
               LEFT JOIN public.inv_uom_definitions u ON u.id = i.base_uom_id
               WHERE sl.item_id = $1`;
    const params = [item_id];
    if (location_id) { sql += ` AND sl.location_id = $2`; params.push(location_id); }
    sql += ` GROUP BY sl.location_id, l.name, i.base_uom_id, u.code HAVING SUM(sl.quantity_change) != 0`;
    const r = await pool.query(sql, params);
    res.json({ ok: true, data: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ============================================================================
// INVENTORY PERIODS
// ============================================================================

/**
 * POST /api/v1/inventory/close-period
 * Record physical counts, calculate variance vs theoretical, lock period, post GL batch for variance.
 *
 * Body: { location_id, period_start, period_end, closed_by, counts: [{item_id, physical_qty, unit_cost}] }
 * Response: { ok, report_id, variance_lines, gl_batch_id, locked_period_id }
 */
router.post('/close-period', async (req, res) => {
  const { location_id, period_start, period_end, closed_by, counts } = req.body || {};
  if (!location_id || !period_start || !period_end || !Array.isArray(counts) || counts.length === 0)
    return res.status(400).json({ ok: false, error: 'location_id, period_start, period_end, counts[] required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Check for existing locked period
    const lockCheck = await client.query(
      `SELECT id, status FROM inventory_periods
       WHERE location_id = $1
         AND start_date <= $2::date
         AND end_date >= $3::date
       LIMIT 1`,
      [location_id, period_end, period_start]
    );
    if (lockCheck.rows.length && lockCheck.rows[0].status === 'locked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Period already locked — back-dated changes are blocked' });
    }
    const existingPeriodId = lockCheck.rows[0]?.id || null;

    // 2. Generate variance report number
    const countRes = await client.query(`SELECT COUNT(*) FROM inv_variance_reports`);
    const reportNumber = `VAR-${String(Number(countRes.rows[0].count) + 1).padStart(5, '0')}`;

    // 3. Insert variance report header
    const reportInsert = await client.query(
      `INSERT INTO inv_variance_reports (report_number, location_id, period_start, period_end, created_by)
       VALUES ($1, $2, $3::date, $4::date, $5)
       RETURNING id`,
      [reportNumber, location_id, period_start, period_end, closed_by || 'system']
    );
    const reportId = reportInsert.rows[0].id;

    // 4. Per item: calculate theoretical balance, insert variance lines
    let totalVarianceValue = 0;
    let linesInserted = 0;

    for (const count of counts) {
      const { item_id, physical_qty, unit_cost = 0 } = count;
      if (!item_id || physical_qty == null) continue;

      const theoreticalRes = await client.query(
        `SELECT COALESCE(SUM(quantity_change), 0)::numeric AS theoretical
         FROM inv_stock_ledger
         WHERE item_id = $1
           AND location_id = $2
           AND inserted_at <= $3::date + interval '1 day'`,
        [item_id, location_id, period_end]
      );
      const theoretical = Number(theoreticalRes.rows[0]?.theoretical || 0);
      const variance_qty = Number(physical_qty) - theoretical;
      const variance_value = variance_qty * Number(unit_cost || 0);
      totalVarianceValue += variance_value;

      await client.query(
        `INSERT INTO inv_variance_lines (report_id, item_id, physical_qty, theoretical_qty, variance_qty, unit_cost, variance_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [reportId, item_id, physical_qty, theoretical, variance_qty, unit_cost, variance_value]
      );
      linesInserted++;
    }

    // 5. GL pending batch for variance (only if non-zero)
    let glBatchId = null;
    const absVariance = Math.abs(totalVarianceValue);
    if (absVariance > 0.005) {
      const debitAcct  = totalVarianceValue < 0 ? '5100' : '1400';
      const creditAcct = totalVarianceValue < 0 ? '1400' : '5100';
      const batchRes = await client.query(
        `INSERT INTO gl_pending_batches (origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount)
         VALUES ('inv_variance_reports', $1, $2, $3, $4, $5)
         ON CONFLICT (origin_table, origin_id) DO NOTHING
         RETURNING id`,
        [reportId, `Stock variance ${reportNumber}`, debitAcct, creditAcct, absVariance]
      );
      glBatchId = batchRes.rows[0]?.id || null;
    }

    // 6. Lock or create inventory period
    let lockedPeriodId = existingPeriodId;
    if (existingPeriodId) {
      await client.query(
        `UPDATE inventory_periods SET status='locked', locked_at=NOW(), locked_by=$1 WHERE id=$2`,
        [closed_by || 'system', existingPeriodId]
      );
    } else {
      const periodInsert = await client.query(
        `INSERT INTO inventory_periods (location_id, start_date, end_date, status, locked_at, locked_by)
         VALUES ($1, $2::date, $3::date, 'locked', NOW(), $4)
         RETURNING id`,
        [location_id, period_start, period_end, closed_by || 'system']
      );
      lockedPeriodId = periodInsert.rows[0].id;
    }

    await client.query('COMMIT');
    res.json({ ok: true, report_id: reportId, variance_lines: linesInserted, gl_batch_id: glBatchId, locked_period_id: lockedPeriodId });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/inventory/periods
 * List all inventory periods with lock status
 */
router.get('/periods', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, location_id, start_date::text, end_date::text, status,
              locked_at, locked_by
       FROM inventory_periods
       ORDER BY start_date DESC`
    );
    res.json({ ok: true, rows: r.rows || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================================
// STOCK TAKE
// ============================================================================

/**
 * POST /api/v1/inventory/stock-take/generate
 * Body: { location_id, period_start, period_end, created_by? }
 * Idempotent: returns existing draft if one exists. 409 if already locked.
 */
router.post('/stock-take/generate', async (req, res) => {
  const { location_id, period_start, period_end, created_by } = req.body || {};
  if (!location_id || !period_start || !period_end)
    return res.status(400).json({ ok: false, error: 'location_id, period_start, period_end required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotent: return existing sheet if present
    const existing = await client.query(
      `SELECT id, status FROM public.inv_stock_take_sheets
       WHERE location_id = $1 AND period_start = $2::date AND period_end = $3::date`,
      [location_id, period_start, period_end]
    );
    if (existing.rows.length) {
      if (existing.rows[0].status === 'locked') {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'Period already locked' });
      }
      const existingLines = await client.query(
        `SELECT stl.*, i.name AS item_name FROM public.inv_stock_take_lines stl
         JOIN public.inv_items i ON i.id = stl.item_id
         WHERE stl.sheet_id = $1 ORDER BY i.name`,
        [existing.rows[0].id]
      );
      // Only short-circuit if the draft already has lines (preserves entered counts).
      // An EMPTY draft means it was generated before stock arrived at this location —
      // delete it and regenerate so newly-stocked items appear (fixes the disparity
      // where a transferred-in item didn't show on the stock-take sheet).
      if (existingLines.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.json({ ok: true, sheet: existing.rows[0], lines: existingLines.rows });
      }
      await client.query(`DELETE FROM public.inv_stock_take_sheets WHERE id = $1`, [existing.rows[0].id]);
    }

    // Create sheet header
    const sheetRes = await client.query(
      `INSERT INTO public.inv_stock_take_sheets (location_id, period_start, period_end, created_by)
       VALUES ($1, $2::date, $3::date, $4) RETURNING *`,
      [location_id, period_start, period_end, created_by || 'system']
    );
    const sheet = sheetRes.rows[0];

    // Get all items that have ANY ledger activity at this location up to period_end,
    // with in-period aggregations computed in one query.
    const itemsRes = await client.query(`
      SELECT
        sl.item_id,
        MAX(i.name) AS item_name,
        COALESCE(SUM(CASE WHEN sl.ledger_type = 'GRN'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END), 0) AS purchases_qty,
        COALESCE(SUM(CASE WHEN sl.ledger_type = 'TRANSFER_IN'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END), 0) AS transfers_in_qty,
        COALESCE(ABS(SUM(CASE WHEN sl.ledger_type = 'TRANSFER_OUT'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END)), 0) AS transfers_out_qty,
        COALESCE(ABS(SUM(CASE WHEN sl.ledger_type = 'SALE_DEPLETION'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END)), 0) AS theoretical_sales_qty,
        (SELECT COALESCE(cost_per_unit, 0)
         FROM public.inv_stock_ledger
         WHERE item_id = sl.item_id AND cost_per_unit IS NOT NULL
         ORDER BY inserted_at DESC LIMIT 1) AS unit_cost
      FROM public.inv_stock_ledger sl
      JOIN public.inv_items i ON i.id = sl.item_id
      WHERE sl.location_id = $1
        AND sl.inserted_at < $3::date + interval '1 day'
      GROUP BY sl.item_id
    `, [location_id, period_start, period_end]);

    const lines = [];
    for (const item of itemsRes.rows) {
      // Opening: physical_qty from the most recent locked sheet for this location+item
      const openingRes = await client.query(`
        SELECT stl.physical_qty
        FROM public.inv_stock_take_lines stl
        JOIN public.inv_stock_take_sheets sts ON sts.id = stl.sheet_id
        WHERE stl.item_id = $1
          AND sts.location_id = $2
          AND sts.status = 'locked'
          AND sts.period_end < $3::date
        ORDER BY sts.period_end DESC
        LIMIT 1
      `, [item.item_id, location_id, period_start]);

      let opening_qty;
      if (openingRes.rows.length) {
        opening_qty = Number(openingRes.rows[0].physical_qty);
      } else {
        // Fallback: cumulative ledger balance before period_start
        const cumRes = await client.query(`
          SELECT COALESCE(SUM(quantity_change), 0) AS balance
          FROM public.inv_stock_ledger
          WHERE item_id = $1 AND location_id = $2 AND inserted_at < $3::date
        `, [item.item_id, location_id, period_start]);
        opening_qty = Number(cumRes.rows[0].balance);
      }

      const lineRes = await client.query(`
        INSERT INTO public.inv_stock_take_lines
          (sheet_id, item_id, item_name, opening_qty, purchases_qty, transfers_in_qty,
           transfers_out_qty, theoretical_sales_qty, unit_cost)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        sheet.id, item.item_id, item.item_name, opening_qty,
        item.purchases_qty, item.transfers_in_qty,
        item.transfers_out_qty, item.theoretical_sales_qty,
        item.unit_cost || 0
      ]);
      lines.push(lineRes.rows[0]);
    }

    await client.query('COMMIT');
    res.json({ ok: true, sheet, lines });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/inventory/stock-take/:sheetId/refresh
 * Re-pulls the THEORETICAL columns (opening, purchases, transfers, sales, cost)
 * from the live ledger — for when transactions are corrected AFTER the sheet was
 * generated. Keeps the sheet and every entered physical count untouched, and
 * appends lines for items that gained ledger activity since generation.
 * Only draft sheets can be refreshed.
 */
router.post('/stock-take/:sheetId/refresh', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sheetRes = await client.query(
      `SELECT * FROM public.inv_stock_take_sheets WHERE id = $1 FOR UPDATE`,
      [req.params.sheetId]
    );
    const sheet = sheetRes.rows[0];
    if (!sheet) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'Sheet not found' }); }
    if (sheet.status === 'locked') { await client.query('ROLLBACK'); return res.status(409).json({ ok: false, error: 'Sheet is locked — reopen it before refreshing' }); }

    const { location_id, period_start, period_end } = sheet;

    // Same in-period aggregation the generator uses, from the CURRENT ledger.
    const itemsRes = await client.query(`
      SELECT
        sl.item_id,
        MAX(i.name) AS item_name,
        COALESCE(SUM(CASE WHEN sl.ledger_type = 'GRN'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END), 0) AS purchases_qty,
        COALESCE(SUM(CASE WHEN sl.ledger_type = 'TRANSFER_IN'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END), 0) AS transfers_in_qty,
        COALESCE(ABS(SUM(CASE WHEN sl.ledger_type = 'TRANSFER_OUT'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END)), 0) AS transfers_out_qty,
        COALESCE(ABS(SUM(CASE WHEN sl.ledger_type = 'SALE_DEPLETION'
          AND sl.inserted_at >= $2::date THEN sl.quantity_change END)), 0) AS theoretical_sales_qty,
        (SELECT COALESCE(cost_per_unit, 0)
         FROM public.inv_stock_ledger
         WHERE item_id = sl.item_id AND cost_per_unit IS NOT NULL
         ORDER BY inserted_at DESC LIMIT 1) AS unit_cost
      FROM public.inv_stock_ledger sl
      JOIN public.inv_items i ON i.id = sl.item_id
      WHERE sl.location_id = $1
        AND sl.inserted_at < $3::date + interval '1 day'
      GROUP BY sl.item_id
    `, [location_id, period_start, period_end]);

    const existingRes = await client.query(
      `SELECT id, item_id FROM public.inv_stock_take_lines WHERE sheet_id = $1`,
      [sheet.id]
    );
    const existingByItem = new Map(existingRes.rows.map(r => [r.item_id, r.id]));

    let updated = 0, added = 0;
    for (const item of itemsRes.rows) {
      // Opening: most recent LOCKED sheet count, else cumulative ledger before start
      const openingRes = await client.query(`
        SELECT stl.physical_qty
        FROM public.inv_stock_take_lines stl
        JOIN public.inv_stock_take_sheets sts ON sts.id = stl.sheet_id
        WHERE stl.item_id = $1 AND sts.location_id = $2
          AND sts.status = 'locked' AND sts.period_end < $3::date
        ORDER BY sts.period_end DESC LIMIT 1
      `, [item.item_id, location_id, period_start]);
      let opening_qty;
      if (openingRes.rows.length) {
        opening_qty = Number(openingRes.rows[0].physical_qty);
      } else {
        const cumRes = await client.query(`
          SELECT COALESCE(SUM(quantity_change), 0) AS balance
          FROM public.inv_stock_ledger
          WHERE item_id = $1 AND location_id = $2 AND inserted_at < $3::date
        `, [item.item_id, location_id, period_start]);
        opening_qty = Number(cumRes.rows[0].balance);
      }

      const lineId = existingByItem.get(item.item_id);
      if (lineId) {
        // Refresh theoretical columns; physical_qty (entered count) is preserved.
        await client.query(`
          UPDATE public.inv_stock_take_lines
          SET opening_qty=$1, purchases_qty=$2, transfers_in_qty=$3,
              transfers_out_qty=$4, theoretical_sales_qty=$5, unit_cost=$6
          WHERE id=$7
        `, [opening_qty, item.purchases_qty, item.transfers_in_qty,
            item.transfers_out_qty, item.theoretical_sales_qty, item.unit_cost || 0, lineId]);
        updated++;
      } else {
        await client.query(`
          INSERT INTO public.inv_stock_take_lines
            (sheet_id, item_id, item_name, opening_qty, purchases_qty, transfers_in_qty,
             transfers_out_qty, theoretical_sales_qty, unit_cost)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [sheet.id, item.item_id, item.item_name, opening_qty,
            item.purchases_qty, item.transfers_in_qty,
            item.transfers_out_qty, item.theoretical_sales_qty, item.unit_cost || 0]);
        added++;
      }
    }

    const linesRes = await client.query(
      `SELECT stl.*, i.name AS item_name FROM public.inv_stock_take_lines stl
       JOIN public.inv_items i ON i.id = stl.item_id
       WHERE stl.sheet_id = $1 ORDER BY i.name`,
      [sheet.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, sheet, lines: linesRes.rows, refreshed: updated, added });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/inventory/stock-take/:sheetId
 * Returns sheet header + all lines with computed variance_qty.
 */
router.get('/stock-take/:sheetId', async (req, res) => {
  try {
    const sheetRes = await pool.query(
      `SELECT * FROM public.inv_stock_take_sheets WHERE id = $1`,
      [req.params.sheetId]
    );
    if (!sheetRes.rows.length)
      return res.status(404).json({ ok: false, error: 'Sheet not found' });

    const linesRes = await pool.query(`
      SELECT stl.*,
        COALESCE(stl.item_name, i.name) AS item_name,
        CASE WHEN stl.physical_qty IS NOT NULL THEN
          stl.physical_qty - (stl.opening_qty + stl.purchases_qty + stl.transfers_in_qty
            - stl.transfers_out_qty - stl.theoretical_sales_qty - stl.adjustments_qty)
        END AS variance_qty
      FROM public.inv_stock_take_lines stl
      JOIN public.inv_items i ON i.id = stl.item_id
      WHERE stl.sheet_id = $1
      ORDER BY COALESCE(stl.item_name, i.name)
    `, [req.params.sheetId]);

    res.json({ ok: true, sheet: sheetRes.rows[0], lines: linesRes.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /api/v1/inventory/stock-take/lines/:lineId
 * Body: { physical_qty }
 * Updates physical count on a single line. Rejects if sheet is locked.
 */
router.patch('/stock-take/lines/:lineId', async (req, res) => {
  const { physical_qty } = req.body || {};
  if (physical_qty == null)
    return res.status(400).json({ ok: false, error: 'physical_qty required' });
  try {
    const checkRes = await pool.query(
      `SELECT sts.status FROM public.inv_stock_take_sheets sts
       JOIN public.inv_stock_take_lines stl ON stl.sheet_id = sts.id
       WHERE stl.id = $1`,
      [req.params.lineId]
    );
    if (!checkRes.rows.length)
      return res.status(404).json({ ok: false, error: 'Line not found' });
    if (checkRes.rows[0].status === 'locked')
      return res.status(409).json({ ok: false, error: 'Sheet is locked' });

    const r = await pool.query(
      `UPDATE public.inv_stock_take_lines SET physical_qty = $1 WHERE id = $2
       RETURNING *,
         physical_qty - (opening_qty + purchases_qty + transfers_in_qty
           - transfers_out_qty - theoretical_sales_qty - adjustments_qty) AS variance_qty`,
      [physical_qty, req.params.lineId]
    );
    res.json({ ok: true, line: r.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/inventory/stock-take/:sheetId/adjust
 * Body: { item_id, qty, reason?, adjusted_by? }
 * Writes a WASTE entry to inv_stock_ledger and increments adjustments_qty on the line.
 */
router.post('/stock-take/:sheetId/adjust', async (req, res) => {
  const { item_id, qty, reason, adjusted_by } = req.body || {};
  if (!item_id || qty == null)
    return res.status(400).json({ ok: false, error: 'item_id and qty required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sheetRes = await client.query(
      `SELECT * FROM public.inv_stock_take_sheets WHERE id = $1`,
      [req.params.sheetId]
    );
    if (!sheetRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Sheet not found' });
    }
    if (sheetRes.rows[0].status === 'locked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Sheet is locked' });
    }
    const sheet = sheetRes.rows[0];

    // Write WASTE ledger entry (negative quantity_change = stock out)
    const ledgerId = `waste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await client.query(
      `INSERT INTO public.inv_stock_ledger
         (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
       VALUES ($1, $2, $3, 'WASTE', $4, $5, 'uom_unit', $6)`,
      [ledgerId, item_id, sheet.location_id,
       `STOCKTAKE-ADJ-${req.params.sheetId}`, -Math.abs(Number(qty)),
       adjusted_by || 'system']
    );

    // Increment adjustments_qty on the line
    const lineRes = await client.query(
      `UPDATE public.inv_stock_take_lines
       SET adjustments_qty = adjustments_qty + $1
       WHERE sheet_id = $2 AND item_id = $3
       RETURNING *,
         CASE WHEN physical_qty IS NOT NULL THEN
           physical_qty - (opening_qty + purchases_qty + transfers_in_qty
             - transfers_out_qty - theoretical_sales_qty - adjustments_qty)
         END AS variance_qty`,
      [Math.abs(Number(qty)), req.params.sheetId, item_id]
    );
    if (!lineRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Line not found for item' });
    }

    await client.query('COMMIT');
    res.json({ ok: true, line: lineRes.rows[0], ledger_id: ledgerId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/inventory/stock-take/:sheetId/lock
 * Body: { locked_by? }
 * Requires all physical_qty filled. Inserts variance report + GL pending batch. Locks sheet.
 */
router.post('/stock-take/:sheetId/lock', async (req, res) => {
  const { locked_by } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sheetRes = await client.query(
      `SELECT * FROM public.inv_stock_take_sheets WHERE id = $1`,
      [req.params.sheetId]
    );
    if (!sheetRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Sheet not found' });
    }
    if (sheetRes.rows[0].status === 'locked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Sheet already locked' });
    }
    const sheet = sheetRes.rows[0];

    const linesRes = await client.query(
      `SELECT * FROM public.inv_stock_take_lines WHERE sheet_id = $1`,
      [req.params.sheetId]
    );
    const lines = linesRes.rows;
    const unfilled = lines.filter(l => l.physical_qty == null);
    if (unfilled.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        ok: false,
        error: `${unfilled.length} item(s) still missing physical count`,
      });
    }

    // Generate variance report number
    const countRes = await client.query(`SELECT COUNT(*) FROM public.inv_variance_reports`);
    const reportNumber = `VAR-${String(Number(countRes.rows[0].count) + 1).padStart(5, '0')}`;

    // Insert variance report header
    const reportRes = await client.query(
      `INSERT INTO public.inv_variance_reports
         (id, report_number, location_id, period_start, period_end, generated_by)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5) RETURNING id`,
      [reportNumber, sheet.location_id, sheet.period_start, sheet.period_end, locked_by || 'system']
    );
    const reportId = reportRes.rows[0].id;

    // Insert variance lines and accumulate net GL value
    let netVarianceValue = 0;
    for (const line of lines) {
      const theoreticalQty = Number(line.opening_qty) + Number(line.purchases_qty)
        + Number(line.transfers_in_qty) - Number(line.transfers_out_qty)
        - Number(line.theoretical_sales_qty) - Number(line.adjustments_qty);
      const varianceQty = Number(line.physical_qty) - theoreticalQty;
      const varianceValue = varianceQty * Number(line.unit_cost);
      netVarianceValue += varianceValue;

      if (Math.abs(varianceQty) < 0.0005) continue; // skip zero-variance lines
      // Cap so extreme ratios (tiny theoretical) can never overflow NUMERIC(12,4)
      const variancePct = Math.min(theoreticalQty > 0 ? Math.abs(varianceQty / theoreticalQty) * 100 : 0, 99999999.9999);
      const alert = variancePct >= 5 ? 'CRITICAL' : variancePct >= 2 ? 'WARNING' : 'OK';
      // FIX: use the real inv_variance_lines columns (variance_report_id / item_cost /
      // variance_percentage / alert_level) — the old report_id/unit_cost names don't
      // exist and made Reconcile (lock) fail.
      await client.query(
        `INSERT INTO public.inv_variance_lines
           (id, variance_report_id, item_id, theoretical_qty, physical_qty, variance_qty,
            variance_percentage, variance_value, alert_level, item_cost)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [reportId, line.item_id, theoreticalQty, line.physical_qty, varianceQty,
         variancePct, varianceValue, alert, Number(line.unit_cost || 0)]
      );
    }

    // ── TRUE-UP STOCK ON HAND to the physical count ──────────────────────────
    // Stock-on-hand everywhere (stock reports, POS availability, next-period
    // theoreticals, COS) is SUM(quantity_change) from inv_stock_ledger. Before
    // this fix the lock recorded the variance REPORT and the GL batch but never
    // corrected the LEDGER — so on-hand stayed at theoretical after every count.
    // Now each counted line writes an ADJUSTMENT row bringing the item's ledger
    // balance at this location exactly to the physical count. Idempotent per
    // sheet+item via NOT EXISTS (re-lock never double-adjusts).
    for (const line of lines) {
      const balRes = await client.query(
        `SELECT COALESCE(SUM(quantity_change), 0) AS balance
         FROM public.inv_stock_ledger WHERE item_id = $1 AND location_id = $2`,
        [line.item_id, sheet.location_id]
      );
      const ledgerBalance = Number(balRes.rows[0].balance);
      const trueUp = Number(line.physical_qty) - ledgerBalance;
      if (Math.abs(trueUp) < 0.0005) continue;
      await client.query(
        `INSERT INTO public.inv_stock_ledger
           (id, item_id, location_id, ledger_type, reference_number, quantity_change,
            base_uom_id, cost_per_unit, posted_by, inserted_at)
         SELECT gen_random_uuid()::text, $1, $2, 'ADJUSTMENT', $3, $4,
                COALESCE((SELECT base_uom_id FROM public.inv_items WHERE id = $1), 'uom_unit'),
                $5, $6, NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM public.inv_stock_ledger
           WHERE reference_number = $3 AND ledger_type = 'ADJUSTMENT'
             AND item_id = $1 AND location_id = $2
         )`,
        [line.item_id, sheet.location_id, `STOCKTAKE-TRUEUP-${sheet.id}`,
         trueUp, Number(line.unit_cost || 0), locked_by || 'system']
      );
    }

    // ── Stage the net variance as an EDITABLE PENDING GL BATCH ───────────────
    // Shrinkage (net loss): Dr 5100 Cost of Sales / Cr 1400 Inventory.
    // Surplus  (net gain):  Dr 1400 Inventory     / Cr 5100 Cost of Sales.
    // The reconcile no longer books the journal entry directly: it creates a
    // PENDING gl_pending_batches row so the controller can review it in
    // GL Pending Batches, reallocate the accounts (e.g. to a specific cost-of-
    // sales account), then Post — which books the balanced 'adjustment' entry.
    // Idempotent on (origin_table, origin_id): re-lock never double-stages.
    let glBatchId = null;
    if (Math.abs(netVarianceValue) > 0.005) {
      const isShrinkage = netVarianceValue < 0;
      const amount  = Number(Math.abs(netVarianceValue).toFixed(2));
      const drAcct  = isShrinkage ? '5100' : '1400';
      const crAcct  = isShrinkage ? '1400' : '5100';
      const desc    = `Stock Take ${reportNumber} — inventory ${isShrinkage ? 'shrinkage' : 'surplus'}`;
      const glRes = await client.query(
        `INSERT INTO public.gl_pending_batches
           (origin_table, origin_id, description, debit_gl_account, credit_gl_account, amount, status)
         VALUES ('inv_stock_take_sheets', $1, $2, $3, $4, $5, 'PENDING')
         ON CONFLICT (origin_table, origin_id) DO NOTHING
         RETURNING id`,
        [sheet.id, desc, drAcct, crAcct, amount]
      );
      glBatchId = glRes.rows[0]?.id || null;
    }

    // Lock the sheet
    await client.query(
      `UPDATE public.inv_stock_take_sheets
       SET status = 'locked', locked_at = now(), locked_by = $1 WHERE id = $2`,
      [locked_by || 'system', req.params.sheetId]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      report_id: reportId,
      report_number: reportNumber,
      net_variance_value: netVarianceValue,
      gl_batch_id: glBatchId,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/inventory/transfer/:id
 * Master-detail: header + lines with item names and UOM codes.
 */
router.get('/transfer/:id', async (req, res) => {
  try {
    const hRes = await pool.query(
      `SELECT h.*, sl.name AS source_location_name, dl.name AS destination_location_name
       FROM public.inv_transfer_headers h
       LEFT JOIN public.inv_locations sl ON sl.id = COALESCE(h.source_location_id, h.from_location_id)
       LEFT JOIN public.inv_locations dl ON dl.id = COALESCE(h.destination_location_id, h.to_location_id)
       WHERE h.id = $1`,
      [req.params.id]
    );
    if (!hRes.rows.length) return res.status(404).json({ ok: false, error: 'Transfer not found' });

    const lRes = await pool.query(
      `SELECT l.*, i.name AS item_name, i.sku,
              su.code AS source_uom_code, du.code AS destination_uom_code
       FROM public.inv_transfer_lines l
       JOIN public.inv_items i ON i.id = l.item_id
       LEFT JOIN public.inv_uom_definitions su ON su.id = l.source_uom_id
       LEFT JOIN public.inv_uom_definitions du ON du.id = l.destination_uom_id
       WHERE l.transfer_header_id = $1
       ORDER BY l.line_number`,
      [req.params.id]
    );
    res.json({ ok: true, transfer: hRes.rows[0], lines: lRes.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/inventory/transfer/:id/reverse
 * Admin only. Inserts offsetting ledger entries (exact negation of the original
 * TRANSFER_OUT/TRANSFER_IN rows), marks the header reversed, writes an audit row.
 */
router.post('/transfer/:id/reverse', async (req, res) => {
  if ((req.headers['x-user-role'] || '') !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin role required to reverse a transfer' });
  }
  const { reversed_by, reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ ok: false, error: 'A reason is required to reverse' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const hRes = await client.query(
      `SELECT * FROM public.inv_transfer_headers WHERE id = $1 FOR UPDATE`, [req.params.id]
    );
    if (!hRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Transfer not found' });
    }
    const header = hRes.rows[0];
    if (header.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: `Only approved transfers can be reversed (status: ${header.status})` });
    }

    // Negate every ledger row written under this transfer number — exact mirror,
    // so UOM-converted destination quantities reverse correctly.
    const ledRes = await client.query(
      `SELECT * FROM public.inv_stock_ledger
       WHERE reference_number = $1 AND ledger_type IN ('TRANSFER_OUT','TRANSFER_IN')`,
      [header.transfer_number]
    );
    if (!ledRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'No ledger entries found for this transfer' });
    }
    const revRef = `REV-${header.transfer_number}`;
    for (const row of ledRes.rows) {
      await client.query(
        `INSERT INTO public.inv_stock_ledger
         (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by, inserted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [randomUUID(), row.item_id, row.location_id,
         row.ledger_type === 'TRANSFER_OUT' ? 'TRANSFER_IN' : 'TRANSFER_OUT',
         revRef, -Number(row.quantity_change), row.base_uom_id, reversed_by || 'admin']
      );
    }

    await client.query(
      `UPDATE public.inv_transfer_headers
       SET status = 'reversed', reversed_by = $1, reversed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [reversed_by || 'admin', header.id]
    );

    await client.query(
      `INSERT INTO public.inventory_period_audit (period_id, action, user_id, user_name, change_reason)
       VALUES ($1, 'TRANSFER_REVERSED', $2, $2, $3)`,
      [header.id, reversed_by || 'admin', `${header.transfer_number}: ${String(reason).trim()}`]
    );

    await client.query('COMMIT');
    res.json({ ok: true, message: `Transfer ${header.transfer_number} reversed`, reversal_reference: revRef, ledger_rows_reversed: ledRes.rows.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/v1/inventory/transfer/:id
 * Only drafts/pending (no ledger impact). Approved transfers must be reversed.
 */
router.delete('/transfer/:id', async (req, res) => {
  try {
    const hRes = await pool.query(
      `SELECT id, status, transfer_number FROM public.inv_transfer_headers WHERE id = $1`,
      [req.params.id]
    );
    if (!hRes.rows.length) return res.status(404).json({ ok: false, error: 'Transfer not found' });
    if (!['pending', 'draft', 'rejected', 'cancelled'].includes(hRes.rows[0].status)) {
      return res.status(409).json({ ok: false, error: 'Posted transfers cannot be deleted — use Reverse instead' });
    }
    await pool.query(`DELETE FROM public.inv_transfer_headers WHERE id = $1`, [req.params.id]);
    res.json({ ok: true, message: `Transfer ${hRes.rows[0].transfer_number} deleted` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/inventory/stock-take/:sheetId/reopen
 * Body: { reopened_by, reason }  — admin only (x-user-role header).
 * Reverses the lock: deletes the PENDING GL batch + variance report created at
 * lock, sets the sheet back to draft, and writes an audit row.
 * Refuses if the GL batch has already been POSTED.
 */
router.post('/stock-take/:sheetId/reopen', async (req, res) => {
  if ((req.headers['x-user-role'] || '') !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin role required to reopen a sheet' });
  }
  const { reopened_by, reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ ok: false, error: 'A reason is required to reopen' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sheetRes = await client.query(
      `SELECT * FROM public.inv_stock_take_sheets WHERE id = $1`,
      [req.params.sheetId]
    );
    if (!sheetRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Sheet not found' });
    }
    const sheet = sheetRes.rows[0];
    if (sheet.status !== 'locked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Sheet is not locked' });
    }

    // GL entry posted at lock — REVERSE it (void) rather than refuse, so the
    // period can be reopened while preserving the audit trail. Voiding excludes
    // it from P&L / Trial Balance (those filter is_voided = false).
    await client.query(
      `UPDATE public.gl_journal_entries
       SET is_voided = true, voided_at = NOW(), voided_by = $2,
           void_reason = 'Stock take sheet reopened', updated_at = NOW()
       WHERE id = $1`,
      [`GLVAR_${sheet.id}`, reopened_by || 'admin']
    );
    await client.query(
      `DELETE FROM public.gl_pending_batches
       WHERE origin_table = 'inv_stock_take_sheets' AND origin_id = $1`,
      [sheet.id]
    );

    // Remove the ledger TRUE-UP adjustments written at lock so a re-lock
    // recomputes them fresh against the then-current ledger (no double-count).
    await client.query(
      `DELETE FROM public.inv_stock_ledger
       WHERE reference_number = $1 AND ledger_type = 'ADJUSTMENT'`,
      [`STOCKTAKE-TRUEUP-${sheet.id}`]
    );

    // Variance report + lines created at lock (matched by location + period)
    const repRes = await client.query(
      `SELECT id FROM public.inv_variance_reports
       WHERE location_id = $1 AND period_start = $2 AND period_end = $3`,
      [sheet.location_id, sheet.period_start, sheet.period_end]
    );
    for (const rep of repRes.rows) {
      await client.query(`DELETE FROM public.inv_variance_lines WHERE variance_report_id = $1`, [rep.id]);
      await client.query(`DELETE FROM public.inv_variance_reports WHERE id = $1`, [rep.id]);
    }

    await client.query(
      `UPDATE public.inv_stock_take_sheets
       SET status = 'draft', locked_at = NULL, locked_by = NULL WHERE id = $1`,
      [sheet.id]
    );

    await client.query(
      `INSERT INTO public.inventory_period_audit (period_id, action, user_id, user_name, change_reason)
       VALUES ($1, 'SHEET_REOPENED', $2, $2, $3)`,
      [sheet.id, reopened_by || 'system', String(reason).trim()]
    );

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Sheet reopened', deleted_reports: repRes.rows.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/inventory/reopen-period
 * Body: { period_id, reopened_by, reason }  — admin only (x-user-role header).
 * Sets a locked inventory period back to open and writes an audit row.
 */
router.post('/reopen-period', async (req, res) => {
  if ((req.headers['x-user-role'] || '') !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin role required to reopen a period' });
  }
  const { period_id, reopened_by, reason } = req.body || {};
  if (!period_id) return res.status(400).json({ ok: false, error: 'period_id is required' });
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ ok: false, error: 'A reason is required to reopen' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const perRes = await client.query(
      `SELECT id, status FROM public.inventory_periods WHERE id = $1`, [period_id]
    );
    if (!perRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Period not found' });
    }
    if (perRes.rows[0].status !== 'locked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Period is not locked' });
    }

    await client.query(
      `UPDATE public.inventory_periods
       SET status = 'open', locked_at = NULL, locked_by = NULL WHERE id = $1`,
      [period_id]
    );
    await client.query(
      `INSERT INTO public.inventory_period_audit (period_id, action, user_id, user_name, change_reason)
       VALUES ($1, 'PERIOD_REOPENED', $2, $2, $3)`,
      [period_id, reopened_by || 'system', String(reason).trim()]
    );

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Period reopened' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
