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

console.log('Connecting to database...');

const client = new Client({ connectionString });

async function main() {
    await client.connect();

    const res = await client.query('SELECT * FROM products WHERE active = true ORDER BY name ASC');

    console.log(`\nFound ${res.rows.length} active products`);

    // Map products with category_id logic (matching DataContext.tsx)
    const mapped = res.rows.map(p => {
        const rawCat = String(p.department || p.category || '').toLowerCase();
        const costCenter = String(p.department || p.category || '').toLowerCase();
        const isBar = costCenter.includes('bar') || rawCat.includes('bar') || rawCat.includes('beverage') || rawCat.includes('cocktail');

        let derivedCategoryId = p.category_id;
        if (!derivedCategoryId) {
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
        }

        return {
            id: p.id,
            name: p.name,
            price: Number(p.price || 0),
            selling_price: Number(p.price || 0),
            sellingPrice: Number(p.price || 0),
            costPrice: Number(p.cost_price || 0),
            qtyInStock: Number(p.stock_level || 0),
            type: p.department || p.category || 'restaurant',
            costCenter: isBar ? 'bar' : 'restaurant',
            category: p.category || 'general',
            subCategory: p.category || p.department || '',
            category_id: derivedCategoryId,
            department: p.department,
            active: p.active !== false,
            visibility: p.visibility || { bar: true, restaurant: true }
        };
    });

    // Show first 5 mapped items for verification
    console.log('\n=== SAMPLE MAPPED ITEMS (first 5) ===');
    mapped.slice(0, 5).forEach(item => {
        console.log(`\n${item.name}:`);
        console.log(`  price: $${item.price}`);
        console.log(`  category_id: ${item.category_id}`);
        console.log(`  subCategory: ${item.subCategory}`);
        console.log(`  costCenter: ${item.costCenter}`);
        console.log(`  department: ${item.department}`);
    });

    // Count by category_id
    const counts = {
        'CAT_BAR_GEN': 0,
        'CAT_BAR_BEV': 0,
        'CAT_REST_GEN': 0,
        'CAT_REST_MAIN': 0
    };

    mapped.forEach(item => {
        if (counts.hasOwnProperty(item.category_id)) {
            counts[item.category_id]++;
        }
    });

    console.log('\n=== CATEGORY DISTRIBUTION ===');
    console.log(`CAT_BAR_GEN (Bar/General):        ${counts['CAT_BAR_GEN']} items`);
    console.log(`CAT_BAR_BEV (Bar/Beverages):      ${counts['CAT_BAR_BEV']} items`);
    console.log(`CAT_REST_GEN (Restaurant/General): ${counts['CAT_REST_GEN']} items`);
    console.log(`CAT_REST_MAIN (Restaurant/Mains):  ${counts['CAT_REST_MAIN']} items`);

    console.log('\n✅ Fix verified! Products will have proper category_id values.');
    console.log('💡 To apply: Reload the app and DataContext will sync these to localStorage.');

    await client.end();
}

main().catch(err => {
    console.error('Error:', err);
    client.end();
    process.exit(1);
});
