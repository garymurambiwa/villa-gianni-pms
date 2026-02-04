
import { Pool } from '@neondatabase/serverless';
import { v4 as uuidv4 } from 'uuid';

const CONNECTION_STRING = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    console.log('Debugging POS Orders...');
    const pool = new Pool({ connectionString: CONNECTION_STRING });
    const tableNum = 'TEST_99';
    const items = JSON.stringify([{ id: '1', name: 'Test Item', price: 10 }]);
    const total = 10;
    const orderId = uuidv4();

    try {
        console.log('1. Checking if table exists...');
        const res = await pool.query("SELECT to_regclass('public.pos_orders')");
        if (!res.rows[0].to_regclass) {
            console.error('CRITICAL: Table public.pos_orders DOES NOT EXIST.');
            return;
        }
        console.log('Table exists.');

        console.log('2. Attempting INSERT with string for JSONB (Simulating current code)...');
        try {
            // Note: node-postgres usually handles string->jsonb if param is string, but let's see.
            // The code in DataContext uses: VALUES (?, ?, ?, ?, 'open') and passes stringified JSON.
            // src/lib/db.ts converts ? to $n.
            const insertSql = "INSERT INTO pos_orders (id, table_number, items, total_amount, status) VALUES ($1, $2, $3, $4, 'open')";
            const insertParams = [orderId, tableNum, items, total];
            await pool.query(insertSql, insertParams);
            console.log('SUCCESS: Inserted with string for JSONB.');

            // Cleanup
            await pool.query("DELETE FROM pos_orders WHERE id = $1", [orderId]);
        } catch (e) {
            console.error('FAILURE: Insert failed as expected/unexpected:', e.message);
        }

    } catch (err) {
        console.error('General Error:', err);
    } finally {
        await pool.end();
    }
}

main();
