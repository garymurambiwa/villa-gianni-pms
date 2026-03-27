import pg from 'pg';
const { Client } = pg;

const connectionString = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function run() {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    console.log('--- DATABASE REPAIR ---');
    const res = await client.query("UPDATE app_users SET email = NULL WHERE email = '' OR email = ' ' OR email ~ '^\\s*$'");
    console.log(`Updated ${res.rowCount} users.`);
    
    const check = await client.query("SELECT id, username, email FROM app_users WHERE email IS NULL OR email = ''");
    console.log('\nFinal state:');
    check.rows.forEach(r => console.log(`- User: ${r.username}, Email: [${r.email}]`));
    
    console.log('--- END REPAIR ---');
  } finally {
    await client.end();
  }
}

run().catch(console.error);
