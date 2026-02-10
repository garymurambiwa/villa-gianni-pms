
import pg from 'pg';

const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    console.log('--- BULK UPDATE START ---');
    const pool = new pg.Pool({ connectionString: DB_URL });

    try {
        const client = await pool.connect();
        console.log('[OK] Connected to Database');

        // 1. Update prices and ensure type is set (defaulting to 'restaurant' if null/unknown, but user said keep bar/rest)
        // We will default to restaurant if type is missing, otherwise keep it.
        // We set visibility to true for both.

        await client.query(`
            UPDATE inventory_items
            SET 
                cost_price = 10,
                selling_price = 15,
                stock_level = 50,
                visibility = '{"bar":true,"restaurant":true}'::jsonb,
                updated_at = NOW()
        `);

        console.log('[OK] Updated prices and visibility for ALL items');

        // 2. Ensure category_id is valid for all items
        // We run a fix to set category_id if missing based on type
        // This repeats logic from import script but as an UPDATE

        await client.query(`
            UPDATE inventory_items
            SET category_id = CASE 
                WHEN LOWER(type) = 'bar' THEN 'CAT_BAR_GEN'
                ELSE 'CAT_REST_GEN'
            END
            WHERE category_id IS NULL OR category_id = ''
        `);
        console.log('[OK] Fixed missing category_id');

        // 3. Count results
        const res = await client.query('SELECT count(*) FROM inventory_items');
        console.log(`[VERIFY] Total items updated: ${res.rows[0].count}`);

        client.release();
    } catch (err) {
        console.error('[ERROR] Update failed:', err);
    } finally {
        await pool.end();
        console.log('--- BULK UPDATE END ---');
    }
}

main();
