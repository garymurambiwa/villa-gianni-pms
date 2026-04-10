/**
 * Diagnostic: Check what prices are actually in the database
 * 
 * Usage: npm run ts-node scripts/diagnose_pos_prices.ts
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

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
    console.log('🔍 POS PRICE DIAGNOSTIC\n');

    // Check products table
    console.log('═══ PRODUCTS TABLE ═══');
    const productsRes = await client.query(`
      SELECT id, name, price, cost_price, category, department
      FROM products 
      WHERE price > 0 
      LIMIT 5
    `);
    console.log(`Total products with price > 0: ${productsRes.rowCount}`);
    console.log('Sample items:');
    productsRes.rows.forEach((row: any) => {
      console.log(`  - ${row.name}: price €${row.price}, cost_price €${row.cost_price}`);
    });

    // Check inventory_items table
    console.log('\n═══ INVENTORY_ITEMS TABLE ═══');
    const invRes = await client.query(`
      SELECT id, name, price, cost, category
      FROM inventory_items 
      WHERE price > 0 
      LIMIT 5
    `);
    console.log(`Total inventory items with price > 0: ${invRes.rowCount}`);
    console.log('Sample items:');
    invRes.rows.forEach((row: any) => {
      console.log(`  - ${row.name}: price €${row.price}, cost €${row.cost}`);
    });

    // Check for specific item
    console.log('\n═══ SEARCHING FOR "Cheese & Tomato" ═══');
    const cheeseRes = await client.query(`
      SELECT id, name, price, cost_price, cost, category, department
      FROM products 
      WHERE LOWER(name) LIKE '%cheese%tomato%'
    `);
    if (cheeseRes.rowCount === 0) {
      console.log('🚨 NOT FOUND in products table!');
    } else {
      cheeseRes.rows.forEach((row: any) => {
        console.log(`✓ Found in products: name="${row.name}", price=${row.price}, cost_price=${row.cost_price}`);
      });
    }

    const cheeseInvRes = await client.query(`
      SELECT id, name, price, cost, category
      FROM inventory_items 
      WHERE LOWER(name) LIKE '%cheese%tomato%'
    `);
    if (cheeseInvRes.rowCount === 0) {
      console.log('🚨 NOT FOUND in inventory_items table!');
    } else {
      cheeseInvRes.rows.forEach((row: any) => {
        console.log(`✓ Found in inventory_items: name="${row.name}", price=${row.price}, cost=${row.cost}`);
      });
    }

    // Check price distribution
    console.log('\n═══ PRICE STATISTICS ═══');
    const statsRes = await client.query(`
      SELECT 
        COUNT(*) as total_items,
        COUNT(CASE WHEN price > 0 THEN 1 END) as items_with_price,
        COUNT(CASE WHEN cost_price > 0 THEN 1 END) as items_with_cost,
        AVG(price) as avg_price,
        MAX(price) as max_price,
        MIN(price) as min_price
      FROM products
    `);
    const stats = statsRes.rows[0];
    console.log(`Total items: ${stats.total_items}`);
    console.log(`Items with price > 0: ${stats.items_with_price}`);
    console.log(`Items with cost_price > 0: ${stats.items_with_cost}`);
    console.log(`Average selling price: €${Number(stats.avg_price).toFixed(2)}`);
    console.log(`Price range: €${Number(stats.min_price).toFixed(2)} - €${Number(stats.max_price).toFixed(2)}`);

    // Check if products are DUPLICATES of cost_price
    console.log('\n═══ PRICE ISSUE DETECTION ═══');
    const issueRes = await client.query(`
      SELECT COUNT(*) as count
      FROM products 
      WHERE price = cost_price AND price > 0
    `);
    console.log(`Items where price = cost_price: ${issueRes.rows[0].count}`);
    if (issueRes.rows[0].count > 0) {
      console.log('⚠️  ISSUE FOUND: Some items have selling price equal to cost price!');
      const exampleRes = await client.query(`
        SELECT name, price, cost_price
        FROM products 
        WHERE price = cost_price AND price > 0
        LIMIT 3
      `);
      exampleRes.rows.forEach((row: any) => {
        console.log(`    - ${row.name}: price €${row.price} = cost_price €${row.cost_price}`);
      });
    }

    // Check if products cost_price is in price field
    console.log('\n═══ CSV DATA CHECK ═══');
    console.log('First, let me check a known item from your CSV:');
    const csvCheckRes = await client.query(`
      SELECT id, name, price, cost_price FROM products 
      WHERE LOWER(name) LIKE '%absolut%'
      LIMIT 1
    `);
    if (csvCheckRes.rowCount > 0) {
      const item = csvCheckRes.rows[0];
      console.log(`Item: ${item.name}`);
      console.log(`  Selling Price (price): €${item.price}`);
      console.log(`  Cost Price (cost_price): €${item.cost_price}`);
      console.log(`  Expected from CSV: Selling €3.00, Cost €1.67`);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
