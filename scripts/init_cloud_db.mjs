
import { Pool, neonConfig } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Direct connection string (from main.cjs / db.ts)
const CONNECTION_STRING = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '../db/schema.sql');

async function main() {
    console.log('Initializing Cloud Database...');

    // Configure for direct WebSocket connection if needed (node environment usually handles TCP fine, but serverless driver defaults to WS)
    // neonConfig.fetchConnectionCache = true; 

    const pool = new Pool({ connectionString: CONNECTION_STRING });

    try {
        const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
        console.log(`Read schema file (${schemaSql.length} bytes). Executing...`);

        // Split by statement if needed, but pg usually handles semi-colon separated blocks if they are valid.
        // However, some drivers are strict. Let's try executing the whole block.
        // If it fails, we might need to split by ';'.

        await pool.query(schemaSql);
        console.log('Schema applied successfully!');

    } catch (err) {
        console.error('Failed to apply schema:', err);
    } finally {
        await pool.end();
    }
}

main();
