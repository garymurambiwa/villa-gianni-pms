const pg = require('pg');
require('dotenv').config();

async function checkSettings() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL || process.env.VITE_DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const res = await pool.query("SELECT * FROM app_settings WHERE key = 'license_expiry'");
        console.log('License Expiry Setting:', res.rows);
    } catch (e) {
        console.error('Error checking settings:', e);
    } finally {
        await pool.end();
    }
}

checkSettings();
