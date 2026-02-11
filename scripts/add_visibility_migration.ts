
import { db } from '../src/lib/db';

async function migrate() {
    console.log('Starting migration: Add visibility column to inventory_items...');

    try {
        // Check if column exists first (optional, but good practice if not using IF NOT EXISTS which is PG specific for ADD COLUMN in newer versions, 
        // but straight ALTER TABLE ADD COLUMN IF NOT EXISTS is supported in recent PG versions)

        // We'll use the robust approach of strict SQL
        const sql = `ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS visibility text`;

        const result = await db.query(sql);

        if ('error' in result) {
            console.error('Migration failed:', result.error);
            process.exit(1);
        }

        console.log('Migration successful: visibility column added to inventory_items.');
        process.exit(0);
    } catch (e) {
        console.error('Migration error:', e);
        process.exit(1);
    }
}

migrate();
