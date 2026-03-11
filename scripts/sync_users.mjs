import { Client } from 'pg';

async function main() {
  const LOCAL_DB = process.env.VITE_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/corepms_db';
  const ONLINE_DB = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

  console.log("Connecting to Local DB...");
  const localClient = new Client({ connectionString: LOCAL_DB });
  
  console.log("Connecting to Online DB...");
  const onlineClient = new Client({ connectionString: ONLINE_DB });

  try {
    await localClient.connect();
    await onlineClient.connect();

    console.log("Fetching local users...");
    const { rows: localUsers } = await localClient.query('SELECT * FROM app_users');
    
    if (localUsers.length === 0) {
      console.log("No local users found to copy. Aborting sync.");
      return;
    }

    console.log(`Found ${localUsers.length} local users. Pushing to Online DB...`);

    // Wipe online users to ensure a clean slate
    await onlineClient.query('DELETE FROM app_users');

    for (const user of localUsers) {
      // Just copy the bare minimum to get logins working again
      await onlineClient.query(`
        INSERT INTO app_users (id, username, name, role, password_hash, active, password_change_required, failed_attempts) 
        VALUES ($1, $2, $3, $4, $5, true, false, 0)
        ON CONFLICT (id) DO UPDATE SET 
          password_hash = EXCLUDED.password_hash,
          failed_attempts = 0,
          lockout_until = NULL
      `, [user.id, user.username, user.name, user.role, user.password_hash]);
    }

    console.log("✅ Successfully synced local users to online database!");
    console.log("You should now be able to log in online with the exact same password you use locally.");

  } catch (err) {
    console.error("Sync failed:", err);
  } finally {
    await localClient.end();
    await onlineClient.end();
  }
}

main();
