import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env
dotenv.config({ path: join(__dirname, '../.env') });

const { Pool } = pg;
const connectionString = process.env.VITE_DATABASE_URL;

if (!connectionString) {
  console.error('Error: VITE_DATABASE_URL is not set in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function resetUsers() {
  const client = await pool.connect();
  try {
    console.log('--- SYSTEM USER RESET STARTED ---');
    await client.query('BEGIN');

    // 1. Purge all user-related tables
    console.log('Purging user-related tables...');
    await client.query('DELETE FROM login_attempts');
    await client.query('DELETE FROM access_logs');
    await client.query('DELETE FROM email_verifications');
    await client.query('DELETE FROM admins');
    await client.query('DELETE FROM profiles');
    await client.query('DELETE FROM app_users');

    // 2. Insert default admin
    console.log('Creating default admin user...');
    const adminId = `usr_admin_${Date.now()}`;
    const passwordHash = await bcrypt.hash('test123', 12);
    
    const insertAdminSql = `
      INSERT INTO app_users (
        id, username, email, name, role, password_hash, 
        active, password_change_required, is_verified, 
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, true, false, true, NOW(), NOW())
    `;
    
    await client.query(insertAdminSql, [
      adminId, 
      'admin', 
      'admin@villa-gianni.com', 
      'System Administrator', 
      'admin', 
      passwordHash
    ]);

    // 3. Mark as admin in admins table if necessary
    await client.query('INSERT INTO admins (user_id) VALUES ($1)', [adminId]);

    // 4. Create profile
    await client.query('INSERT INTO profiles (id, email, full_name, role, is_active) VALUES ($1, $2, $3, $4, true)', [
      adminId,
      'admin@villa-gianni.com',
      'System Administrator',
      'admin'
    ]);

    await client.query('COMMIT');
    console.log('--- RESET SUCCESSFUL ---');
    console.log('Default Admin: admin / test123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log('--- RESET FAILED ---');
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

resetUsers();
