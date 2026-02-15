const { Client } = require('pg');

const NEON_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

const client = new Client({ connectionString: NEON_URL });

async function main() {
    await client.connect();

    console.log('\n🔍 Verifying Neon Database Import\n');

    // Check total products
    const countRes = await client.query('SELECT COUNT(*) as count FROM products WHERE active = true');
    const total = parseInt(countRes.rows[0].count);
    console.log(`✅ Total active products in Neon: ${total}\n`);

    if (total === 0) {
        console.log('❌ NO PRODUCTS FOUND IN NEON DATABASE!');
        console.log('The import may have failed silently.\n');
        await client.end();
        return;
    }

    // Check sample products
    const sampleRes = await client.query('SELECT name, department, category, price FROM products WHERE active = true LIMIT 10');
    console.log('Sample products:');
    sampleRes.rows.forEach(p => {
        console.log(`  - ${p.name}: dept="${p.department}", cat="${p.category}", $${p.price}`);
    });

    // Check department distribution
    const deptRes = await client.query(`
        SELECT department, COUNT(*) as count
        FROM products
        WHERE active = true
        GROUP BY department
    `);
    console.log('\nDepartment distribution:');
    deptRes.rows.forEach(r => {
        console.log(`  ${r.department || 'NULL'}: ${r.count} items`);
    });

    await client.end();
    console.log('\n✅ Neon database verification complete\n');
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    client.end();
});
