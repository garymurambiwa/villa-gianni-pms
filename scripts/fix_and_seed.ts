
import pg from 'pg';

const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    console.log('--- FIX AND SEED START ---');
    const pool = new pg.Pool({ connectionString: DB_URL, connectionTimeoutMillis: 10000 });

    try {
        const client = await pool.connect();
        console.log('[OK] Connected to Database');

        // 1. Ensure Table Exists
        await client.query(`
            CREATE TABLE IF NOT EXISTS inventory_items (
                id VARCHAR(255) PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT,
                stock_level NUMERIC DEFAULT 0,
                unit TEXT,
                cost_price NUMERIC DEFAULT 0,
                selling_price NUMERIC DEFAULT 0,
                type TEXT,
                category_id VARCHAR(50),
                min_stock_level NUMERIC DEFAULT 10,
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                inserted_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('[OK] Table inventory_items ensured');

        // 2. Ensure category_id column exists (redundant but safe)
        await client.query(`
            DO $$ 
            BEGIN 
                BEGIN
                    ALTER TABLE inventory_items ADD COLUMN category_id VARCHAR(50);
                EXCEPTION
                    WHEN duplicate_column THEN RAISE NOTICE 'column category_id already exists';
                END;
            END $$;
        `);
        console.log('[OK] Column category_id ensured');

        // 3. Seed Test Items
        const testItems = [
            ['TEST_BEER', 'Test Beer', 'Beverages', 'CAT_BAR_BEV', 100, 2.00, 5.00, 'bar'],
            ['TEST_BURGER', 'Test Burger', 'Mains', 'CAT_REST_MAIN', 100, 5.00, 15.00, 'restaurant'],
            ['TEST_DEV', 'Dev Special', 'General', 'CAT_REST_GEN', 100, 0, 10.00, 'restaurant']
        ];

        for (const item of testItems) {
            await client.query(`
                INSERT INTO inventory_items (id, name, category, category_id, stock_level, cost_price, selling_price, type, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    category = EXCLUDED.category,
                    category_id = EXCLUDED.category_id,
                    stock_level = EXCLUDED.stock_level,
                    cost_price = EXCLUDED.cost_price,
                    selling_price = EXCLUDED.selling_price,
                    type = EXCLUDED.type,
                    updated_at = NOW()
            `, item);
        }
        console.log(`[OK] Seeded ${testItems.length} test items`);

        // 4. Verify count
        const resCount = await client.query('SELECT COUNT(*) FROM inventory_items');
        console.log(`[VERIFY] Total rows: ${resCount.rows[0].count}`);

        client.release();
    } catch (err) {
        console.error('[ERROR] Fix failed:', err);
    } finally {
        await pool.end();
        console.log('--- FIX AND SEED END ---');
    }
}

main();
