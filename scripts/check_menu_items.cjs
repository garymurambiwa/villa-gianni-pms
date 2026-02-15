
const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

const client = new Client({
    connectionString: process.env.DATABASE_URL,
});

async function checkMenuItems() {
    try {
        await client.connect();
        console.log('Connected to database');

        const res = await client.query('SELECT COUNT(*) FROM menu_items');
        console.log(`Count in menu_items: ${res.rows[0].count}`);

        if (parseInt(res.rows[0].count) > 0) {
            const rows = await client.query('SELECT * FROM menu_items LIMIT 5');
            console.log('Sample rows:', rows.rows);
        } else {
            console.log('menu_items table is empty.');
        }

        // Also check products table count for comparison
        const productsRes = await client.query('SELECT COUNT(*) FROM products');
        console.log(`Count in products: ${productsRes.rows[0].count}`);

    } catch (err) {
        console.error('Error executing query', err);
    } finally {
        await client.end();
    }
}

checkMenuItems();
