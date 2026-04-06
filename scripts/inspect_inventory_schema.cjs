const { Client } = require('pg');

const client = new Client('postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require');

async function inspectColumns() {
  await client.connect();
  const tables = ['products', 'inventory_transactions', 'accounting_periods'];
  for (const table of tables) {
    console.log(`--- Table: ${table} ---`);
    try {
      const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1", [table]);
      if (res.rows.length === 0) {
        console.log('No columns found (table might not exist).');
      } else {
        console.log(res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
      }
    } catch (err) {
      console.error(`Error inspecting ${table}:`, err.message);
    }
  }
  await client.end();
}

inspectColumns().catch(console.error);
