const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
let connectionString = process.env.DATABASE_URL;

if (!connectionString && fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    if (match) connectionString = match[1].trim();
}

const client = new Client({ connectionString });

async function main() {
    await client.connect();

    console.log('=== ANALYZING VISIBLE vs INVISIBLE ITEMS ===\n');

    // Check the 3 visible items
    const visibleNames = ['BILTONG', 'BLACK LABEL'];
    for (const searchTerm of visibleNames) {
        const res = await client.query(
            'SELECT name, department, category, price, active, visibility FROM products WHERE name ILIKE $1',
            [`%${searchTerm}%`]
        );
        console.log(`\nFound ${res.rows.length} items matching "${searchTerm}":`);
        res.rows.forEach(p => {
            console.log(`  - ${p.name}: dept="${p.department}", cat="${p.category}", price=${p.price}, active=${p.active}`);
            if (p.visibility) {
                console.log(`    visibility=${typeof p.visibility === 'string' ? p.visibility : JSON.stringify(p.visibility)}`);
            }
        });
    }

    // Get all products and group by department/category
    const allRes = await client.query('SELECT department, category, COUNT(*) as count FROM products WHERE active=true GROUP BY department, category');
    console.log('\n\n=== PRODUCT BREAKDOWN ===');
    allRes.rows.forEach(r => {
        console.log(`${r.department || 'NULL'} / ${r.category || 'NULL'}: ${r.count} items`);
    });

    // Sample a few items from each category
    console.log('\n\n=== SAMPLE ITEMS FROM EACH CATEGORY ===');
    const sampleRes = await client.query(`
        SELECT DISTINCT ON (department, category) name, department, category, price, active
        FROM products
        WHERE active = true
        ORDER BY department, category, name
        LIMIT 10
    `);
    sampleRes.rows.forEach(p => {
        console.log(`${p.name}: ${p.department}/${p.category}, $${p.price}`);
    });

    await client.end();
}

main().catch(err => {
    console.error('Error:', err.message);
    client.end();
});
