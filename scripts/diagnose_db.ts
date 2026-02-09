
import pg from 'pg';

const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    console.log('--- DB DIAGNOSTICS START ---');
    const pool = new pg.Pool({ connectionString: DB_URL, connectionTimeoutMillis: 5000 });

    try {
        const client = await pool.connect();
        console.log('[OK] Connected to Database');

        // 1. Check table existence
        const resTable = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'inventory_items'
            );
        `);
        const tableExists = resTable.rows[0]?.exists;
        console.log(`[CHECK] Table 'inventory_items' exists: ${tableExists}`);

        if (tableExists) {
            // 2. Check columns
            const resCols = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'inventory_items';
            `);
            console.log('[CHECK] Columns:', resCols.rows.map(r => r.column_name + '(' + r.data_type + ')').join(', '));

            const hasCatId = resCols.rows.some(r => r.column_name === 'category_id');
            console.log(`[CHECK] Has 'category_id' column: ${hasCatId}`);

            // 3. Count rows
            const resCount = await client.query('SELECT COUNT(*) FROM inventory_items');
            console.log(`[CHECK] Row count: ${resCount.rows[0]?.count}`);

            // 4. Sample rows
            const resSample = await client.query('SELECT id, name, category, category_id, selling_price FROM inventory_items LIMIT 3');
            console.log('[DATA] Sample rows:', JSON.stringify(resSample.rows, null, 2));
        }

        client.release();
    } catch (err) {
        console.error('[ERROR] Database Error:', err);
    } finally {
        await pool.end();
        console.log('--- DB DIAGNOSTICS END ---');
    }
}

main();
