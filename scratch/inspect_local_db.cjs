const { Pool } = require('pg');

async function checkLocal() {
  const localUrl = 'postgresql://postgres:postgres@localhost:5432/corepms_db';
  console.log('Connecting to local DB:', localUrl);
  const pool = new Pool({ connectionString: localUrl });
  
  try {
    const res = await pool.query(`
      SELECT 
        nspname AS schema_name,
        relname AS table_name,
        conname AS constraint_name, 
        pg_get_constraintdef(c.oid) AS constraint_definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE t.relname = 'inv_items';
    `);
    
    console.log('Local DB inv_items constraints:');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.log('Could not connect or query local DB:', err.message);
  } finally {
    await pool.end();
  }
}

checkLocal();
