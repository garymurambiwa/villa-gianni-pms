
import pg from 'pg';

const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    const pool = new pg.Pool({ connectionString: DB_URL });
    try {
        const client = await pool.connect();
        console.log('Connected');

        try {
            await client.query(`
                INSERT INTO inventory_items (id, name, selling_price, type, category, category_id) 
                VALUES ('TEST_SIMPLE', 'Simple Test Item', 10.0, 'restaurant', 'General', 'CAT_REST_GEN')
            `);
            console.log("Inserted 'Simple Test Item'");
        } catch (e) {
            console.log("Insert failed (might exist):", (e as Error).message);
        }

        client.release();
    } catch (err) {
        console.error('Connection failed:', err);
    } finally {
        await pool.end();
    }
}

main();
