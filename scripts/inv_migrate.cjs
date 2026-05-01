'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../server/db-web.cjs');

async function run() {
  console.log('Running inventory migration...');

  const steps = [
    // ── inv_items: add missing columns ──────────────────────────────────────
    `ALTER TABLE inv_items
       ADD COLUMN IF NOT EXISTS sku               TEXT,
       ADD COLUMN IF NOT EXISTS barcode           TEXT,
       ADD COLUMN IF NOT EXISTS last_cost_price   NUMERIC(12,4) DEFAULT 0,
       ADD COLUMN IF NOT EXISTS average_cost      NUMERIC(12,4) DEFAULT 0,
       ADD COLUMN IF NOT EXISTS expiry_tracking   BOOLEAN DEFAULT false,
       ADD COLUMN IF NOT EXISTS default_location_id TEXT,
       ADD COLUMN IF NOT EXISTS media_url         TEXT,
       ADD COLUMN IF NOT EXISTS supplier_id       TEXT,
       ADD COLUMN IF NOT EXISTS sub_category      TEXT,
       ADD COLUMN IF NOT EXISTS notes             TEXT,
       ADD COLUMN IF NOT EXISTS par_level         NUMERIC(12,4) DEFAULT 0,
       ADD COLUMN IF NOT EXISTS reorder_qty       NUMERIC(12,4) DEFAULT 0`,

    // ── inv_grn_headers: add missing columns ────────────────────────────────
    `ALTER TABLE inv_grn_headers
       ADD COLUMN IF NOT EXISTS supplier_id              TEXT,
       ADD COLUMN IF NOT EXISTS supplier_invoice_number  TEXT,
       ADD COLUMN IF NOT EXISTS notes                    TEXT`,

    // ── inv_grn_lines: add missing columns ──────────────────────────────────
    `ALTER TABLE inv_grn_lines
       ADD COLUMN IF NOT EXISTS expiry_date   DATE,
       ADD COLUMN IF NOT EXISTS batch_number  TEXT`,

    // ── Unique indexes on SKU / barcode ─────────────────────────────────────
    `CREATE UNIQUE INDEX IF NOT EXISTS inv_items_sku_idx     ON inv_items(sku)     WHERE sku IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS inv_items_barcode_idx ON inv_items(barcode) WHERE barcode IS NOT NULL`,

    // ── Default inv_locations (capitalised to satisfy CHECK constraint) ───────
    `INSERT INTO inv_locations (id, name, location_type, is_active, inserted_at, updated_at) VALUES
       ('loc_main_cellar',  'Main Cellar',      'Storage', true, NOW(), NOW()),
       ('loc_dry_goods',    'Dry Goods Store',  'Storage', true, NOW(), NOW()),
       ('loc_freezer',      'Freezer',          'Storage', true, NOW(), NOW()),
       ('loc_perishables',  'Perishables',      'Storage', true, NOW(), NOW()),
       ('loc_bar1',         'Bar',              'Outlet',  true, NOW(), NOW()),
       ('loc_restaurant',   'Restaurant',       'Outlet',  true, NOW(), NOW()),
       ('loc_kitchen',      'Kitchen',          'Outlet',  true, NOW(), NOW()),
       ('loc_room_service', 'Room Service',     'Outlet',  true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,

    // ── UOM definitions (table uses 'code', not 'abbreviation') ─────────────
    `INSERT INTO inv_uom_definitions (id, code, name, inserted_at) VALUES
       ('uom_case',    'CASE',  'Case',         NOW()),
       ('uom_crate',   'CRATE', 'Crate',        NOW()),
       ('uom_bottle',  'BTL',   'Bottle',       NOW()),
       ('uom_can',     'CAN',   'Can',          NOW()),
       ('uom_unit',    'UNIT',  'Unit',         NOW()),
       ('uom_kg',      'KG',    'Kilogram',     NOW()),
       ('uom_g',       'G',     'Gram',         NOW()),
       ('uom_l',       'L',     'Litre',        NOW()),
       ('uom_ml',      'ML',    'Millilitre',   NOW()),
       ('uom_tot',     'TOT',   'Tot (25ml)',   NOW()),
       ('uom_pkt',     'PKT',   'Packet',       NOW()),
       ('uom_box',     'BOX',   'Box',          NOW()),
       ('uom_dozen',   'DOZ',   'Dozen',        NOW()),
       ('uom_portion', 'POR',   'Portion',      NOW()),
       ('uom_bag',     'BAG',   'Bag',          NOW())
     ON CONFLICT (id) DO NOTHING`,

    // ── Physical count tables ────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS inv_physical_counts (
       id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       location_id  TEXT NOT NULL,
       count_date   DATE NOT NULL DEFAULT CURRENT_DATE,
       status       TEXT NOT NULL DEFAULT 'draft',
       counted_by   TEXT,
       verified_by  TEXT,
       notes        TEXT,
       inserted_at  TIMESTAMPTZ DEFAULT NOW(),
       updated_at   TIMESTAMPTZ DEFAULT NOW()
     )`,

    `CREATE TABLE IF NOT EXISTS inv_physical_count_lines (
       id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       count_id     TEXT NOT NULL REFERENCES inv_physical_counts(id) ON DELETE CASCADE,
       item_id      TEXT NOT NULL,
       physical_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
       uom_id       TEXT,
       notes        TEXT,
       inserted_at  TIMESTAMPTZ DEFAULT NOW()
     )`,
  ];

  for (const sql of steps) {
    const r = await db.exec(sql);
    if (!r.ok) console.error('FAILED:', sql.slice(0, 60), '->', r.error);
    else console.log('OK:', sql.slice(0, 60).trim());
  }

  // ── Import products → inv_items ────────────────────────────────────────────
  console.log('\nImporting products → inv_items ...');
  const products = await db.query(`
    SELECT id, name, department, category, price, cost_price, unit,
           category_id, notes, picture_data, bar_visibility, restaurant_visibility
    FROM products WHERE active = true
  `);

  if (!products.ok) { console.error('Could not read products:', products.error); process.exit(1); }

  // Drop the unique SKU index temporarily so we can assign SKUs safely
  await db.exec(`DROP INDEX IF EXISTS inv_items_sku_idx`);

  let imported = 0, skipped = 0, counter = 1;
  for (const p of products.rows) {
    const cat   = String(p.department || p.category || '').toLowerCase();
    const invCat = cat.includes('bar') || cat.includes('beverage') ? 'Beverage' : 'Food';

    // Generate a guaranteed-unique SKU: category prefix + zero-padded counter
    const prefix = invCat === 'Beverage' ? 'BEV' : 'FNB';
    const sku    = `${prefix}${String(counter).padStart(5, '0')}`;
    counter++;

    // Map unit string to a known UOM id
    const unitMap = {
      'bottle':'uom_bottle','btl':'uom_bottle','can':'uom_can',
      'kg':'uom_kg','g':'uom_g','l':'uom_l','litre':'uom_l',
      'ml':'uom_ml','pkt':'uom_pkt','pcs':'uom_unit','units':'uom_unit','unit':'uom_unit',
      'box':'uom_box','crate':'uom_crate','case':'uom_case','dozen':'uom_dozen',
      'portion':'uom_portion','bag':'uom_bag',
    };
    const uomId = unitMap[String(p.unit || '').toLowerCase()] || 'uom_unit';
    const cost  = Number(p.cost_price || 0);

    const r = await db.query(`
      INSERT INTO inv_items
        (id, name, category, sub_category, base_uom_id, sku,
         weighted_avg_cost, last_cost_price, average_cost,
         default_wastage_pct, reorder_level, par_level,
         media_url, notes, is_active, inserted_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,0,$10,$11,true,NOW(),NOW())
      ON CONFLICT (id) DO UPDATE SET
        name            = EXCLUDED.name,
        category        = EXCLUDED.category,
        last_cost_price = EXCLUDED.last_cost_price,
        average_cost    = EXCLUDED.average_cost,
        weighted_avg_cost = EXCLUDED.weighted_avg_cost,
        updated_at      = NOW()
    `, [p.id, p.name, invCat, p.category || null, uomId, sku,
        cost, cost, cost, p.picture_data || null, p.notes || null]);

    if (r.ok) imported++; else { skipped++; console.warn('  skip:', p.name, r.error?.slice(0,60)); }
  }

  // Recreate the unique SKU index now that all SKUs are unique
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS inv_items_sku_idx ON inv_items(sku) WHERE sku IS NOT NULL`);

  console.log(`\nImported ${imported} items, skipped ${skipped}`);
  console.log('\nMigration complete ✓');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
