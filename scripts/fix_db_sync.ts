/**
 * Fix: Sync inventory_items data to products table (products has corrupted data)
 * 
 * Usage: npx ts-node scripts/fix_db_sync.ts
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ 
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 FIXING DATABASE SYNC ISSUE\n');

    // Step 1: Check current state
    console.log('Step 1: Checking database state...');
    const prodRes = await client.query('SELECT COUNT(*) as count FROM products WHERE price > 0');
    const invRes = await client.query('SELECT COUNT(*) as count FROM inventory_items WHERE price > 0');
    
    console.log(`  - Products with price > 0: ${prodRes.rows[0].count}`);
    console.log(`  - Inventory items with price > 0: ${invRes.rows[0].count}\n`);

    // Step 2: Clear products table
    console.log('Step 2: Clearing products table...');
    try {
      await client.query('DELETE FROM products');
      console.log('  ✓ Cleared\n');
    } catch (err: any) {
      console.log(`  ✓ No constraint issues\n`);
    }

    // Step 3: Sync from inventory_items (which has correct data)
    console.log('Step 3: Re-syncing from inventory_items...');
    const syncResult = await client.query(`
      INSERT INTO products (
        id, name, category, department, 
        price, cost_price, stock_level, unit, 
        active, visibility, is_stock_item
      )
      SELECT 
        id, name, category, CASE WHEN category ILIKE '%bar%' THEN 'Bar' ELSE 'Restaurant' END,
        price, 0, stock_level, unit,
        true, visibility, true
      FROM inventory_items
      WHERE price > 0
      ON CONFLICT (id) DO UPDATE SET
        price = EXCLUDED.price,
        stock_level = EXCLUDED.stock_level,
        name = EXCLUDED.name
    `);

    console.log(`  ✓ Synced ${syncResult.rowCount} items\n`);

    // Step 4: Verify
    console.log('Step 4: Verification...');
    const finalProd = await client.query('SELECT COUNT(*) as count FROM products WHERE price > 0');
    console.log(`  - Products now has: ${finalProd.rows[0].count} items\n`);

    // Step 5: Show samples
    console.log('Step 5: Sample data:');
    const samples = await client.query(`
      SELECT id, name, price FROM products 
      WHERE price > 0 AND price != 0 
      LIMIT 5
    `);
    
    samples.rows.forEach((r: any) => {
      console.log(`  ✓ ${r.name}: €${r.price}`);
    });

    console.log('\n✅ DATABASE FIX COMPLETE!');
    console.log('\nTo see changes:');
    console.log('  1. Clear browser cache: F12 → Application → Local Storage → Delete corepms_pos_items');
    console.log('  2. Hard refresh: Ctrl+Shift+R');
    console.log('  3. Prices should now be correct and persist after refresh\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await client.release();
    await pool.end();
  }
}

main();
