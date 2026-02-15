const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

// Read DATABASE_URL from .env
const envPath = path.join(__dirname, '..', '.env');
let connectionString = process.env.DATABASE_URL;

if (!connectionString && fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    if (match) connectionString = match[1].trim();
}

if (!connectionString) {
    console.error('DATABASE_URL not found');
    process.exit(1);
}

const client = new Client({ connectionString });

async function main() {
    await client.connect();

    // Get products that should appear in Bar -> General
    const res = await client.query(`
        SELECT id, name, department, category, price, active
        FROM products 
        WHERE active = true
        ORDER BY name ASC
        LIMIT 20
    `);

    console.log('\n=== FIRST 20 ACTIVE PRODUCTS ===\n');

    res.rows.forEach(p => {
        const rawCat = String(p.department || p.category || '').toLowerCase();
        const costCenter = String(p.department || p.category || '').toLowerCase();
        const isBar = costCenter.includes('bar') || rawCat.includes('bar') || rawCat.includes('beverage') || rawCat.includes('cocktail');

        let derivedCategoryId;
        if (isBar) {
            if (rawCat.includes('beverage') || rawCat.includes('cocktail') || rawCat.includes('drink')) {
                derivedCategoryId = 'CAT_BAR_BEV';
            } else {
                derivedCategoryId = 'CAT_BAR_GEN';
            }
        } else {
            if (rawCat.includes('main') || rawCat.includes('entree')) {
                derivedCategoryId = 'CAT_REST_MAIN';
            } else {
                derivedCategoryId = 'CAT_REST_GEN';
            }
        }

        console.log(`${p.name}:`);
        console.log(`  department: "${p.department}"`);
        console.log(`  category: "${p.category}"`);
        console.log(`  price: $${p.price}`);
        console.log(`  active: ${p.active}`);
        console.log(`  → category_id: ${derivedCategoryId}`);
        console.log(`  → isBar: ${isBar}`);
        console.log('');
    });

    // Check specific items that ARE showing
    console.log('\n=== CHECKING VISIBLE ITEMS ===\n');
    const visibleItems = ['BILTONG 100g', 'BILTONG 50g', 'BLACK LABEL BEER'];

    for (const itemName of visibleItems) {
        const itemRes = await client.query(
            'SELECT * FROM products WHERE name ILIKE $1',
            [`%${itemName}%`]
        );

        if (itemRes.rows.length > 0) {
            const item = itemRes.rows[0];
            console.log(`${item.name}:`);
            console.log(JSON.stringify(item, null, 2));
            console.log('');
        }
    }

    // Get count by department/category
    const countRes = await client.query(`
        SELECT department, category, COUNT(*) as count
        FROM products
        WHERE active = true
        GROUP BY department, category
        ORDER BY department, category
    `);

    console.log('\n=== PRODUCT COUNT BY DEPARTMENT/CATEGORY ===\n');
    countRes.rows.forEach(r => {
        console.log(`${r.department || 'NULL'} / ${r.category || 'NULL'}: ${r.count} items`);
    });

    await client.end();
}

main().catch(err => {
    console.error('Error:', err);
    client.end();
    process.exit(1);
});
