const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkSchema() {
  const client = await pool.connect();
  try {
    // Check what inv_ tables exist
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'inv_%'
      ORDER BY table_name
    `);

    console.log('Existing inv_ tables:');
    tablesResult.rows.forEach(row => {
      console.log(`  ${row.table_name}`);
    });

    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inv_items'
      ORDER BY ordinal_position
    `);

    console.log('inv_items columns:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

    const hasSku = result.rows.some(row => row.column_name === 'sku');
    console.log(`Has SKU column: ${hasSku}`);
  } finally {
    client.release();
    await pool.end();
  }
}

checkSchema().catch(console.error);