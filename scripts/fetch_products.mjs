import fs from 'fs';

async function run() {
    try {
        const res = await fetch('http://localhost:8081/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sql: 'SELECT id, name, price, department, category, category_id, is_stock_item FROM products WHERE active = true;',
                args: []
            })
        });

        if (!res.ok) {
            console.log("Fetch failed:", res.status, await res.text());
            return;
        }

        const data = await res.json();
        const rows = data.result || [];

        console.log("Total ACTIVE products in DB:", rows.length);

        const barProducts = rows.filter(r => {
            const rawCat = String(r.department || r.category || '').toLowerCase();
            return rawCat.includes('bar') || rawCat.includes('beverage') || rawCat.includes('cocktail') || rawCat.includes('drink') || rawCat.includes('beer') || rawCat.includes('wine') || rawCat.includes('cider');
        });

        console.log("TOTAL BAR PRODUCTS IDENTIFIED:", barProducts.length);
        console.log("BAR PRODUCTS DETAIL (First 10):");
        console.table(barProducts.slice(0, 10));

        // Specifically look for products that might map to "Imported Beers"
        const beers = b => String(b.name).toLowerCase().includes('beer') || String(b.category).toLowerCase().includes('beer');
        const beerProducts = rows.filter(beers);
        console.log("\nProducts matching 'Beer':", beerProducts.length);
        console.table(beerProducts.slice(0, 5));

    } catch (err) {
        console.error("Fetch Error:", err);
    }
}
run();
