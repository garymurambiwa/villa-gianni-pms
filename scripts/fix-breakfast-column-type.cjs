#!/usr/bin/env node

/**
 * Script to fix breakfast package column type inconsistency
 * Converts applicable_room_types from text[] to jsonb if needed
 */

const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.production') });

async function fixColumnType() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'corepms',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Check current column type
    const columnInfo = await client.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns 
      WHERE table_name = 'breakfast_packages' 
      AND column_name = 'applicable_room_types'
    `);

    if (columnInfo.rows.length === 0) {
      console.log('breakfast_packages table or applicable_room_types column not found');
      return;
    }

    const currentType = columnInfo.rows[0].udt_name;
    console.log(`Current column type: ${currentType}`);

    if (currentType === 'jsonb') {
      console.log('Column is already jsonb - no conversion needed');
      return;
    }

    if (currentType !== '_text') {
      console.log(`Unexpected column type: ${currentType}`);
      return;
    }

    console.log('Converting applicable_room_types from text[] to jsonb...');

    // Start transaction
    await client.query('BEGIN');

    // Add temporary column
    await client.query(`
      ALTER TABLE public.breakfast_packages 
      ADD COLUMN applicable_room_types_temp JSONB DEFAULT '[]'::JSONB
    `);

    // Copy and convert data
    await client.query(`
      UPDATE public.breakfast_packages 
      SET applicable_room_types_temp = COALESCE(
        CASE 
          WHEN applicable_room_types IS NULL THEN '[]'::JSONB
          ELSE to_jsonb(applicable_room_types)
        END,
        '[]'::JSONB
      )
    `);

    // Drop old column
    await client.query(`
      ALTER TABLE public.breakfast_packages 
      DROP COLUMN applicable_room_types
    `);

    // Rename temp column
    await client.query(`
      ALTER TABLE public.breakfast_packages 
      RENAME COLUMN applicable_room_types_temp TO applicable_room_types
    `);

    // Commit transaction
    await client.query('COMMIT');
    console.log('Successfully converted applicable_room_types to jsonb');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error converting column type:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the fix
if (require.main === module) {
  fixColumnType()
    .then(() => {
      console.log('Column type fix completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Column type fix failed:', error);
      process.exit(1);
    });
}

module.exports = { fixColumnType };