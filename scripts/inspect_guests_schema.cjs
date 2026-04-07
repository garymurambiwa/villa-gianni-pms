const { Client } = require('pg');

const client = new Client('postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require');

async function inspectGuestsSchema() {
  await client.connect();
  try {
    const res = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'guests'
      ORDER BY ordinal_position;
    `);
    console.log('GUESTS SCHEMA:', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Inspection failed:', err);
  } finally {
    await client.end();
  }
}

inspectGuestsSchema();
