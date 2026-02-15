
import { db } from '../src/lib/db';
import dotenv from 'dotenv';
import path from 'path';

// Use local .env explicitly
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function debugProducts() {
    try {
        const isConfigured = await db.isConfigured();
        if (!isConfigured) {
            console.error('Database configuration failed');
            return;
        }

        const res = await db.query(
            `SELECT id, name, price, cost_price, stock_level, department, category, active FROM products LIMIT 5`
        );

        console.log('Database URL:', process.env.DATABASE_URL);
        console.log('--- PRODUCTS DUMP (First 5) ---');
        console.log(JSON.stringify(res.rows, null, 2));

    } catch (err) {
        console.error('Error debugging products:', err);
    }
}

debugProducts();
