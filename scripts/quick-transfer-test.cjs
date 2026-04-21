#!/usr/bin/env node

/**
 * Quick test for transfer issue
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function quickTest() {
  const client = await pool.connect();

  try {
    console.log('=== QUICK TRANSFER TEST ===');

    // Clean up
    await client.query('DELETE FROM public.inv_stock_ledger WHERE item_id = \'item_jameson_1\'');

    // Create test item
    await client.query(
      `INSERT INTO public.inv_items (id, name, category, base_uom_id, weighted_avg_cost, default_wastage_pct, reorder_level, is_active)
      VALUES ('item_jameson_1', 'Jameson Whiskey', 'Beverage', 'uom_case', 180.00, 0.00, 10.00, true)
      ON CONFLICT (id) DO NOTHING`
    );

    // GRN: +10 cases
    await client.query(
      `INSERT INTO public.inv_stock_ledger
      (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
      VALUES (gen_random_uuid()::text, 'item_jameson_1', 'loc_main_cellar', 'GRN', 'TEST-GRN', 10, 'uom_case', 'test')`
    );

    console.log('After GRN:');
    const grnBalance = await client.query(
      `SELECT SUM(quantity_change) as balance FROM public.inv_stock_ledger WHERE item_id = 'item_jameson_1' AND location_id = 'loc_main_cellar'`
    );
    console.log('  Main Cellar:', grnBalance.rows[0].balance);

    // Transfer: -2 bottles, +60 tots
    await client.query(
      `INSERT INTO public.inv_stock_ledger
      (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
      VALUES (gen_random_uuid()::text, 'item_jameson_1', 'loc_main_cellar', 'TRANSFER_OUT', 'TEST-TRANS', -2, 'uom_bottle', 'test')`
    );

    await client.query(
      `INSERT INTO public.inv_stock_ledger
      (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
      VALUES (gen_random_uuid()::text, 'item_jameson_1', 'loc_bar1', 'TRANSFER_IN', 'TEST-TRANS', 60, 'uom_tot', 'test')`
    );

    console.log('After Transfer:');
    const mainBalance = await client.query(
      `SELECT SUM(quantity_change) as balance FROM public.inv_stock_ledger WHERE item_id = 'item_jameson_1' AND location_id = 'loc_main_cellar'`
    );
    const barBalance = await client.query(
      `SELECT SUM(quantity_change) as balance FROM public.inv_stock_ledger WHERE item_id = 'item_jameson_1' AND location_id = 'loc_bar1'`
    );

    console.log('  Main Cellar:', mainBalance.rows[0].balance);
    console.log('  Bar:', barBalance.rows[0].balance);

    console.log('Expected: Main=8, Bar=60');

  } finally {
    client.release();
    await pool.end();
  }
}

quickTest().catch(console.error);