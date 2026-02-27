// Quick script to update product categories from stocks.csv
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
    const catNameIdx = headers.indexOf('CategoryName');
    const centerIdx = headers.indexOf('Center');

    console.log(`Headers: ID=${idIdx}, CategoryName=${catNameIdx}, Center=${centerIdx}`);

    const pool = new pg.Pool({
        connectionString: DB_URL,
        ssl: { rejectUnauthorized: false }
    });

    let updated = 0;
    let errors = 0;

    for (let i = 1; i < lines.length; i++) {
        // Simple CSV parsing (no quotes in this data)
        const cols = lines[i].split(',');
        const id = cols[idIdx]?.trim();
        const categoryName = cols[catNameIdx]?.trim() || 'General';
        const department = cols[centerIdx]?.trim() || 'Restaurant';

        if (!id) continue;

        try {
            const res = await pool.query(
                'UPDATE products SET category = $1, department = $2 WHERE id = $3',
                [categoryName, department, id]
            );
            if (res.rowCount > 0) {
                updated++;
            }
        } catch (err) {
            console.error(`Failed to update ${id}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\nDone. Updated: ${updated}, Errors: ${errors}`);

    // Verify
    const verify = await pool.query('SELECT DISTINCT category, department, COUNT(*) as cnt FROM products GROUP BY category, department ORDER BY department, category');
    console.log('\nCategory breakdown after update:');
    verify.rows.forEach(r => console.log(`  ${r.department} | ${r.category} | ${r.cnt} items`));

    await pool.end();
}

main().catch(console.error);
