const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function drop() {
  try {
    console.log('Attempting to drop constraint inv_items_short_len...');
    const res1 = await pool.query(`ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS inv_items_short_len;`);
    console.log('Result for inv_items_short_len:', res1);

    console.log('Attempting to drop constraint inv_items_short_id_len...');
    const res2 = await pool.query(`ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS inv_items_short_id_len;`);
    console.log('Result for inv_items_short_id_len:', res2);
    
  } catch (err) {
    console.error('Error occurred:', err.message);
  } finally {
    await pool.end();
  }
}

drop();
