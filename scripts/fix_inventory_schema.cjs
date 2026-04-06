const { Client } = require('pg');

const client = new Client('postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require');

async function migrate() {
  await client.connect();
  console.log('--- Aligning inventory_periods table ---');
  try {
    await client.query(`
      ALTER TABLE inventory_periods 
      ADD COLUMN IF NOT EXISTS period_name TEXT,
      ADD COLUMN IF NOT EXISTS period_year INTEGER,
      ADD COLUMN IF NOT EXISTS period_month INTEGER,
      ADD COLUMN IF NOT EXISTS opening_stock_value NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS received_value NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS kitchen_cogs NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cellar_cogs NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS closing_stock_value NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS variance_value NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS cogs_value NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reopened_by TEXT,
      ADD COLUMN IF NOT EXISTS created_by TEXT
    `);
    console.log('inventory_periods aligned.');

    console.log('--- Creating inventory_period_audit table ---');
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_period_audit (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        period_id UUID NOT NULL REFERENCES inventory_periods(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        user_id TEXT,
        user_name TEXT,
        is_historical_backfill BOOLEAN DEFAULT false,
        ts TIMESTAMPTZ DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'::jsonb
      )
    `);
    console.log('inventory_period_audit created.');

    console.log('--- Creating inventory_snapshots table ---');
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        period_id UUID NOT NULL REFERENCES inventory_periods(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        opening_stock NUMERIC(12,2) DEFAULT 0,
        received_stock NUMERIC(12,2) DEFAULT 0,
        closing_stock NUMERIC(12,2),
        cost_price NUMERIC(12,2),
        total_value NUMERIC(12,4),
        department TEXT,
        ts TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('inventory_snapshots created.');

    console.log('--- Ensuring inventory_transactions has period_id ---');
    await client.query(`
      ALTER TABLE inventory_transactions 
      ALTER COLUMN period_id TYPE UUID USING period_id::uuid
    `);
    console.log('inventory_transactions updated.');

  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

migrate().catch(console.error);
