
import pg from 'pg';

const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    const pool = new pg.Pool({ connectionString: DB_URL });
    const client = await pool.connect();

    try {
        console.log('Adding selling_price column to inventory_items...');

        await client.query(`
      ALTER TABLE inventory_items 
      ADD COLUMN IF NOT EXISTS selling_price DECIMAL(10,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'general';
    `);

        console.log('Success: selling_price column added.');
    } catch (err) {
        console.error('Error adding column:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
