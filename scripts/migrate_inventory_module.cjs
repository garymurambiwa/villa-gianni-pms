const { Client } = require('pg');
const crypto = require('crypto');

const connectionString = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function migrate() {
  const client = new Client(connectionString);
  await client.connect();

  console.log('--- Creating Inventory Tables ---');

  // 1. Inventory Periods
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_periods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      closed_at TIMESTAMP WITH TIME ZONE,
      closed_by TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  console.log('- inventory_periods created.');

  // 2. Inventory Transactions
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period_id UUID REFERENCES inventory_periods(id),
      product_id TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      unit_price NUMERIC,
      total_price NUMERIC,
      transaction_date DATE NOT NULL,
      is_audit_backfill BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_by TEXT
    );
  `);
  console.log('- inventory_transactions created.');

  // 3. Inventory Snapshots
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period_id UUID REFERENCES inventory_periods(id),
      product_id TEXT NOT NULL,
      opening_qty NUMERIC DEFAULT 0,
      received_qty NUMERIC DEFAULT 0,
      system_usage_qty NUMERIC DEFAULT 0,
      physical_qty NUMERIC,
      variance NUMERIC,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  console.log('- inventory_snapshots created.');

  await client.end();
  console.log('--- Migration Finished ---');
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
