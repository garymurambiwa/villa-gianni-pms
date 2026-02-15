
import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Load .env explicitly
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

async function debugProducts() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL missing');
        return;
    }

    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(
            `SELECT id, name, price, cost_price, stock_level, department, category, active FROM products LIMIT 5`
        );
        console.log('--- PRODUCTS DUMP (First 5) ---');
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error debugging products:', err);
    } finally {
        await client.end();
    }
}

debugProducts();
