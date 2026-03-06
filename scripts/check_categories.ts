import { Pool } from 'pg';

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

async function check() {
    try {
        const { rows } = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name ILIKE '%category%' OR table_name ILIKE '%cat%');
    `);
        console.log("Category tables:", rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

check();
