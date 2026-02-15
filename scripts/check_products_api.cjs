
// Removed require('node-fetch');

async function checkProducts() {
    try {
        const response = await fetch('http://localhost:8081/api/db/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sql: "SELECT id, name, price, category, department, is_stock_item FROM products LIMIT 50",
                params: []
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Products:', JSON.stringify(data.rows, null, 2));
        console.log('Total count:', data.rows ? data.rows.length : 0);

    } catch (err) {
        console.error('Error:', err);
    }
}

checkProducts();
