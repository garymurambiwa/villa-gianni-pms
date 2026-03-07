/**
 * ============================================================
 * init_new_hotel_db.mjs
 * ============================================================
 * Initialises a brand-new hotel database with the full schema.
 *
 * Usage:
 *   node scripts/init_new_hotel_db.mjs "postgresql://user:pass@host/db?sslmode=require"
 *
 * The connection string must be a valid Neon (or PostgreSQL) URL.
 * It is safe to run multiple times — all CREATE TABLE / CREATE INDEX
 * statements use IF NOT EXISTS so it will not destroy existing data.
 * ============================================================
 */

import { Pool } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 1. Read the connection string from CLI args ──────────────
const connectionString = process.argv[2];
if (!connectionString) {
    console.error('\n❌  No connection string provided.\n');
    console.error('Usage:');
    console.error('  node scripts/init_new_hotel_db.mjs "postgresql://user:pass@host/db?sslmode=require"\n');
    process.exit(1);
}

if (!connectionString.startsWith('postgresql://') && !connectionString.startsWith('postgres://')) {
    console.error('\n❌  Invalid connection string. Must start with postgresql:// or postgres://\n');
    process.exit(1);
}

// ── 2. Load the master schema ────────────────────────────────
const SCHEMA_PATH = path.join(__dirname, '../db/schema.sql');
if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`\n❌  Schema file not found at: ${SCHEMA_PATH}\n`);
    process.exit(1);
}

const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
console.log(`\n📄  Loaded schema (${(schemaSql.length / 1024).toFixed(1)} KB)\n`);

// ── 3. Connect & apply schema ────────────────────────────────
const pool = new Pool({ connectionString });

async function main() {
    const client = await pool.connect();
    console.log('✅  Connected to database.');

    try {
        await client.query('BEGIN');
        console.log('⚙️   Applying schema...');
        await client.query(schemaSql);
        await client.query('COMMIT');
        console.log('\n✅  Schema applied successfully!\n');

        // ── 4. Verify key tables ─────────────────────────────────
        const CHECK_TABLES = [
            'reservations',
            'rooms',
            'guests',
            'app_users',     // auth users table
            'pos_orders',
            'menu_items',    // POS products/menu
            'folios',
            'pos_shifts',
        ];

        console.log('🔍  Verifying tables...');
        for (const table of CHECK_TABLES) {
            const res = await client.query(
                `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        )`,
                [table]
            );
            const exists = res.rows[0].exists;
            console.log(`    ${exists ? '✅' : '❌'}  ${table}`);
        }

        console.log('\n🎉  Database is ready for the new hotel!');
        console.log('\nNext step → set this DATABASE_URL in your Vercel project:');
        // Mask the password for display
        const masked = connectionString.replace(/:([^@]+)@/, ':***@');
        console.log(`   ${masked}\n`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('\n❌  Failed to apply schema:');
        console.error('    ', err.message);
        console.error('\nThe transaction was rolled back. The database is unchanged.\n');
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
