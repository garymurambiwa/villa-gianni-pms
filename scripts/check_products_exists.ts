
import { db } from '../src/lib/db';
import dotenv from 'dotenv';
dotenv.config();

async function checkProductsTable() {
    try {
        const isReady = await db.waitForReady();
        if (!isReady) {
            console.error('Database connection failed.');
            return;
        }
        const res = await db.query("SELECT to_regclass('public.products')");
        console.log('Exists?', res.rows[0].to_regclass);
    } catch (err) {
        console.error('Error checking table:', err);
    }
}

checkProductsTable();
