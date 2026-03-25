import fs from 'fs';
import pkg from 'pg';
import path from 'path';
import * as xlsx from 'xlsx';
import { fileURLToPath } from 'url';

const { Client } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const csvPath = path.join(__dirname, '..', 'stock_items.csv');

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
let dbUrl = '';
for (const line of envFile.split('\n')) {
  if (line.trim().startsWith('DATABASE_URL=')) {
    dbUrl = line.substring(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
    break;
  }
}

async function run() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    console.log('Connected to DB. Reading CSV...');
    const buffer = fs.readFileSync(csvPath);
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`Parsed ${data.length} items from CSV.`);

    client.on('error', err => {
      console.error('db client error', err.stack);
    });

    console.log('Clearing existing stock data...');
    await client.query('DELETE FROM folio_charges WHERE charge_type = \'pos\''); // Optional cleanup if needed
    await client.query('DELETE FROM products');
    await client.query('DELETE FROM menu_items');
    await client.query('DELETE FROM inventory_items');
    await client.query('DELETE FROM menu_categories');
    await client.query('DELETE FROM menu_subcategories');

    const categoriesSet = new Map();
    data.forEach((row) => {
      const catName = row.CategoryName || 'Uncategorized';
      const center = row.Center || 'restaurant';
      const dept = center.toLowerCase().includes('bar') ? 'Bar' : 'Restaurant';
      if (!categoriesSet.has(catName)) categoriesSet.set(catName, dept);
    });

    const categoryNameToId = {};
    for (const [catName, dept] of categoriesSet.entries()) {
      const catId = 'CAT_' + catName.toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 20);
      categoryNameToId[catName] = catId;
      await client.query(`
        INSERT INTO menu_categories (category_id, category_name, department, sort_order)
        VALUES ($1, $2, $3, 0)
      `, [catId, catName, dept]);
    }
    console.log(`Inserted ${categoriesSet.size} categories.`);

    let inserted = 0;
    const usedIds = new Set();
    
    // Batch process to avoid hanging
    const chunkSize = 20;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      
      await Promise.all(chunk.map(async (row) => {
        let name = row.Name || 'Unnamed Item';
        let idNum = Math.floor(1000 + Math.random() * 9000);
        while(usedIds.has(idNum)) idNum = Math.floor(1000 + Math.random() * 9000);
        usedIds.add(idNum);
        const newId = String(idNum);

        let catName = row.CategoryName || 'Uncategorized';
        let center = row.Center || 'restaurant';
        let catId = categoryNameToId[catName];
        let dept = center.toLowerCase().includes('bar') ? 'Bar' : 'Restaurant';
        
        let sellingPrice = Number(row.SellingPrice || 0);
        let costPrice = Number(row.CostPrice || 0);
        let qtyStock = Number(row.QtyInStock || 0);

        let barVis = row.BarVisible === 'Yes' || row.BarVisible === true;
        let restVis = row.RestaurantVisible === 'Yes' || row.RestaurantVisible === true;
        let visibilityJson = JSON.stringify({ bar: barVis, restaurant: restVis });

        let notes = row.Notes || '';
        let cosPercent = Number(row.COSPercent || 0);
        let gpAmount = Number(row.GPAmount || 0);
        let gpPercent = Number(row.GPPercent || 0);
        let qtyReceived = Number(row.QtyReceived || 0);

        await client.query(`
          INSERT INTO products (
            id, name, category, department, price, cost_price, stock_level,
            active, visibility, is_stock_item, category_id, notes,
            cos_percent, gp_percent, gp_amount, qty_received
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `, [
          newId, name, center, dept, sellingPrice, costPrice, qtyStock,
          true, visibilityJson, true, catId, notes,
          cosPercent, gpPercent, gpAmount, qtyReceived
        ]);

        await client.query(`
          INSERT INTO menu_items (id, name, category, price, active)
          VALUES ($1, $2, $3, $4, $5)
        `, [newId, name, center, sellingPrice, true]);

        let invCat = String(center).substring(0, 50);
        await client.query(`
          INSERT INTO inventory_items (id, name, category, stock_level, price)
          VALUES ($1, $2, $3, $4, $5)
        `, [newId, name, invCat, qtyStock, sellingPrice]);
      }));
      inserted += chunk.length;
      console.log(`Processed ${inserted} items...`);
    }

    console.log(`Successfully completed! Inserted ${inserted} items with unique 4-digit IDs.`);
  } catch (err) {
    console.error('Migration failed.', err);
  } finally {
    await client.end();
  }
}

run();
