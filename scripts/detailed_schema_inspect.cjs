const { Client } = require('pg');

const client = new Client('postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require');

async function inspectSchema() {
  await client.connect();
  const tables = ['inventory_periods', 'inventory_transactions', 'inventory_period_audit', 'products'];
  for (const table of tables) {
    console.log(`\n--- TABLE: ${table} ---`);
    try {
      const res = await client.query(`
        SELECT column_name, data_type, column_default, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = $1 
        ORDER BY ordinal_position
      `, [table]);
      
      if (res.rows.length === 0) {
        console.log('NOT FOUND');
        continue;
      }

      res.rows.forEach(r => {
        console.log(`${r.column_name}: ${r.data_type} (Default: ${r.column_default || 'NONE'}, Nullable: ${r.is_nullable})`);
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }
  await client.end();
}

inspectSchema().catch(console.error);
