/**
 * Script to check for existing inv_items_short_id_len constraint violations
 * Using local database configuration from .env
 */

const { Pool } = require('pg');
require('dotenv').config();

// Use local database configuration from .env
const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'corepms_db',
  password: process.env.PGPASSWORD || 'postgres',
  port: parseInt(process.env.PGPORT) || 5432,
  // No SSL for local connection
  ssl: false
});

async function checkShortIdViolations() {
  let client;
  
  try {
    console.log('Connecting to local database...');
    client = await pool.connect();
    console.log('Connected successfully');
    
    console.log('Checking for inv_items_short_id_len constraint violations...');
    
    // Check constraint definition
    const constraintQuery = `
      SELECT 
        conname AS constraint_name,
        pg_get_constraintdef(c.oid) AS constraint_definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE 
        n.nspname = 'public' 
        AND t.relname = 'inv_items'
        AND c.conname = 'inv_items_short_id_len';
    `;
    
    const constraintResult = await client.query(constraintQuery);
    if (constraintResult.rows.length > 0) {
      console.log('Current constraint definition:');
      console.table(constraintResult.rows);
    } else {
      console.log('Constraint inv_items_short_id_len not found!');
    }
    
    // Check for violations
    const violationQuery = `
      SELECT 
        id,
        short_id,
        char_length(short_id) as actual_length,
        CASE 
            WHEN short_id IS NULL THEN 'NULL'
            WHEN char_length(short_id) > 10 THEN 'TOO_LONG (>10)'
            ELSE 'VALID'
        END as validation_status
      FROM public.inv_items
      WHERE short_id IS NOT NULL 
      AND char_length(short_id) > 10
      ORDER BY char_length(short_id) DESC
      LIMIT 20;
    `;
    
    const violationResult = await client.query(violationQuery);
    
    if (violationResult.rows.length > 0) {
      console.log(`\nFOUND ${violationResult.rows.length} VIOLATIONS:`);
      console.table(violationResult.rows);
    } else {
      console.log('\nNO VIOLATIONS FOUND - All short_ids comply with constraint (<= 10 characters)');
    }
    
    // Show statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(short_id) as non_null_short_ids,
        MIN(char_length(short_id)) as min_length,
        MAX(char_length(short_id)) as max_length,
        AVG(char_length(short_id)) as avg_length
      FROM public.inv_items
      WHERE short_id IS NOT NULL;
    `;
    
    const statsResult = await client.query(statsQuery);
    console.log('\nStatistics:');
    console.table(statsResult.rows[0]);
    
  } catch (error) {
    console.error('Error checking violations:', error.message);
    console.error(error.stack);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

checkShortIdViolations();