import { Client } from 'pg';

const connectionString = 'postgres://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function testImportVisibility() {
    const client = new Client({ connectionString });
    console.log('Connecting to database...');
    await client.connect();

    try {
        // 1. Simulate an import of an item with 'TRUE' visibility
        const testItem = {
            id: `TEST_IMPORT_${Date.now()}`,
            name: 'Test Import Item',
            category: 'bar',
            department: 'Bar',
            price: 10.50,
            cost_price: 5.00,
            stock_level: 100,
            unit: 'TEST',
            active: true,
            visibility: JSON.stringify({ bar: true, restaurant: false }),
            is_stock_item: true
        };

        console.log('Inserting test item with visibility:', testItem.visibility);

        const sql = `
      INSERT INTO products (id, name, category, department, price, cost_price, stock_level, unit, active, visibility, is_stock_item, inserted_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING id, name, visibility
    `;

        const res = await client.query(sql, [
            testItem.id, testItem.name, testItem.category, testItem.department,
            testItem.price, testItem.cost_price, testItem.stock_level, testItem.unit,
            testItem.active, testItem.visibility, testItem.is_stock_item
        ]);

        console.log('Inserted:', res.rows[0]);

        // 2. Verify reading it back
        const readRes = await client.query('SELECT visibility FROM products WHERE id = $1', [testItem.id]);
        const readVis = readRes.rows[0].visibility;
        console.log('Read back visibility:', readVis, 'Type:', typeof readVis);

        let parsedVis = readVis;
        if (typeof readVis === 'string') {
            try { parsedVis = JSON.parse(readVis); } catch { }
        }

        if (parsedVis.bar === true && parsedVis.restaurant === false) {
            console.log('✅ Visibility correctly stored and retrieved.');
        } else {
            console.error('❌ Visibility mismatch:', parsedVis);
        }

        // Cleanup
        await client.query('DELETE FROM products WHERE id = $1', [testItem.id]);
        console.log('Test item cleaned up.');

    } catch (err: any) {
        console.error('Test failed:', err);
    } finally {
        await client.end();
    }
}

testImportVisibility();
