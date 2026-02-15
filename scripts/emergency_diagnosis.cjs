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

    console.log('\n🔍 EMERGENCY DIAGNOSIS - Why POS is Empty\n');

    // 1. Check if products exist in database
    const countRes = await client.query('SELECT COUNT(*) as count FROM products WHERE active = true');
    const total = parseInt(countRes.rows[0].count);
    console.log(`1. Database Check: ${total} active products found`);

    if (total === 0) {
        console.log('   ❌ NO PRODUCTS IN DATABASE!');
        console.log('   → Products were not imported or were deleted');
        console.log('   → Run import script again\n');
        await client.end();
        return;
    }

    // 2. Check a sample product structure
    const sampleRes = await client.query('SELECT * FROM products WHERE active = true LIMIT 1');
    const sample = sampleRes.rows[0];
    console.log('\n2. Sample Product Structure:');
    console.log(`   name: "${sample.name}"`);
    console.log(`   department: "${sample.department}"`);
    console.log(`   category: "${sample.category}"`);
    console.log(`   price: ${sample.price}`);
    console.log(`   active: ${sample.active}`);

    // 3. Check department distribution
    const deptRes = await client.query(`
        SELECT department, COUNT(*) as count
        FROM products
        WHERE active = true
        GROUP BY department
    `);
    console.log('\n3. Department Distribution:');
    deptRes.rows.forEach(r => {
        console.log(`   ${r.department || 'NULL'}: ${r.count} items`);
    });

    // 4. Simulate the isBar logic
    console.log('\n4. Testing isBar Detection Logic:');
    const testRes = await client.query('SELECT department, category FROM products WHERE active = true LIMIT 5');
    testRes.rows.forEach(p => {
        const rawCat = String(p.department || p.category || '').toLowerCase();
        const costCenter = String(p.department || p.category || '').toLowerCase();
        const isBar = costCenter.includes('bar') || rawCat.includes('bar') || rawCat.includes('beverage') || rawCat.includes('cocktail');
        const mappedCategory = isBar ? 'bar' : 'restaurant';
        console.log(`   dept="${p.department}", cat="${p.category}" → isBar=${isBar}, category="${mappedCategory}"`);
    });

    console.log('\n5. DIAGNOSIS:');
    console.log('   If products exist in DB but POS is empty, the issue is:');
    console.log('   a) DataContext.loadAllData() is not running');
    console.log('   b) There\'s a JavaScript error in DataContext');
    console.log('   c) localStorage is not being populated');
    console.log('\n   CHECK BROWSER CONSOLE for errors!\n');

    await client.end();
}

main().catch(err => {
    console.error('Error:', err.message);
    client.end();
});
