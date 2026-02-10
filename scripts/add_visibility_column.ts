
import pg from 'pg';

const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    const pool = new pg.Pool({ connectionString: DB_URL });
    try {
        const client = await pool.connect();
        console.log('Connected');

        await client.query(`
            ALTER TABLE inventory_items 
            ADD COLUMN IF NOT EXISTS visibility JSONB DEFAULT '{"bar":true,"restaurant":true}';
        `);
        console.log('Added visibility column');

        client.release();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

main();
