
const { db } = require('./src/lib/db'); // This might not work in node unless db is node-compatible
// Wait, local node script cannot import src/lib/db.ts directly if it uses specific browser/neon stuff.
// Use server/db-web.cjs instead?
// Or just use a raw pg connection.

const { Client } = require('pg');
require('dotenv').config();

async function checkProducts() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        const res = await client.query('SELECT id, name, price, category, department FROM products LIMIT 10');
        console.log('Products:', res.rows);

        const count = await client.query('SELECT COUNT(*) FROM products');
        console.log('Total count:', count.rows[0].count);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkProducts();
