const { Client } = require('pg');

const client = new Client('postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require');

async function searchTables() {
  await client.connect();
  const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE '%stock%' OR table_name LIKE '%inventory%' OR table_name LIKE '%product%' OR table_name LIKE '%menu%')");
  console.log(res.rows.map(r => r.table_name).join('\n'));
  await client.end();
}

searchTables().catch(console.error);
