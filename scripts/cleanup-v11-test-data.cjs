#!/usr/bin/env node

/**
 * Clean up v11 inventory test data
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function cleanup() {
  const client = await pool.connect();
  try {
    console.log('🧹 Cleaning up v11 inventory test data...');

    await client.query('BEGIN');

    // Delete in correct order to respect foreign keys
    await client.query('DELETE FROM public.inv_variance_lines');
    await client.query('DELETE FROM public.inv_variance_reports');
    await client.query('DELETE FROM public.inv_recipe_lines');
    await client.query('DELETE FROM public.inv_recipes');
    await client.query('DELETE FROM public.inv_stock_ledger');
    await client.query('DELETE FROM public.inv_transfer_lines');
    await client.query('DELETE FROM public.inv_transfer_headers');
    await client.query('DELETE FROM public.inv_grn_lines');
    await client.query('DELETE FROM public.inv_grn_headers');

    // Note: Sequences will auto-increment from existing values

    await client.query('COMMIT');
    console.log('✅ Test data cleanup complete');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Cleanup failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanup().catch(console.error);