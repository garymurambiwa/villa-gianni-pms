const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/corepms_db'
});

async function run() {
  try {
    console.log('Connecting to LOCAL postgres corepms_db...');
    
    // Check tables
    const tablesRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log('All local tables:', tables);
    
    const hasInvItems = tables.includes('inv_items');
    console.log('Does inv_items exist in local DB?', hasInvItems);
    
    if (hasInvItems) {
      // Check constraints
      const constraintsRes = await pool.query(`
        SELECT 
          tc.constraint_name, 
          tc.constraint_type,
          cc.check_clause
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.check_constraints cc 
          ON tc.constraint_name = cc.constraint_name
        WHERE tc.table_name = 'inv_items'
      `);
      console.log('Constraints on local inv_items:', constraintsRes.rows);
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
