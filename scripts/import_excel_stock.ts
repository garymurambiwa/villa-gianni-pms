
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import pg from 'pg';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

// Load .env from root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
    console.error("DATABASE_URL is missing!");
    process.exit(1);
}

async function main() {
    console.log('Searching for stocks.csv in:', ROOT_DIR);
    // Explicitly check DB_URL for TS
    if (!DB_URL) return;
    console.log(`Using Database: ${DB_URL.replace(/:[^:@]+@/, ':***@')}`);

    const files = fs.readdirSync(ROOT_DIR).filter(f => f.toLowerCase() === 'stocks.csv');
    if (files.length === 0) {
        console.error('No stocks.csv found in root directory.');
        process.exit(1);
    }
    const filename = files[0];
    const filepath = path.join(ROOT_DIR, filename);

    console.log(`Reading file: ${filepath}`);
    const workbook = XLSX.readFile(filepath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false });

    console.log(`Read ${rawData.length} rows.`);

    const pool = new pg.Pool({
        connectionString: DB_URL,
        ssl: DB_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });

    try {
        const client = await pool.connect();

        // Ensure products table exists (if not, we rely on migrate_to_products.ts or schema, but let's assume it exists per check)

        let imported = 0;
        let errors = 0;

        for (const row of rawData) {
            const name = String(row['Name'] || row['Item'] || '').trim();
            if (!name) continue;

            const category = String(row['CategoryName'] || row['Category'] || 'General').trim();

            // Helper to parse numbers
            const parseNum = (val: any) => {
                if (typeof val === 'number') return val;
                if (typeof val === 'string') return parseFloat(val.replace(/[^\d.-]/g, '')) || 0;
                return 0;
            };

            // Use exact column names from CSV inspection
            const qtyRaw = row['QtyInStock'] !== undefined ? row['QtyInStock'] : (row['Qty'] !== undefined ? row['Qty'] : row['Stock']);
            const stock_level = parseNum(qtyRaw) + 20;

            const costRaw = row['CostPrice'] !== undefined ? row['CostPrice'] : row['Cost'];
            const cost_price = parseNum(costRaw);

            const invalidSelling = row['SellingPrice'] !== undefined ? row['SellingPrice'] : (row['Selling'] !== undefined ? row['Selling'] : row['Price']);
            const price = parseNum(invalidSelling);

            // Determine department/type - normalize case
            let rawDept = String(row['Center'] || row['Type'] || 'Restaurant').trim();
            let department = 'Restaurant';
            if (rawDept.toLowerCase() === 'bar') department = 'Bar';
            else if (rawDept.toLowerCase() === 'restaurant') department = 'Restaurant';

            // Generate ID if needed
            const id = row['ID'] || `PROD_${name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;

            try {
                // Upsert into products
                await client.query(`
                    INSERT INTO products (
                        id, name, category, department, 
                        price, cost_price, stock_level, 
                        unit, active, visibility, is_stock_item, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'all', true, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        category = EXCLUDED.category,
                        department = EXCLUDED.department,
                        price = EXCLUDED.price,
                        cost_price = EXCLUDED.cost_price,
                        stock_level = EXCLUDED.stock_level,
                        updated_at = NOW()
                `, [
                    id, name, category, department,
                    price, cost_price, stock_level,
                    'units'
                ]);
                imported++;
                if (imported % 50 === 0) process.stdout.write('.');
            } catch (err: any) {
                // If table doesn't exist, this will fail fast.
                if (err.code === '42P01') {
                    console.error("\nERROR: Table 'products' does not exist! Please run migration first.");
                    process.exit(1);
                }
                console.error(`\nFailed to import ${name}: ${err.message}`);
                errors++;
            }
        }

        console.log(`\nImport completed. Success: ${imported}, Errors: ${errors}`);

    } catch (err) {
        console.error('DB Error:', err);
    } finally {
        await pool.end();
    }
}

main().catch(console.error);
