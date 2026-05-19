const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  try {
    console.log('Connecting to Neon DB...');
    console.log('DB URL:', process.env.DATABASE_URL.split('@')[1]); // Safe logging
    
    // Check constraints on inv_items
    const res = await pool.query(`
      SELECT 
        conname AS constraint_name,
        pg_get_constraintdef(c.oid) AS constraint_definition
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      JOIN pg_class cl ON cl.oid = c.conrelid
      WHERE cl.relname = 'inv_items' AND n.nspname = 'public'
    `);
    
    console.log('Constraints on Neon inv_items:', res.rows);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
