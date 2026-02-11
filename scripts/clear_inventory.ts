
import { Pool } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';

dotenv.config();

// Use the connection string from environment variables or hardcoded if necessary (matching reset_db.mjs)
const CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    console.log('⚠ STARTING INVENTORY CLEAR ⚠');

    const pool = new Pool({ connectionString: CONNECTION_STRING });

    try {
        console.log('Connecting to DB...');

        // Truncate tables with CASCADE to handle foreign key constraints
        // We are clearing:
        // - inventory_items (and moves)
        // - menu_items (and order_items)
        // - cocktail_ingredients
        // - cocktail_recipes (and usage/waste)

        console.log('Clearing inventory_items and related tables...');
        await pool.query('TRUNCATE TABLE inventory_items CASCADE');

        console.log('Clearing menu_items and related tables...');
        await pool.query('TRUNCATE TABLE menu_items CASCADE');

        console.log('Clearing cocktail_ingredients and cocktail_recipes...');
        await pool.query('TRUNCATE TABLE cocktail_ingredients CASCADE');
        await pool.query('TRUNCATE TABLE cocktail_recipes CASCADE');

        // Optional: Reset sequences if IDs were SERIAL (they seem to be VARCHAR mostly, but good practice if mixed)
        // Since schema uses VARCHAR IDs mostly, we don't need to reset sequences for these tables usually.

        console.log('✅ Inventory and Menu items cleared successfully!');

    } catch (err) {
        console.error('❌ CLEAR FAILED:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
