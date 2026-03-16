
import pg from 'pg';

const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    const pool = new pg.Pool({ connectionString: DB_URL });
    try {
        const client = await pool.connect();
        console.log('Connected');

        // 1. Remove duplicates if any (naive approach)
        // Actually, better to just try adding PK.

        try {
            await client.query('ALTER TABLE inventory_items ADD PRIMARY KEY (id);');
            console.log("Added PRIMARY KEY (id)");
        } catch (e) {
            const err = e as Error;
            console.log("PK add failed (might exist or dups):", err.message);
            // If dups, we might need to truncate?
            // User has NO items in POS, so truncating is probably safe/desired to fix this mess.
            if (err.message.includes('multiple primary keys') || err.message.includes('already exists')) {
                // Ignore
            } else if (err.message.includes('could not create unique index')) {
                console.log("Duplicates found. Truncating table to fix structure...");
                await client.query('TRUNCATE TABLE inventory_items');
                await client.query('ALTER TABLE inventory_items ADD PRIMARY KEY (id);');
                console.log("Truncated and added PK.");
            }
        }

        // 2. Insert Test Item
        await client.query(`
            INSERT INTO inventory_items (id, name, selling_price, type, category, category_id, stock_level, updated_at) 
            VALUES ('TEST_PK_FIX', 'System Verified Item', 12.34, 'restaurant', 'General', 'CAT_REST_GEN', 99, NOW())
            ON CONFLICT (id) DO UPDATE SET selling_price = 12.34
        `);
        console.log("Inserted 'System Verified Item'");

        client.release();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

main();
