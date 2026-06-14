const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const isExecute = process.argv.includes('--execute');

async function main() {
  const client = await pool.connect();
  try {
    console.log(`Starting ledger repair in ${isExecute ? 'EXECUTE' : 'DRY-RUN'} mode...`);

    // Find duplicates: same reference_number, ledger_type, location_id, item_id
    const duplicateGroups = await client.query(`
      SELECT reference_number, ledger_type, location_id, item_id, COUNT(*) as cnt, array_agg(id) as ids
      FROM public.inv_stock_ledger
      WHERE ledger_type IN ('TRANSFER_IN', 'TRANSFER_OUT')
      GROUP BY reference_number, ledger_type, location_id, item_id
      HAVING COUNT(*) > 1
    `);

    let totalDeleted = 0;
    const affectedLocations = new Set();
    const affectedItems = new Set();

    if (duplicateGroups.rows.length === 0) {
      console.log('No duplicate transfer entries found.');
    } else {
      for (const group of duplicateGroups.rows) {
        // Keep the first ID, delete the rest
        const [keepId, ...deleteIds] = group.ids;
        console.log(`Found ${group.cnt} entries for Ref: ${group.reference_number}, Item: ${group.item_id}. Keeping: ${keepId}, Deleting: ${deleteIds.length} rows.`);
        
        if (isExecute) {
          await client.query(`DELETE FROM public.inv_stock_ledger WHERE id = ANY($1)`, [deleteIds]);
        }
        
        totalDeleted += deleteIds.length;
        affectedLocations.add(group.location_id);
        affectedItems.add(group.item_id);
      }
      
      console.log(`\nSummary: ${isExecute ? 'Deleted' : 'Would delete'} ${totalDeleted} duplicate rows.`);
    }

    if (isExecute && affectedLocations.size > 0) {
      console.log('\nRecalculating affected balances...');
      for (const locId of affectedLocations) {
        for (const itemId of affectedItems) {
          const balRes = await client.query(`
            SELECT COALESCE(SUM(quantity_change), 0) as balance
            FROM public.inv_stock_ledger
            WHERE location_id = $1 AND item_id = $2
          `, [locId, itemId]);
          console.log(`Location: ${locId}, Item: ${itemId} -> New Balance: ${balRes.rows[0].balance}`);
        }
      }
    }

    if (!isExecute) {
      console.log('\nRun with --execute to apply changes.');
    }

  } catch (err) {
    console.error('Error during repair:', err);
  } finally {
    client.release();
    pool.end();
  }
}

main();
