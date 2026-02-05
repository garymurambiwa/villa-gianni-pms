
import { Pool } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Direct connection string (same as init_cloud_db.mjs)
const CONNECTION_STRING = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '../db/schema.sql');

async function main() {
    console.log('⚠ STARTING FULL DATABASE RESET ⚠');

    // Configure pool
    const pool = new Pool({ connectionString: CONNECTION_STRING });

    try {
        console.log('Connecting to Cloud DB...');

        // 1. Wipe the database
        console.log('Dropping public schema...');
        await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
        await pool.query('CREATE SCHEMA public');
        console.log('Schema wiped successfully.');

        // 2. Read Schema File
        const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
        console.log(`Read schema file (${schemaSql.length} bytes). Re-applying...`);

        // 3. Apply Schema
        await pool.query(schemaSql);
        console.log('✅ Database Schema successfully re-initialized!');

        // 4. Verify
        console.log('Verifying tables...');
        const res = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        console.log('Created Tables:', res.rows.map(r => r.table_name).join(', '));

    } catch (err) {
        console.error('❌ RESET FAILED:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
