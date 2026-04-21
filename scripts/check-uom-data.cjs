#!/usr/bin/env node

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkUOMData() {
  const client = await pool.connect();

  try {
    console.log('=== UOM DEFINITIONS DATA ===');

    // Check what data exists in inv_uom_definitions
    const result = await client.query(
      'SELECT id, code, name FROM public.inv_uom_definitions ORDER BY code'
    );

    console.log(`Found ${result.rows.length} UOM definitions:`);
    result.rows.forEach(row => {
      console.log(`  ${row.id}: ${row.code} (${row.name})`);
    });

    // Check what base_uom_id values exist in inv_items
    const itemsResult = await client.query(
      'SELECT DISTINCT base_uom_id FROM public.inv_items ORDER BY base_uom_id'
    );

    console.log(`\nBase UOM IDs used in items:`);
    itemsResult.rows.forEach(row => {
      console.log(`  ${row.base_uom_id}`);
    });

  } finally {
    client.release();
    await pool.end();
  }
}

checkUOMData().catch(console.error);