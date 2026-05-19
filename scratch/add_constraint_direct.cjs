const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    console.log('Running ALTER TABLE public.inv_items ADD CONSTRAINT...');
    const res = await pool.query(
      `ALTER TABLE public.inv_items ADD CONSTRAINT inv_items_short_id_len CHECK (short_id IS NULL OR char_length(short_id) <= 10);`
    );
    console.log('Success:', res);
  } catch (err) {
    console.error('Error occurred:', err.message);
    
    // Let's print out all rows in inv_items that have short_id length > 10
    const rows = await pool.query(`
      SELECT id, name, short_id, char_length(short_id) as len
      FROM public.inv_items
      WHERE char_length(short_id) > 10;
    `);
    console.log('Rows violating the constraint:', rows.rows);
  } finally {
    await pool.end();
  }
}

check();
