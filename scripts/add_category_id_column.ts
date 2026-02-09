
import pg from 'pg';

const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    const pool = new pg.Pool({ connectionString: DB_URL });
    try {
        const client = await pool.connect();
        console.log('Connected to Database');

        await client.query(`
            ALTER TABLE inventory_items 
            ADD COLUMN IF NOT EXISTS category_id VARCHAR(50);
        `);
        console.log('Added category_id column');

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

main();
