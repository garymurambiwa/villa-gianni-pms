const pg = require('pg');

const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb';

async function main() {
    const pool = new pg.Pool({
        connectionString: DB_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const res = await pool.query(
            "UPDATE products SET category = department"
        );
        console.log(`Reverted ${res.rowCount} products categories to match their department.`);
    } catch (err) {
        console.error(`Failed to update: ${err.message}`);
    }

    await pool.end();
}

main().catch(console.error);
