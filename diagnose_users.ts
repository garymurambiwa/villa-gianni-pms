import { db } from './src/lib/db';

async function diagnose() {
  console.log('--- USER EMAIL DIAGNOSIS ---');
  const res = await db.query('SELECT id, username, email, is_deleted FROM app_users');
  if ('error' in res) {
    console.error('Query error:', res.error);
    return;
  }
  
  console.log(`Found ${res.rows.length} users:`);
  res.rows.forEach(r => {
    console.log(`- ID: ${r.id}, User: ${r.username}, Email: [${r.email}], Deleted: ${r.is_deleted}`);
  });
  
  const dupCheck = await db.query('SELECT email, COUNT(*) FROM app_users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1');
  if (!('error' in dupCheck) && dupCheck.rows.length > 0) {
    console.warn('!!! DUPLICATE EMAILS FOUND !!!');
    dupCheck.rows.forEach(r => console.log(`- Email: [${r.email}], Count: ${r.count}`));
  } else {
    console.log('No duplicate non-null emails found.');
  }
  console.log('--- END DIAGNOSIS ---');
}

diagnose();
