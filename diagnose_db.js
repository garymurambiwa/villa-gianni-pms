import pg from 'pg';
const { Client } = pg;

const connectionString = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function run() {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    console.log('--- DATABASE DIAGNOSIS ---');
    
    const res = await client.query("SELECT id, username, email, active, is_deleted FROM app_users WHERE username ILIKE 'belinda%' OR email = '' OR email IS NULL OR email LIKE '%belinda%'");
    console.log('Relevant users:');
    res.rows.forEach(r => {
      console.log(`- ID: ${r.id}, Username: "${r.username}", Email: [${r.email}], Active: ${r.active}, Deleted: ${r.is_deleted}`);
    });

    const allWithEmpty = await client.query("SELECT id, username, email FROM app_users WHERE email = '' OR email = ' '");
    if (allWithEmpty.rows.length > 0) {
       console.log('\nUsers with empty string emails:');
       allWithEmpty.rows.forEach(r => console.log(`- ID: ${r.id}, Username: ${r.username}, Email: [${r.email}]`));
    } else {
       console.log('\nNo users with literal empty string emails found.');
    }

    const nullCount = await client.query("SELECT COUNT(*) FROM app_users WHERE email IS NULL");
    console.log(`\nUsers with NULL email: ${nullCount.rows[0].count}`);

    const dups = await client.query("SELECT email, COUNT(*) FROM app_users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1");
    if (dups.rows.length > 0) {
      console.log('\nDuplicate non-null emails:');
      dups.rows.forEach(r => console.log(`- Email: [${r.email}], Count: ${r.count}`));
    }
    
    console.log('--- END DIAGNOSIS ---');
  } finally {
    await client.end();
  }
}

run().catch(console.error);
