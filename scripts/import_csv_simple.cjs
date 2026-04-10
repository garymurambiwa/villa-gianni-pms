const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const xlsx = require('xlsx');

require('dotenv').config({ path: '.env' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set');
  process.exit(1);
}

async function run() {
  const client = new Client({ 
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('📥 IMPORTING POS DATA FROM CSV\n');

    // Read CSV
    const csvPath = path.resolve('stock_items.csv');
    const buffer = fs.readFileSync(csvPath);
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    console.log(`📄 Loaded ${data.length} items from CSV\n`);

    // Clear existing
    console.log('🗑️  Clearing existing data...');
    await client.query('DELETE FROM products');
    await client.query('DELETE FROM inventory_items');
    console.log('✓ Cleaned\n');

    // Import with batch queries
    console.log('⬆️  Importing items...');
    let imported = 0;
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const id = String(row.ID || `ITEM_${Date.now()}_${i}`).substring(0, 255);
      const name = String(row.Name || 'Unnamed').trim().substring(0, 500);
      const center = String(row.Center || 'restaurant').toLowerCase();
      const dept = center.includes('bar') ? 'Bar' : 'Restaurant';
      
      const sellingPrice = Number(row.SellingPrice || 0);
      const costPrice = Number(row.CostPrice || 0);
      const visibility = JSON.stringify({ 
        bar: row.BarVisible === 'Yes' || row.BarVisible === true,
        restaurant: row.RestaurantVisible === 'Yes' || row.RestaurantVisible === true
      });

      try {
        // Insert products
        await client.query(
          `INSERT INTO products (id, name, category, department, price, cost_price, stock_level, active, visibility, is_stock_item)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, true)`,
          [id, name, center, dept, sellingPrice, costPrice, Number(row.QtyInStock || 0), visibility]
        );

        // Insert inventory_items
        await client.query(
          `INSERT INTO inventory_items (id, name, category, price, cost_price, stock_level, unit, visibility)
           VALUES ($1, $2, $3, $4, $5, $6, 'units', $7)
           ON CONFLICT (id) DO UPDATE SET price = $4, cost_price = $5, stock_level = $6`,
          [id, name, center, sellingPrice, costPrice, Number(row.QtyInStock || 0), visibility]
        ).catch(async (err) => {
          // Retry without cost_price if column missing
          if (err.message.includes('cost_price')) {
            await client.query(
              `INSERT INTO inventory_items (id, name, category, price, stock_level, unit, visibility)
               VALUES ($1, $2, $3, $4, $5, 'units', $6)
               ON CONFLICT (id) DO UPDATE SET price = $4, stock_level = $5`,
              [id, name, center, sellingPrice, Number(row.QtyInStock || 0), visibility]
            );
          } else throw err;
        });

        imported++;
      } catch (err) {
        errors.push(`${name}: ${err.message.substring(0, 80)}`);
      }

      if ((i + 1) % 50 === 0) {
        console.log(`  ... ${i + 1}/${data.length} processed`);
      }
    }

    console.log(`\n✅ Imported ${imported}/${data.length} items`);
    if (errors.length > 0) {
      console.log(`⚠️  Errors: ${errors.length}`);
      errors.slice(0, 3).forEach(e => console.log(`   - ${e}`));
    }

    // Verify
    const prodRes = await client.query('SELECT COUNT(*) FROM products WHERE price > 0');
    const invRes = await client.query('SELECT COUNT(*) FROM inventory_items WHERE price > 0');
    console.log(`\n📊 Database now has:\n  - ${prodRes.rows[0].count} products\n  - ${invRes.rows[0].count} inventory items`);

    // Sample
    const sampleRes = await client.query(
      `SELECT name, price, cost_price FROM products WHERE price > 0 AND price != cost_price LIMIT 3`
    );
    console.log('\n✓ Sample items with margin:');
    sampleRes.rows.forEach(r => {
      const margin = ((r.price - r.cost_price) / r.cost_price * 100).toFixed(1);
      console.log(`  - ${r.name}: €${r.price} (cost €${r.cost_price}, margin ${margin}%)`);
    });

    console.log('\n🎉 IMPORT COMPLETE! Refresh your browser to see updated prices.');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
