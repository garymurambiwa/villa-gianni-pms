import { Client } from 'pg';

const connectionString = 'postgres://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function verify() {
    const client = new Client({ connectionString });
    console.log('Connecting to database...');
    await client.connect();

    try {
        // Check if products table exists
        const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'products'
    `);

        if (res.rows.length === 0) {
            console.error('❌ Products table does not exist!');
            return;
        }

        console.log('✅ Products table exists with columns:');
        const cols = new Set(res.rows.map(r => r.column_name));
        res.rows.forEach(r => console.log(` - ${r.column_name} (${r.data_type})`));

        // Check for critical new columns
        const required = ['category_id', 'barcodes', 'notes', 'cos_percent'];
        const missing = required.filter(c => !cols.has(c));

        if (missing.length > 0) {
            console.error('❌ Missing columns:', missing.join(', '));
        } else {
            console.log('✅ All new columns check out.');
        }

        // Check row count
        const countRes = await client.query('SELECT COUNT(*) FROM products');
        console.log(`✅ Products count: ${countRes.rows[0].count}`);

        // Check a sample for data integrity
        const sample = await client.query('SELECT * FROM products LIMIT 1');
        if (sample.rows.length > 0) {
            console.log('✅ Sample product:', sample.rows[0]);
        }

    } catch (err: any) {
        console.error('Verification failed:', err);
    } finally {
        await client.end();
    }
}

verify();
