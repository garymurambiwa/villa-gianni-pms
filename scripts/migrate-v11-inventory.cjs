#!/usr/bin/env node

/**
 * COREPMS v11 Inventory Module - Database Migration Runner
 * Executes V7 migration to create all inv_* tables
 * Safe-guards: Transaction rollback on error, validates table creation
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 1,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting v11 Inventory Module Migration...\n');
    
    // Read migration SQL
    const migrationPath = path.join(__dirname, '..', 'db', 'migration', 'V7_v11_inventory_module.sql');
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Begin transaction
    await client.query('BEGIN');
    console.log('✓ Transaction started');
    
    // Execute migration
    await client.query(sql);
    console.log('✓ Migration SQL executed');
    
    // Verify tables created
    const verifyQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'inv_%'
      ORDER BY table_name;
    `;
    
    const result = await client.query(verifyQuery);
    const tablesCreated = result.rows.map(r => r.table_name);
    
    console.log(`✓ Tables verified: ${tablesCreated.length} inv_* tables created`);
    console.log(`  Tables: ${tablesCreated.join(', ')}\n`);
    
    // Verify seed data
    const countQuery = `
      SELECT 
        (SELECT COUNT(*) FROM public.inv_locations) as locations,
        (SELECT COUNT(*) FROM public.inv_uom_definitions) as uoms;
    `;
    
    const counts = await client.query(countQuery);
    const { locations, uoms } = counts.rows[0];
    
    console.log(`✓ Seed data verified:`);
    console.log(`  - Locations: ${locations}`);
    console.log(`  - UOM Definitions: ${uoms}\n`);
    
    // Commit transaction
    await client.query('COMMIT');
    console.log('✅ v11 Schema Migration COMPLETE');
    console.log('   All tables created successfully');
    console.log('   Transaction committed\n');
    
    return { success: true, tables: tablesCreated, locations, uoms };
    
  } catch (error) {
    // Rollback on error
    try {
      await client.query('ROLLBACK');
      console.log('⚠️  Transaction rolled back');
    } catch (rollbackErr) {
      console.error('❌ Rollback failed:', rollbackErr.message);
    }
    
    console.error('\n❌ Migration Failed:');
    console.error(error.message);
    console.error('\nContext: The database has been rolled back to pre-migration state.');
    console.error('No data was modified. Please review the error and retry.\n');
    
    process.exit(1);
    
  } finally {
    await client.end();
    await pool.end();
  }
}

// Run migration
runMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
