import { Client } from 'pg';

const connectionString = 'postgres://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function run() {
    const client = new Client({ connectionString });
    await client.connect();

    try {
        console.log('Adding columns to products table...');

        const queries = [
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id VARCHAR(255)`,
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS sub_id VARCHAR(255)`,
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_sub_id VARCHAR(255)`,
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS notes TEXT`,
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS barcodes JSONB DEFAULT '[]'::jsonb`,
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS cos_percent NUMERIC(5,2) DEFAULT 0`,
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS gp_percent NUMERIC(5,2) DEFAULT 0`,
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS gp_amount NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS qty_received NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS image_bg_color VARCHAR(50)`,
            `ALTER TABLE products ADD COLUMN IF NOT EXISTS picture_data TEXT`,
        ];

        for (const q of queries) {
            await client.query(q);
            console.log(`Executed: ${q}`);
        }

        console.log('Columns added successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await client.end();
    }
}

run();
