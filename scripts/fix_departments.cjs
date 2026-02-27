// Fix product departments in Neon DB using stocks.csv Center column
// Updates by matching product name (case-insensitive) since IDs may differ
const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb';

async function main() {
    const csvPath = path.join(__dirname, '..', 'stocks.csv');
    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',');

    const idIdx = headers.indexOf('ID');
    const nameIdx = headers.indexOf('Name');
    const centerIdx = headers.indexOf('Center');
    const catNameIdx = headers.indexOf('CategoryName');

    console.log(`Indexes - ID:${idIdx} Name:${nameIdx} Center:${centerIdx} CategoryName:${catNameIdx}`);

    // Build lookup: name -> { department, category }
    const csvData = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const id = (cols[idIdx] || '').trim();
        const name = (cols[nameIdx] || '').trim();
        const rawCenter = (cols[centerIdx] || '').trim();
        const catName = (cols[catNameIdx] || '').trim();

        // Normalize department
        let department = 'Restaurant';
        if (rawCenter.toLowerCase() === 'bar') department = 'Bar';

        if (id) {
            csvData.push({ id, name, department, category: catName || 'General' });
        }
    }

    console.log(`Parsed ${csvData.length} rows from CSV`);
    console.log(`Bar items: ${csvData.filter(d => d.department === 'Bar').length}`);
    console.log(`Restaurant items: ${csvData.filter(d => d.department === 'Restaurant').length}`);

    const pool = new pg.Pool({
        connectionString: DB_URL,
        ssl: { rejectUnauthorized: false }
    });

    // First, check current state
    const before = await pool.query('SELECT department, COUNT(*) as cnt FROM products GROUP BY department');
    console.log('\nBEFORE:');
    before.rows.forEach(r => console.log(`  ${r.department}: ${r.cnt} items`));

    let updatedById = 0;
    let updatedByName = 0;
    let failed = 0;

    for (const item of csvData) {
        try {
            // Try by ID first
            let res = await pool.query(
                'UPDATE products SET department = $1, category = $2 WHERE id = $3',
                [item.department, item.category, item.id]
            );

            if (res.rowCount > 0) {
                updatedById++;
            } else {
                // Fallback: try by name (case-insensitive)
                res = await pool.query(
                    'UPDATE products SET department = $1, category = $2 WHERE LOWER(name) = LOWER($3)',
                    [item.department, item.category, item.name]
                );
                if (res.rowCount > 0) {
                    updatedByName++;
                } else {
                    failed++;
                    if (failed <= 5) console.log(`  NOT FOUND: id=${item.id} name=${item.name}`);
                }
            }
        } catch (err) {
            console.error(`  ERROR updating ${item.name}: ${err.message}`);
            failed++;
        }
    }

    console.log(`\nResults: ByID=${updatedById} ByName=${updatedByName} Failed=${failed}`);

    // Verify
    const after = await pool.query('SELECT department, COUNT(*) as cnt FROM products GROUP BY department ORDER BY department');
    console.log('\nAFTER:');
    after.rows.forEach(r => console.log(`  ${r.department}: ${r.cnt} items`));

    // Show sample bar items
    const barSample = await pool.query("SELECT name, department FROM products WHERE LOWER(department) = 'bar' LIMIT 5");
    console.log('\nSample Bar items:');
    barSample.rows.forEach(r => console.log(`  ${r.name} (${r.department})`));

    await pool.end();
}

main().catch(console.error);
