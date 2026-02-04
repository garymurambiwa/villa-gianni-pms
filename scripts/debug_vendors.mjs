
import { Pool } from '@neondatabase/serverless';

const CONNECTION_STRING = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    console.log('Debugging Vendor Tables...');
    const pool = new Pool({ connectionString: CONNECTION_STRING });

    try {
        console.log('1. Checking if vendors table exists...');
        const res = await pool.query("SELECT to_regclass('public.vendors')");
        if (!res.rows[0].to_regclass) {
            console.error('CRITICAL: Table public.vendors DOES NOT EXIST.');
        } else {
            console.log('Table exists.');

            console.log('2. Attempting SELECT * FROM vendors...');
            try {
                const rows = await pool.query('SELECT * FROM vendors LIMIT 1');
                console.log('SUCCESS: Selected from vendors.', rows.rowCount, 'rows found.');
            } catch (e) {
                console.error('FAILURE: SELECT * FROM vendors failed:', e.message);
                console.error('Full Error:', e);
            }

            console.log('3. Checking columns...');
            try {
                const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'vendors'");
                console.log('Columns:', cols.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
            } catch (e) {
                console.error('Failed to list columns:', e.message);
            }
        }

        console.log('4. Checking inventory_items (for comparison)...');
        const inv = await pool.query("SELECT to_regclass('public.inventory_items')");
        console.log('inventory_items exists:', !!inv.rows[0].to_regclass);

    } catch (err) {
        console.error('General Error:', err);
    } finally {
        await pool.end();
    }
}

main();
