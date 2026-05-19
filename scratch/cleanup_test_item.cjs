const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function cleanup() {
  try {
    console.log('Cleaning up test item MODE#001...');
    
    // Delete from products first (foreign keys or sync tables)
    const resProd = await pool.query(`DELETE FROM public.products WHERE id = 'MODE#001'`);
    console.log('Deleted from public.products:', resProd.rowCount);
    
    // Delete from inv_items
    const resInv = await pool.query(`DELETE FROM public.inv_items WHERE id = 'MODE#001'`);
    console.log('Deleted from public.inv_items:', resInv.rowCount);
    
    console.log('Cleanup completed successfully!');
  } catch (err) {
    console.error('Error during cleanup:', err.message);
  } finally {
    await pool.end();
  }
}

cleanup();
