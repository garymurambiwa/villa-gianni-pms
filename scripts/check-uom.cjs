#!/usr/bin/env node

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkUOMTable() {
  const client = await pool.connect();

  try {
    // Check columns in inv_uom_definitions
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inv_uom_definitions'
      ORDER BY ordinal_position
    `);

    console.log('inv_uom_definitions columns:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

  } finally {
    client.release();
    await pool.end();
  }
}

checkUOMTable().catch(console.error);