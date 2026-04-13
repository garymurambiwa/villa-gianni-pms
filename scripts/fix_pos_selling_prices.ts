/**
 * Fix POS System - Ensure Selling Prices Are Displayed
 * 
 * This script fixes the issue where POS displays cost prices instead of selling prices.
 * It ensures the products table has the correct selling_price values from inventory_items.
 * 
 * Usage: npm run ts-node scripts/fix_pos_selling_prices.ts
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set');
  process.exit(1);
}

const pool = new Pool({ 
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting POS Selling Price Fix...\n');

    // Step 1: Check if products table exists
    console.log('Step 1: Checking products table structure...');
    const tableCheckRes = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'products'
      )
    `);
    
    const productsTableExists = tableCheckRes.rows[0].exists;
    if (!productsTableExists) {
      console.log('⚠️  Products table does not exist. Creating it...');
      
      // Create products table with correct structure
      await client.query(`
        CREATE TABLE IF NOT EXISTS products (
          id VARCHAR(255) PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT,
          department TEXT DEFAULT 'Restaurant',
          price NUMERIC(12,2) DEFAULT 0,
          cost_price NUMERIC(12,2) DEFAULT 0,
          stock_level NUMERIC DEFAULT 0,
          unit TEXT DEFAULT 'units',
          active BOOLEAN DEFAULT true,
          visibility TEXT,
          is_stock_item BOOLEAN DEFAULT true,
          category_id VARCHAR(255),
          sub_id VARCHAR(255),
          bar_visibility BOOLEAN,
          restaurant_visibility BOOLEAN,
          inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      console.log('✅ Products table created\n');
    }

    // Step 2: Add columns if missing
    console.log('Step 2: Ensuring all required columns exist...');
    const columnsToAdd = [
      { col: 'category_id', type: 'VARCHAR(255)' },
      { col: 'sub_id', type: 'VARCHAR(255)' },
      { col: 'bar_visibility', type: 'BOOLEAN' },
      { col: 'restaurant_visibility', type: 'BOOLEAN' }
    ];

    for (const { col, type } of columnsToAdd) {
      await client.query(`
        ALTER TABLE products 
        ADD COLUMN IF NOT EXISTS ${col} ${type}
      `).catch(() => {/* Column might already exist */});
    }
    console.log('✅ Column check complete\n');

    // Step 3: Add selling_price column if it doesn't exist
    console.log('Step 3: Ensuring selling_price column exists...');
    await client.query(`
      ALTER TABLE inventory_items
      ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) DEFAULT 0
    `);
    console.log('✅ selling_price column added\n');

    // Step 4: Check inventory_items table for selling prices
    console.log('Step 4: Checking inventory_items for selling price data...');
    const invCheckRes = await client.query(`
      SELECT
        COUNT(*) as total_items,
        SUM(CASE WHEN price > 0 THEN 1 ELSE 0 END) as items_with_price,
        SUM(CASE WHEN selling_price > 0 THEN 1 ELSE 0 END) as items_with_selling_price,
        SUM(CASE WHEN cost > 0 THEN 1 ELSE 0 END) as items_with_cost
      FROM inventory_items
    `);

    const invStats = invCheckRes.rows[0];
    console.log(`  - Total inventory items: ${invStats.total_items}`);
    console.log(`  - Items with 'price' field > 0: ${invStats.items_with_price}`);
    console.log(`  - Items with 'selling_price' field > 0: ${invStats.items_with_selling_price}`);
    console.log(`  - Items with 'cost' field > 0: ${invStats.items_with_cost}\n`);

    // Step 5: Populate selling_price in inventory_items if empty
    console.log('Step 5: Ensuring inventory_items has selling prices...');
    const updateInventoryRes = await client.query(`
      UPDATE inventory_items
      SET selling_price = price
      WHERE (selling_price = 0 OR selling_price IS NULL)
        AND price > 0
    `);
    const inventoryUpdated = updateInventoryRes.rowCount || 0;
    console.log(`✅ Updated ${inventoryUpdated} inventory items with selling prices\n`);

    // Step 6: Sync selling prices from inventory_items to products
    console.log('Step 6: Syncing selling prices to products table...');

    // First, delete from products any items that no longer exist in inventory_items
    const deleteRes = await client.query(`
      DELETE FROM products
      WHERE id NOT IN (SELECT id FROM inventory_items)
    `);
    console.log(`✅ Removed ${deleteRes.rowCount} orphaned products\n`);

    // Then sync from inventory_items to products using selling_price
    const syncRes = await client.query(`
      INSERT INTO products (
        id, name, category, department, price, cost_price,
        stock_level, unit, active, visibility, is_stock_item
      )
      SELECT
        id, name, category, category,
        COALESCE(selling_price, price, 0) as price,
        COALESCE(cost, 0) as cost_price,
        COALESCE(stock_level, 0) as stock_level,
        COALESCE(unit, 'units') as unit,
        true as active,
        null as visibility,
        true as is_stock_item
      FROM inventory_items
      ON CONFLICT (id) DO UPDATE SET
        price = EXCLUDED.price,
        cost_price = EXCLUDED.cost_price,
        stock_level = EXCLUDED.stock_level,
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        unit = EXCLUDED.unit
    `);

    console.log(`✅ Synced products from inventory_items\n`);

    // Step 7: Verify the fix
    console.log('Step 7: Verifying fix...');
    const verifyRes = await client.query(`
      SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN price > cost_price THEN 1 ELSE 0 END) as products_with_markup,
        SUM(CASE WHEN price = cost_price THEN 1 ELSE 0 END) as products_with_zero_margin,
        SUM(CASE WHEN price < cost_price THEN 1 ELSE 0 END) as products_with_negative_margin,
        SUM(CASE WHEN price > 0 THEN 1 ELSE 0 END) as products_with_non_zero_price,
        ROUND(AVG(CASE WHEN price > 0 THEN price ELSE NULL END)::numeric, 2) as avg_price
      FROM products
    `);

    const verifyStats = verifyRes.rows[0];
    console.log(`  - Total products: ${verifyStats.total_products}`);
    console.log(`  - Products with markup (price > cost): ${verifyStats.products_with_markup}`);
    console.log(`  - Products with zero margin: ${verifyStats.products_with_zero_margin}`);
    console.log(`  - Products with negative margin: ${verifyStats.products_with_negative_margin}`);
    console.log(`  - Products with price > 0: ${verifyStats.products_with_non_zero_price}`);
    console.log(`  - Average selling price: ${verifyStats.avg_price}\n`);

    // Step 8: Sample data check
    console.log('Step 8: Sample data verification...');
    const sampleRes = await client.query(`
      SELECT id, name, price as selling_price, cost_price, 
             ROUND(((price - cost_price) / NULLIF(cost_price, 0) * 100)::numeric, 1) as margin_percent
      FROM products 
      WHERE price > 0 
      ORDER BY RANDOM() 
      LIMIT 5
    `);

    console.log('  Sample products with selling prices:');
    sampleRes.rows.forEach((row: any) => {
      const margin = row.margin_percent !== null ? `${row.margin_percent}%` : 'N/A';
      console.log(`    - ${row.name}: Selling €${Number(row.selling_price).toFixed(2)}, Cost €${Number(row.cost_price).toFixed(2)}, Margin ${margin}`);
    });

    console.log('\n✅ POS SELLING PRICE FIX COMPLETE!');
    console.log('📋 Your POS system should now display selling prices correctly.\n');

  } catch (error) {
    console.error('❌ Error during fix:', error);
    process.exit(1);
  } finally {
    await client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
