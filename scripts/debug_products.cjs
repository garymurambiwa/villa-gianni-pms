
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

// Simple .env parser to avoid dotenv issues
const envPath = path.join(__dirname, '..', '.env');
let connectionString = process.env.DATABASE_URL;

if (!connectionString && fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    if (match) connectionString = match[1].trim();
}

console.log('Using connection string:', connectionString ? connectionString.replace(/:[^:@]+@/, ':***@') : 'NONE');

async function run() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query('SELECT id, name, department, category, price, stock_level FROM products LIMIT 5');
        console.log('--- PRODUCTS DUMP ---');
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
