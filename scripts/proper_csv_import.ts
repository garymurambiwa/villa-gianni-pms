/**
 * Proper CSV Import - Import ALL items with correct prices
 * 
 * Usage: npx ts-node scripts/proper_csv_import.ts
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as xlsx from 'xlsx';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

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
    console.log('📥 IMPORTING POS DATA FROM CSV\n');

    // Read CSV
    const csvPath = path.resolve('stock_items.csv');
    if (!fs.existsSync(csvPath)) {
      console.error(`❌ CSV not found at ${csvPath}`);
      process.exit(1);
    }

    const buffer = fs.readFileSync(csvPath);
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    console.log(`📄 Loaded ${data.length} items from CSV\n`);

    // Step 1: Clear existing data
    console.log('🗑️  Clearing existing data...');
    await client.query('DELETE FROM products');
    await client.query('DELETE FROM inventory_items');
    console.log('  ✓ Cleaned up\n');

    // Step 2: Import items
    console.log('⬆️  Importing items...');
    let imported = 0;

    for (const row of data) {
      const id = String(row.ID || `ITEM_${Date.now()}_${Math.random()}`);
      const name = String(row.Name || 'Unnamed').trim();
      const center = String(row.Center || 'restaurant').toLowerCase();
      const dept = center.includes('bar') ? 'Bar' : 'Restaurant';
      
      const sellingPrice = Number(row.SellingPrice || 0);
      const costPrice = Number(row.CostPrice || 0);
      const qtyInStock = Number(row.QtyInStock || 0);
      
      const barVis = row.BarVisible === 'Yes' || row.BarVisible === true;
      const restVis = row.RestaurantVisible === 'Yes' || row.RestaurantVisible === true;
      const visibility = JSON.stringify({ bar: barVis, restaurant: restVis });

      const notes = row.Notes || '';
      const cosPercent = Number(row.COSPercent || 0);
      const gpAmount = Number(row.GPAmount || 0);
      const gpPercent = Number(row.GPPercent || 0);
      const categoryId = String(row.CategoryId || '');

      try {
        // Insert into products table
        await client.query(`
          INSERT INTO products (
            id, name, category, department, price, cost_price, stock_level,
            active, visibility, is_stock_item, category_id, notes,
            cos_percent, gp_percent, gp_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `, [
          id, name, center, dept, sellingPrice, costPrice, qtyInStock,
          true, visibility, true, categoryId, notes,
          cosPercent, gpPercent, gpAmount
        ]);

        // Insert into inventory_items table (using price for both since table might not have cost_price column)
        await client.query(`
          INSERT INTO inventory_items (
            id, name, category, price, cost_price, stock_level, unit, visibility
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            price = EXCLUDED.price,
            cost_price = EXCLUDED.cost_price,
            stock_level = EXCLUDED.stock_level
        `, [
          id, name, center, sellingPrice, costPrice, qtyInStock, 'units', visibility
        ]).catch((err: any) => {
          // If cost_price column doesn't exist, retry without it
          if (err.message.includes('cost_price')) {
            return client.query(`
              INSERT INTO inventory_items (
                id, name, category, price, stock_level, unit, visibility
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                price = EXCLUDED.price,
                stock_level = EXCLUDED.stock_level
            `, [id, name, center, sellingPrice, qtyInStock, 'units', visibility]);
          }
          throw err;
        });

        imported++;
        if (imported % 20 === 0) {
          console.log(`  ... ${imported} items imported`);
        }
      } catch (err: any) {
        console.warn(`  ⚠️  Failed to import "${name}":`, err.message.substring(0, 100));
      }
    }

    console.log(`  ✓ Imported ${imported} items\n`);

    // Step 3: Verification
    console.log('✅ VERIFICATION:');
    const prodCount = await client.query('SELECT COUNT(*) FROM products');
    const invCount = await client.query('SELECT COUNT(*) FROM inventory_items');
    console.log(`  - Products: ${prodCount.rows[0].count}`);
    console.log(`  - Inventory Items: ${invCount.rows[0].count}`);

    // Show sample data
    const sample = await client.query(`
      SELECT id, name, price, cost_price FROM products 
      WHERE price > 0 
      LIMIT 3
    `);
    console.log('\n  Sample items:');
    sample.rows.forEach((row: any) => {
      console.log(`    - ${row.name}: Selling €${row.price}, Cost €${row.cost_price}`);
    });

    console.log('\n✅ IMPORT COMPLETE!');
    console.log('\n📱 Next steps:');
    console.log('  1. Clear your browser localStorage: Open DevTools → Application → Local Storage → Delete corepms_pos_items');
    console.log('  2. Refresh the browser (F5)');
    console.log('  3. Open POS System - should now show correct selling prices');
    console.log('\nOr just refresh and the cache will reload from the database.');

  } catch (error) {
    console.error('❌ Error:', error);
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
