import { Pool } from 'pg';

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

async function run() {
    const sql = `
      INSERT INTO products (
        id, name, category, department, price, cost_price, stock_level, unit, active, visibility, is_stock_item,
        category_id, sub_id, parent_sub_id, notes, barcodes, cos_percent, gp_percent, gp_amount, qty_received, image_bg_color, picture_data, updated_at, inserted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        price = EXCLUDED.price,
        cost_price = EXCLUDED.cost_price,
        stock_level = EXCLUDED.stock_level,
        unit = EXCLUDED.unit,
        active = EXCLUDED.active,
        visibility = EXCLUDED.visibility,
        is_stock_item = EXCLUDED.is_stock_item,
        category_id = EXCLUDED.category_id,
        sub_id = EXCLUDED.sub_id,
        parent_sub_id = EXCLUDED.parent_sub_id,
        notes = EXCLUDED.notes,
        barcodes = EXCLUDED.barcodes,
        cos_percent = EXCLUDED.cos_percent,
        gp_percent = EXCLUDED.gp_percent,
        gp_amount = EXCLUDED.gp_amount,
        qty_received = EXCLUDED.qty_received,
        image_bg_color = EXCLUDED.image_bg_color,
        picture_data = EXCLUDED.picture_data,
        updated_at = NOW()
  `;

    const params = [
        'ITEM_TEST_123',
        'Test Item',
        'restaurant',
        'Restaurant',
        8.50,
        0,
        0,
        'units',
        true,
        '{}',
        true,
        null,
        null,
        null,
        null,
        '[]',
        0,
        0,
        0,
        0,
        null,
        null
    ];

    try {
        const res = await pool.query(sql, params);
        console.log('Result:', res.command, res.rowCount);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        pool.end();
    }
}

run();
