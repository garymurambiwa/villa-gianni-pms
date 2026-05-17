
const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  const res = await pool.query("SELECT items FROM pos_orders WHERE status = 'closed' LIMIT 5");
  res.rows.forEach((row, i) => {
    console.log(`Order ${i} items:`, JSON.stringify(row.items, null, 2));
  });
  await pool.end();
}
run();
