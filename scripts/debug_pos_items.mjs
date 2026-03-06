import { Pool } from 'pg';

const connectionString = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({ connectionString });

async function run() {
    try {
        const res = await pool.query('SELECT id, name, price, department, category, category_id, is_stock_item FROM products WHERE active = true;');
        console.log("Total ACTIVE products in DB:", res.rows.length);

        const barProducts = res.rows.filter(r => {
            const rawCat = String(r.department || r.category || '').toLowerCase();
            return rawCat.includes('bar') || rawCat.includes('beverage') || rawCat.includes('cocktail') || rawCat.includes('drink') || rawCat.includes('beer') || rawCat.includes('wine') || rawCat.includes('cider');
        });

        console.log("TOTAL BAR PRODUCTS:", barProducts.length);
        console.log("BAR PRODUCTS DETAIL:");
        console.table(barProducts);
    } catch (err) {
        console.error("DB Error:", err);
    } finally {
        await pool.end();
    }
}
run();
