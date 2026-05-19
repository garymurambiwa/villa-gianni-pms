const { Pool } = require('pg');

async function checkLocal() {
  const localUrl = 'postgresql://postgres:postgres@localhost:5432/corepms_db';
  console.log('Connecting to local DB:', localUrl);
  const pool = new Pool({ connectionString: localUrl });
  
  try {
    const res = await pool.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'public';
    `);
    
    console.log('Local DB tables:');
    console.log(res.rows.map(r => r.table_name));
  } catch (err) {
    console.log('Could not connect or query local DB:', err.message);
  } finally {
    await pool.end();
  }
}

checkLocal();
