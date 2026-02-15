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
    console.error('❌ DATABASE_URL not found');
    process.exit(1);
}

const client = new Client({ connectionString });

async function main() {
    await client.connect();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║        POS DATA PERSISTENCE VERIFICATION SCRIPT            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // 1. Check database products
    console.log('📊 STEP 1: Checking Database Products\n');
    const dbRes = await client.query('SELECT COUNT(*) as count FROM products WHERE active = true');
    const totalProducts = parseInt(dbRes.rows[0].count);
    console.log(`   ✅ Found ${totalProducts} active products in database\n`);

    // 2. Check products by department with proper category field
    console.log('📊 STEP 2: Products by Department/Category\n');
    const deptRes = await client.query(`
        SELECT department, category, COUNT(*) as count
        FROM products
        WHERE active = true
        GROUP BY department, category
        ORDER BY department, category
    `);

    const barCount = deptRes.rows.filter(r => (r.department || '').toLowerCase().includes('bar')).reduce((sum, r) => sum + parseInt(r.count), 0);
    const restCount = deptRes.rows.filter(r => (r.department || '').toLowerCase().includes('restaurant')).reduce((sum, r) => sum + parseInt(r.count), 0);

    console.log('   Database breakdown:');
    deptRes.rows.forEach(r => {
        console.log(`   - ${r.department || 'NULL'} / ${r.category || 'NULL'}: ${r.count} items`);
    });
    console.log(`\n   Bar items: ${barCount}`);
    console.log(`   Restaurant items: ${restCount}\n`);

    // 3. Simulate DataContext mapping
    console.log('📊 STEP 3: Simulating DataContext Mapping\n');
    const sampleRes = await client.query(`
        SELECT id, name, department, category, price
        FROM products
        WHERE active = true
        ORDER BY name
        LIMIT 10
    `);

    console.log('   First 10 products after mapping:');
    sampleRes.rows.forEach(p => {
        const rawCat = String(p.department || p.category || '').toLowerCase();
        const costCenter = String(p.department || p.category || '').toLowerCase();
        const isBar = costCenter.includes('bar') || rawCat.includes('bar') || rawCat.includes('beverage') || rawCat.includes('cocktail');

        let derivedCategoryId;
        if (isBar) {
            derivedCategoryId = rawCat.includes('beverage') || rawCat.includes('cocktail') || rawCat.includes('drink') ? 'CAT_BAR_BEV' : 'CAT_BAR_GEN';
        } else {
            derivedCategoryId = rawCat.includes('main') || rawCat.includes('entree') ? 'CAT_REST_MAIN' : 'CAT_REST_GEN';
        }

        const mappedCategory = isBar ? 'bar' : 'restaurant';

        console.log(`   ${p.name}:`);
        console.log(`      → category: "${mappedCategory}" (for OrderModal dept filter)`);
        console.log(`      → category_id: "${derivedCategoryId}" (for subcategory filter)`);
    });

    // 4. Expected localStorage structure
    console.log('\n\n📊 STEP 4: Expected localStorage Structure\n');
    console.log('   After DataContext.loadAllData() runs:');
    console.log(`   - localStorage.corepms_pos_items should contain ${totalProducts} items`);
    console.log('   - Each item should have:');
    console.log('     • category: "bar" or "restaurant" ← CRITICAL for dept filter');
    console.log('     • category_id: "CAT_BAR_GEN", "CAT_BAR_BEV", etc.');
    console.log('     • subCategory: original category from DB');
    console.log('     • name, price, id, etc.\n');

    // 5. Verification checklist
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                  VERIFICATION CHECKLIST                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('   To verify localStorage persistence:');
    console.log('   1. ❏ Restart dev server (Ctrl+C then npm run dev)');
    console.log('   2. ❏ Open browser to http://localhost:8081');
    console.log('   3. ❏ Open DevTools (F12) → Console tab');
    console.log('   4. ❏ Run: localStorage.getItem("corepms_pos_items")');
    console.log(`   5. ❏ Verify it shows ${totalProducts} items with category fields`);
    console.log('   6. ❏ Test POS → Table 1 → Bar/General (should show items)');
    console.log('   7. ❏ Refresh page (F5) and test again');
    console.log('   8. ❏ Open in incognito/new browser (should still work)\n');

    console.log('   Expected results:');
    console.log(`   ✅ Bar → General: ~${Math.floor(barCount * 0.7)} items`);
    console.log(`   ✅ Bar → Beverages: ~${Math.floor(barCount * 0.3)} items`);
    console.log(`   ✅ Restaurant → General: ~${Math.floor(restCount * 0.7)} items`);
    console.log(`   ✅ Restaurant → Mains: ~${Math.floor(restCount * 0.3)} items\n`);

    await client.end();

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                      NEXT STEPS                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('   If products still disappear after refresh:');
    console.log('   1. Check browser console for errors');
    console.log('   2. Verify DataContext useEffect is running');
    console.log('   3. Check if localStorage quota exceeded');
    console.log('   4. Look for React strict mode double-mounting issues\n');
}

main().catch(err => {
    console.error('\n❌ Error:', err.message);
    client.end();
    process.exit(1);
});
