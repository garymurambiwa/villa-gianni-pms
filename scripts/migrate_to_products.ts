
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv'; // Assuming dotenv is installed as it's in package.json

// 0. Load .env
function loadEnv() {
    const envCodes = ['.env.development', '.env'];
    for (const file of envCodes) {
        const p = path.resolve(process.cwd(), file);
        if (fs.existsSync(p)) {
            console.log(`Loading env from ${file}`);
            dotenv.config({ path: p });
            return;
        }
    }
    dotenv.config(); // fallback
}

loadEnv();

const CONNECTION_STRING = process.env.DATABASE_URL || process.argv[2];

if (!CONNECTION_STRING) {
    console.error("DATABASE_URL is missing. Please set it in .env or pass as argument.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: CONNECTION_STRING,
    ssl: CONNECTION_STRING.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function migrate() {
    console.log('Starting migration: Unify menu_items and inventory_items into products...');
    console.log(`Using Database: ${CONNECTION_STRING.replace(/:[^:@]+@/, ':***@')}`); // Mask password

    let client;
    try {
        client = await pool.connect();
        console.log('Connected to DB successfully.');

        // 1. Create products table
        console.log('Creating products table...');
        await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        department TEXT DEFAULT 'Restaurant',
        price NUMERIC(12,2) DEFAULT 0,
        cost_price NUMERIC(12,2) DEFAULT 0,
        stock_level NUMERIC DEFAULT 0,
        unit TEXT DEFAULT 'units',
        active BOOLEAN DEFAULT true,
        visibility TEXT,
        is_stock_item BOOLEAN DEFAULT true,
        inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

        // 2. Fetch existing data
        console.log('Fetching existing data...');
        const menuRes = await client.query('SELECT * FROM menu_items');
        const invRes = await client.query('SELECT * FROM inventory_items');

        const menuItems = menuRes.rows;
        const invItems = invRes.rows;

        console.log(`Found ${menuItems.length} menu items and ${invItems.length} inventory items.`);

        // 3. Merge data
        const products = new Map();

        // Process Inventory Items first
        for (const inv of invItems) {
            products.set(inv.id, {
                id: inv.id,
                name: inv.name,
                category: inv.category,
                department: 'Restaurant',
                cost_price: Number(inv.cost || 0),
                stock_level: Number(inv.stock_level || inv.quantity || 0),
                unit: inv.unit || 'units',
                active: true,
                visibility: inv.visibility || 'all',
                is_stock_item: true,
                price: Number(inv.price || 0)
            });
        }

        // Merge Menu Items
        for (const menu of menuItems) {
            let product = products.get(menu.id);

            if (!product) {
                const normalizedName = menu.name.trim().toLowerCase();
                for (const [_, p] of products) {
                    if (p.name.trim().toLowerCase() === normalizedName) {
                        product = p;
                        break;
                    }
                }
            }

            if (product) {
                product.price = Number(menu.price || 0);
                product.department = menu.category || 'Restaurant';
                product.active = menu.active;
                if (menu.category) product.category = menu.category;
            } else {
                products.set(menu.id, {
                    id: menu.id,
                    name: menu.name,
                    category: menu.category,
                    department: menu.category || 'Restaurant',
                    price: Number(menu.price || 0),
                    active: menu.active,
                    cost_price: 0,
                    stock_level: 0,
                    unit: 'units',
                    visibility: 'all',
                    is_stock_item: false
                });
            }
        }

        // 4. Insert into products table
        console.log(`Inserting ${products.size} unified products...`);
        let inserted = 0;

        for (const p of products.values()) {
            try {
                await client.query(`
                INSERT INTO products (id, name, category, department, price, cost_price, stock_level, unit, active, visibility, is_stock_item, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    category = EXCLUDED.category,
                    department = EXCLUDED.department,
                    price = EXCLUDED.price,
                    cost_price = EXCLUDED.cost_price,
                    stock_level = EXCLUDED.stock_level,
                    active = EXCLUDED.active,
                    visibility = EXCLUDED.visibility,
                    updated_at = NOW()
            `, [
                    p.id,
                    p.name,
                    p.category,
                    p.department,
                    p.price,
                    p.cost_price,
                    p.stock_level,
                    p.unit,
                    p.active,
                    p.visibility,
                    p.is_stock_item
                ]);
                inserted++;
            } catch (err) {
                console.error(`Failed to insert product ${p.name} (${p.id}):`, err.message);
            }
        }

        console.log(`Migration complete. ${inserted} products created/updated.`);
    } catch (e) {
        console.error('Migration error:', e);
        process.exit(1);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

migrate();
