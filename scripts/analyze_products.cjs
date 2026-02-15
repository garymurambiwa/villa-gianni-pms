
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

async function analyzeProducts() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    let output = '';
    const log = (msg) => { console.log(msg); output += msg + '\n'; };

    try {
        await client.connect();
        log('Connected to DB');

        // Count total
        const countRes = await client.query('SELECT COUNT(*) FROM products');
        log(`Total products: ${countRes.rows[0].count}`);

        // Count with price > 0
        const priceRes = await client.query('SELECT COUNT(*) FROM products WHERE price > 0');
        log(`Products with price > 0: ${priceRes.rows[0].count}`);

        // Count with department = 'Restaurant' (case insensitive check)
        const deptRes = await client.query("SELECT COUNT(*) FROM products WHERE LOWER(department) = 'restaurant'");
        log(`Products with department 'restaurant' (case insensitive): ${deptRes.rows[0].count}`);

        // Count with price > 0 AND department 'Restaurant'
        const validRes = await client.query("SELECT COUNT(*) FROM products WHERE price > 0 AND LOWER(department) = 'restaurant'");
        log(`Valid Restaurant Items (price > 0): ${validRes.rows[0].count}`);

        // List some failing items
        const failRes = await client.query("SELECT name, price, department, category FROM products WHERE price <= 0 LIMIT 5");
        log('Sample items with price <= 0:');
        failRes.rows.forEach(r => log(JSON.stringify(r)));

        // List valid items
        const successRes = await client.query("SELECT name, price, department, category FROM products WHERE price > 0 AND LOWER(department) = 'restaurant' LIMIT 5");
        log('Sample VALID items:');
        successRes.rows.forEach(r => log(JSON.stringify(r)));

    } catch (err) {
        log(`Error: ${err}`);
    } finally {
        await client.end();
        fs.writeFileSync('product_analysis.txt', output, 'utf8');
    }
}

analyzeProducts();
