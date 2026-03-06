import { neon } from '@neondatabase/serverless';

const connectionString = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const sql = neon(connectionString);

async function run() {
    try {
        const rows = await sql`SELECT id, name, department, category, category_id, is_stock_item FROM products WHERE active = true;`;
        console.log("Total ACTIVE products in DB:", rows.length);

        // Check what the Bar products actually have
        const barProducts = rows.filter(r => {
            const rawCat = String(r.department || r.category || '').toLowerCase();
            return rawCat.includes('bar') || rawCat.includes('beverage') || rawCat.includes('cocktail') || rawCat.includes('drink') || rawCat.includes('beer') || rawCat.includes('wine') || rawCat.includes('cider');
        });

        console.log("TOTAL BAR PRODUCTS:", barProducts.length);
        console.table(barProducts.slice(0, 10));

        // Specifically look for products that might map to "Imported Beers"
        console.log("ALL BEERS/WINES/SPIRITS IN DB:");
        const targeted = rows.filter(b =>
            String(b.name).toLowerCase().includes('beer') ||
            String(b.category).toLowerCase().includes('beer') ||
            String(b.category).toLowerCase().includes('wine') ||
            String(b.category).toLowerCase().includes('cider') ||
            String(b.category).toLowerCase().includes('spirit') ||
            ['castle lite', 'savanna cider', 'hunters gold cider', 'black label'].includes(String(b.name).toLowerCase())
        );
        console.table(targeted);

    } catch (err) {
        console.error("Query Error:", err);
    }
}
run();
