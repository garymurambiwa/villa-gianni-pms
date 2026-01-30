const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Load environment variables if local
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }) } catch { }

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ Error: DATABASE_URL environment variable is missing.');
    process.exit(1);
}

async function run() {
    console.log('🚀 Connecting to database...');
    const client = new Client({
        connectionString,
        ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('✅ Connected.');

        const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
        console.log(`📂 Reading schema from ${schemaPath}...`);

        if (!fs.existsSync(schemaPath)) {
            console.error('❌ Schema file not found!');
            process.exit(1);
        }

        const sql = fs.readFileSync(schemaPath, 'utf8');

        console.log('⚙️ Executing schema...');
        await client.query(sql);

        console.log('✅ Database initialized successfully!');
    } catch (err) {
        console.error('❌ Error initializing database:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

run();
