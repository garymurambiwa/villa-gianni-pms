const { Client } = require('pg');

const client = new Client('postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require');

async function migrate() {
  await client.connect();
  try {
    console.log('Adding visibility boolean columns to products table...');
    
    // Add columns if they don't exist
    await client.query(`
      ALTER TABLE products 
      ADD COLUMN IF NOT EXISTS bar_visibility BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS restaurant_visibility BOOLEAN DEFAULT TRUE;
    `);

    // Migrate existing data from JSON visibility text if available
    const res = await client.query('SELECT id, visibility FROM products');
    console.log(`Migrating ${res.rows.length} rows...`);
    
    for (const row of res.rows) {
      if (!row.visibility) continue;
      
      try {
        const vis = JSON.parse(row.visibility);
        const barVis = !!vis.bar;
        const restVis = !!vis.restaurant;
        
        await client.query(
          'UPDATE products SET bar_visibility = $1, restaurant_visibility = $2 WHERE id = $3',
          [barVis, restVis, row.id]
        );
      } catch (e) {
        console.warn(`Could not parse visibility for product ${row.id}:`, row.visibility);
      }
    }
    
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();
