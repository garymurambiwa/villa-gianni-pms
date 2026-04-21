#!/usr/bin/env node

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function testDatabase() {
  console.log('Testing database connection...');

  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    console.log('✅ Pool created');

    const client = await pool.connect();
    console.log('✅ Client connected');

    // Simple test query
    const result = await client.query('SELECT COUNT(*) as count FROM public.inv_items');
    console.log(`✅ Query successful: ${result.rows[0].count} items in database`);

    // Test the actual query used in API
    const apiQuery = `
      SELECT
        i.id,
        i.name,
        i.category,
        '' as sku,
        '' as barcode,
        u.code as base_uom_symbol,
        i.weighted_avg_cost
      FROM public.inv_items i
      LEFT JOIN public.inv_uom_definitions u ON i.base_uom_id = u.id
      WHERE i.is_active = true
      ORDER BY i.name
      LIMIT 50
    `;

    const apiResult = await client.query(apiQuery);
    console.log(`✅ API query successful: ${apiResult.rows.length} rows returned`);

    if (apiResult.rows.length > 0) {
      console.log('Sample rows:');
      apiResult.rows.slice(0, 3).forEach((row, idx) => {
        console.log(`  ${idx + 1}. ${row.name} (${row.category}) - UOM: ${row.base_uom_symbol}`);
      });
    }

    client.release();
    await pool.end();
    console.log('✅ Database test completed successfully');

  } catch (error) {
    console.error('❌ Database test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

testDatabase();