const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    console.log('--- Table Counts ---');
    
    const tables = [
      'pos_bills',
      'inventory_items',
      'inventory_movements',
      'inv_items',
      'inv_stock_ledger',
      'inv_grn_headers'
    ];

    for (const table of tables) {
      try {
        const res = await pool.query(`SELECT COUNT(*) FROM public.${table}`);
        console.log(`${table}: ${res.rows[0].count}`);
      } catch (e) {
        console.log(`${table}: ERROR (${e.message})`);
      }
    }

    console.log('\n--- Recent POS Bills ---');
    const bills = await pool.query('SELECT opened_at, total_amount, outlet FROM public.pos_bills ORDER BY opened_at DESC LIMIT 5');
    console.table(bills.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
