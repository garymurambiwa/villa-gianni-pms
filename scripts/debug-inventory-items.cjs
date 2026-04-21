#!/usr/bin/env node

/**
 * Debug inventory items vs stock quantities
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function debugInventoryItems() {
  const client = await pool.connect();

  try {
    console.log('=== INVENTORY ITEMS DEBUG ===');

    // Check items in inv_items table
    const itemsResult = await client.query(
      'SELECT id, name, category, is_active FROM public.inv_items ORDER BY name'
    );

    console.log(`\nItems in inv_items table (${itemsResult.rows.length}):`);
    itemsResult.rows.forEach(item => {
      console.log(`  ${item.id}: ${item.name} (${item.category}) - ${item.is_active ? 'ACTIVE' : 'INACTIVE'}`);
    });

    // Check items with stock
    const stockResult = await client.query(`
      SELECT DISTINCT i.id, i.name, i.category, SUM(sl.quantity_change) as total_stock
      FROM public.inv_items i
      JOIN public.inv_stock_ledger sl ON i.id = sl.item_id
      GROUP BY i.id, i.name, i.category
      HAVING SUM(sl.quantity_change) > 0
      ORDER BY i.name
    `);

    console.log(`\nItems with stock (${stockResult.rows.length}):`);
    stockResult.rows.forEach(item => {
      console.log(`  ${item.id}: ${item.name} (${item.category}) - Stock: ${item.total_stock}`);
    });

    // Check if there are items in stock that aren't in inv_items
    const orphanedStock = await client.query(`
      SELECT DISTINCT sl.item_id, SUM(sl.quantity_change) as total_stock
      FROM public.inv_stock_ledger sl
      LEFT JOIN public.inv_items i ON sl.item_id = i.id
      WHERE i.id IS NULL
      GROUP BY sl.item_id
      HAVING SUM(sl.quantity_change) > 0
    `);

    console.log(`\nOrphaned stock items (in ledger but not in items table) (${orphanedStock.rows.length}):`);
    orphanedStock.rows.forEach(item => {
      console.log(`  ${item.item_id}: Stock: ${item.total_stock}`);
    });

    // Test the API endpoint
    console.log('\n=== TESTING API ENDPOINT ===');
    try {
      const apiResponse = await fetch('http://localhost:3000/api/v1/inventory/items');
      console.log(`API Response status: ${apiResponse.status}`);

      if (apiResponse.ok) {
        const apiData = await apiResponse.json();
        console.log(`API returned ${apiData.data?.length || 0} items:`);
        if (apiData.data) {
          apiData.data.slice(0, 10).forEach((item, idx) => {
            console.log(`  ${idx + 1}. ${item.name} (${item.category}) - ${item.id}`);
          });
          if (apiData.data.length > 10) {
            console.log(`  ... and ${apiData.data.length - 10} more`);
          }
        }
      } else {
        const text = await apiResponse.text();
        console.log(`API Error: ${text.substring(0, 200)}...`);
      }
    } catch (error) {
      console.log(`API Call failed: ${error.message}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

debugInventoryItems().catch(console.error);