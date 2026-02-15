
const { Client } = require('pg');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.resolve(process.cwd(), '.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
for (const k in envConfig) {
    process.env[k] = envConfig[k];
}

async function checkProducts() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Neon usually needs SSL
    });

    try {
        await client.connect();
        console.log('Connected to DB');

        // Check count
        const countRes = await client.query('SELECT COUNT(*) FROM products');
        console.log('Total products:', countRes.rows[0].count);

        // Check some products
        const res = await client.query('SELECT id, name, price, cost_price, category, department, is_stock_item, active, visibility FROM products LIMIT 10');
        console.log('Sample Products:', JSON.stringify(res.rows, null, 2));

        // Check products that might be filtered out
        // selling_price > 0?
        // In DB it is 'price'
        const zeroPrice = await client.query('SELECT COUNT(*) FROM products WHERE price <= 0 OR price IS NULL');
        console.log('Products with price <= 0:', zeroPrice.rows[0].count);

        // Check distinct categories
        const cats = await client.query('SELECT DISTINCT category FROM products');
        console.log('Categories:', cats.rows.map(r => r.category));

        // Check distinct departments
        const depts = await client.query('SELECT DISTINCT department FROM products');
        console.log('Departments:', depts.rows.map(r => r.department));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkProducts();
