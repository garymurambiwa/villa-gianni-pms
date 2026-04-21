const { Pool } = require('pg');
require('dotenv').config();

async function checkSchema() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'inv_uom_definitions' 
      OR table_name = 'inv_items'
      ORDER BY table_name, column_name
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

checkSchema();
