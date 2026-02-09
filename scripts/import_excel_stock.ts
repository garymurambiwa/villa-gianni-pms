
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import pg from 'pg';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Connection string from src/lib/db.ts
const DB_URL = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
    console.log('Searching for Excel files in:', ROOT_DIR);

    const files = fs.readdirSync(ROOT_DIR).filter(f => {
        const lower = f.toLowerCase();
        return (lower.endsWith('.xlsx') || lower.endsWith('.csv')) && !lower.startsWith('~$');
    });

    // Prioritize stocks.csv
    let filename = files.find(f => f.toLowerCase() === 'stocks.csv');
    if (!filename && files.length > 0) filename = files[0];

    if (!filename) {
        console.error('No .xlsx or .csv files found in ' + ROOT_DIR);
        console.log('Please place "stocks.csv" or "stock.xlsx" in the root folder.');
        process.exit(1);
    }

    console.log(`Found file: ${filename}`);
    const filepath = path.join(ROOT_DIR, filename);

    const workbook = XLSX.readFile(filepath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON with first row as header
    const rawData: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false }); // raw: false to ensure numbers are parsed if CSV
    console.log(`Read ${rawData.length} rows from sheet "${sheetName}"`);

    if (rawData.length === 0) {
        console.error('Sheet is empty');
        process.exit(1);
    }

    // Detect columns (just for logging)
    const first = rawData[0];
    console.log('Columns detected:', Object.keys(first));

    // Connect to DB
    const pool = new pg.Pool({ connectionString: DB_URL });

    try {
        const client = await pool.connect();
        console.log('Connected to Database');

        let imported = 0;
        let errors = 0;

        for (const row of rawData) {
            // Direct mapping based on stocks.csv structure
            const name = row['Name'] || row['Item'];
            if (!name) {
                // console.warn('Skipping row without Name:', row);
                continue;
            }

            // Parse fields
            const id = row['ID'] || `ITEM_${name.replace(/\s+/g, '_').toUpperCase()}`;
            const category = row['CategoryName'] || row['Category'] || 'General';

            const parseNum = (val: any) => {
                if (typeof val === 'number') return val;
                if (typeof val === 'string') return parseFloat(val.replace(/[^\d.-]/g, '')) || 0;
                return 0;
            };

            const qty = parseNum(row['QtyInStock'] || row['Qty'] || row['Stock']) + 20; // User requested +20 padding
            const price = parseNum(row['CostPrice'] || row['Cost'] || row['Price']);
            const sellingRaw = row['SellingPrice'] || row['Selling'];
            const sellingPrice = parseNum(sellingRaw || 0);

            if (imported < 5) {
                console.log(`Debug Row ${imported}:`, {
                    name,
                    sellingRaw,
                    sellingPrice,
                    keys: Object.keys(row).filter(k => k.toLowerCase().includes('selling'))
                });
            }

            // Map 'Center' to 'type' (restaurant/bar)
            let type = String(row['Center'] || row['Type'] || 'general').toLowerCase();
            // Normalize type
            if (type !== 'bar' && type !== 'restaurant') type = 'general';

            // Map category IDs
            const getCategoryId = (center: string, catName: string) => {
                const c = center.toLowerCase();
                const n = catName.toLowerCase();
                if (c === 'bar') {
                    if (n.includes('beverage') || n.includes('drink') || n.includes('soft')) return 'CAT_BAR_BEV';
                    return 'CAT_BAR_GEN';
                }
                if (c === 'restaurant') {
                    if (n.includes('main') || n.includes('food') || n.includes('meal')) return 'CAT_REST_MAIN';
                    return 'CAT_REST_GEN';
                }
                return 'CAT_REST_GEN'; // Default fallback
            };
            const categoryId = getCategoryId(type, category);

            // Upsert
            try {
                await client.query(`
          INSERT INTO inventory_items (id, name, category, category_id, stock_level, price, selling_price, type, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            category_id = EXCLUDED.category_id,
            stock_level = EXCLUDED.stock_level,
            price = EXCLUDED.price,
            selling_price = EXCLUDED.selling_price,
            type = EXCLUDED.type,
            updated_at = NOW()
        `, [id, String(name), String(category), qty, price, sellingPrice, type]);

                imported++;
                if (imported % 10 === 0) process.stdout.write('.');


            } catch (err: any) {
                console.error(`\nFailed to import "${name}":`, err.message);
                errors++;
            }
        }

        console.log(`\nImport completed.`);
        console.log(`Success: ${imported}`);
        console.log(`Errors: ${errors}`);

    } catch (err) {
        console.error('Database connection error:', err);
    } finally {
        await pool.end();
    }
}

main().catch(console.error);
