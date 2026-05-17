const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    console.log('--- Open orders with items structure ---');
    const res = await pool.query("SELECT id, table_number, items, total_amount FROM public.pos_orders WHERE status = 'open'");
    console.log('Found', res.rows.length, 'open orders');

    for (const order of res.rows) {
      console.log(`\nOrder ID: ${order.id}, Table: ${order.table_number}, Total: ${order.total_amount}`);
      console.log('Items structure:');
      if (Array.isArray(order.items)) {
        order.items.forEach((item, idx) => {
          console.log(`  Item ${idx + 1}:`, {
            hasMenuItem: !!item.menuItem,
            menuItemName: item.menuItem?.name,
            directName: item.name,
            quantity: item.quantity,
            subtotal: item.subtotal
          });
        });
      } else {
        console.log('  No items array');
      }
    }

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
