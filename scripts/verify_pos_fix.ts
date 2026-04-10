/**
 * Verify that the POS price fix is working correctly
 * 
 * Usage: npx ts-node scripts/verify_pos_fix.ts
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

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
    console.log('✅ POS FIX VERIFICATION\n');
    console.log('=' .repeat(60) + '\n');

    // Check products table
    const prodCount = await client.query('SELECT COUNT(*) as count FROM products WHERE price > 0');
    console.log(`✓ Products table: ${prodCount.rows[0].count} items with price > 0`);

    // Check inventory_items table
    const invCount = await client.query('SELECT COUNT(*) as count FROM inventory_items WHERE price > 0');
    console.log(`✓ Inventory items: ${invCount.rows[0].count} items with price > 0`);

    // check if they match
    if (prodCount.rows[0].count === invCount.rows[0].count) {
      console.log('✓ ✅ Tables are synchronized!\n');
    } else {
      console.log('✗ ⚠️ Tables have different counts\n');
    }

    // Sample items
    console.log('Sample items from products table:');
    console.log('-' .repeat(60));
    const samples = await client.query(`
      SELECT 
        id, 
        name, 
        price,
        category,
        stock_level
      FROM products 
      WHERE price > 0
      ORDER BY name
      LIMIT 10
    `);
    
    samples.rows.forEach((row: any) => {
      console.log(`  ${row.name.padEnd(30)} €${String(row.price).padEnd(6)} | Stock: ${row.stock_level}`);
    });

    console.log('\n' + '=' .repeat(60));
    console.log('\n🔧 CACHE CLEARING INSTRUCTIONS:\n');
    console.log('1. Open browser DevTools (F12)');
    console.log('2. Go to "Application" tab');
    console.log('3. Click "Local Storage" in left sidebar');
    console.log('4. Click on your localhost URL');
    console.log('5. Find key: "corepms_pos_items"');
    console.log('6. Delete it');
    console.log('7. Hard refresh: Ctrl+Shift+R (Cmd+Shift+R on Mac)\n');
    console.log('OR use this one-liner in browser console:\n');
    console.log('  localStorage.removeItem("corepms_pos_items"); location.reload();');
    console.log('\n✅ After clearing cache, prices should persist after refresh!\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await client.release();
    await pool.end();
  }
}

main();
