const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    console.log('--- Checking alternative tables ---');
    
    const tables = [
      'orders',
      'order_items',
      'pos_orders',
      'pos_bills'
    ];

    for (const table of tables) {
      try {
        const res = await pool.query(`SELECT COUNT(*) FROM public.${table}`);
        console.log(`${table}: ${res.rows[0].count}`);
      } catch (e) {
        console.log(`${table}: ERROR (${e.message})`);
      }
    }

    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('\n--- All Public Tables ---');
    console.log(res.rows.map(r => r.table_name).join(', '));

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
