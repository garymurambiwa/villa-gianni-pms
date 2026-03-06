import { Client } from 'pg';

const connectionString = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

const client = new Client({
    connectionString,
});

async function run() {
    try {
        await client.connect();
        console.log("Connected to DB!");

        const res = await client.query(`SELECT id, name, department, category, active FROM products WHERE active = true;`);
        console.log("Total Active Products:", res.rows.length);

        const sample = res.rows.slice(0, 50);
        console.table(sample);

    } catch (err) {
        console.error("Error", err);
    } finally {
        await client.end();
    }
}

run();
