import db from '@/lib/db'
import { adminPermissionFixService } from '@/lib/adminPermissionFixService'
import pmsAuthDb from '@/lib/pmsAuthDb'
import { DEFAULT_ROOMS } from '@/data/defaultRooms'
import { databaseMigrationService } from './databaseMigrationService'

export async function initializeDatabase(): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const configured = await db.isConfigured()
    if (!configured) {
      console.log('[DatabaseInitializer] Database not configured - running in demo mode')
      return { ok: false, error: 'DB_NOT_CONFIGURED' }
    }

    const test = await db.testConnection()
    if (!test.ok) {
      console.log('[DatabaseInitializer] Database connection failed - running in demo mode:', test.error)
      return { ok: false, error: test.error || 'DB_CONNECTION_FAILED' }
    }
    
    try {
      const migrationResult = await databaseMigrationService.runMigrations()
      if (!migrationResult.success) {
        console.log('[DatabaseInitializer] Migration warnings:', migrationResult.message)
      }
    } catch (e: any) {
      console.log('[DatabaseInitializer] Migration note:', e.message)
    }
    
    // Initialize auth tables (PostgreSQL)
    await pmsAuthDb.init()
    
    // Fix admin permissions
    const fix = await adminPermissionFixService.quickFix()
    if (!fix.success) return { ok: false, error: fix.error || 'ADMIN_FIX_FAILED' }
    
    // Create core tables using PostgreSQL syntax
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          id VARCHAR(36) PRIMARY KEY,
          number VARCHAR(50) UNIQUE NOT NULL,
          type VARCHAR(50) NOT NULL,
          rate NUMERIC(12,2) NOT NULL DEFAULT 0,
          status VARCHAR(50) NOT NULL DEFAULT 'vacant',
          floor INTEGER NOT NULL DEFAULT 1,
          is_active BOOLEAN NOT NULL DEFAULT true,
          tax_applicable BOOLEAN DEFAULT true,
          inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS reservations (
          id VARCHAR(36) PRIMARY KEY,
          guest_id VARCHAR(36),
          room_id VARCHAR(36),
          check_in DATE NOT NULL,
          check_out DATE NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'confirmed',
          package_code VARCHAR(50) DEFAULT 'RO',
          tax_inclusive BOOLEAN DEFAULT false,
          payment_verified BOOLEAN DEFAULT false,
          payment_info_source TEXT,
          inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS pos_orders (
          id VARCHAR(36) PRIMARY KEY,
          table_number VARCHAR(20),
          items JSONB,
          total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          status VARCHAR(50) NOT NULL DEFAULT 'open',
          cost_center VARCHAR(50),
          shift_id VARCHAR(36),
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pos_shifts (
          id VARCHAR(36) PRIMARY KEY,
          cost_center VARCHAR(50) NOT NULL,
          opened_by VARCHAR(36) NOT NULL,
          opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
          closed_at TIMESTAMP,
          opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
          closing_cash NUMERIC(12,2),
          status VARCHAR(20) NOT NULL DEFAULT 'open',
          inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS table_status (
          table_id VARCHAR(20),
          cost_center VARCHAR(50),
          status VARCHAR(50) NOT NULL DEFAULT 'available',
          last_update TIMESTAMP NOT NULL DEFAULT NOW(),
          PRIMARY KEY (table_id, cost_center)
        );
        
        CREATE TABLE IF NOT EXISTS inventory_items (
          id VARCHAR(36) PRIMARY KEY,
          name TEXT NOT NULL,
          category VARCHAR(50),
          stock_level NUMERIC NOT NULL DEFAULT 0,
          price NUMERIC(12,2) NOT NULL DEFAULT 0,
          inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS menu_items (
          id VARCHAR(36) PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price NUMERIC(12,2) NOT NULL,
          active BOOLEAN NOT NULL DEFAULT true,
          inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS products (
          id VARCHAR(36) PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT,
          department TEXT,
          price NUMERIC(12,2) NOT NULL DEFAULT 0,
          cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          stock_level NUMERIC(12,2) NOT NULL DEFAULT 0,
          unit TEXT,
          active BOOLEAN NOT NULL DEFAULT true,
          visibility TEXT,
          is_stock_item BOOLEAN NOT NULL DEFAULT true,
          category_id TEXT,
          sub_id TEXT,
          parent_sub_id TEXT,
          notes TEXT,
          barcodes TEXT,
          cos_percent NUMERIC(12,2),
          gp_percent NUMERIC(12,2),
          gp_amount NUMERIC(12,2),
          qty_received NUMERIC(12,2),
          image_bg_color TEXT,
          picture_data TEXT,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS inventory_periods (
          id VARCHAR(36) PRIMARY KEY,
          name TEXT NOT NULL,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'open',
          closed_at TIMESTAMP,
          closed_by VARCHAR(36),
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS inventory_transactions (
          id VARCHAR(36) PRIMARY KEY,
          period_id VARCHAR(36) NOT NULL,
          product_id VARCHAR(36) NOT NULL,
          type VARCHAR(50) NOT NULL DEFAULT 'purchase',
          quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
          unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          total_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          transaction_date DATE,
          is_audit_backfill BOOLEAN DEFAULT false,
          created_by VARCHAR(36),
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS inventory_snapshots (
          period_id VARCHAR(36) NOT NULL,
          product_id VARCHAR(36) NOT NULL,
          physical_qty NUMERIC(12,2),
          variance NUMERIC(12,2),
          opening_qty NUMERIC(12,2) DEFAULT 0,
          received_qty NUMERIC(12,2) DEFAULT 0,
          system_usage_qty NUMERIC(12,2) DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          PRIMARY KEY (period_id, product_id)
        );

        CREATE TABLE IF NOT EXISTS pos_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        INSERT INTO pos_settings (key, value) VALUES ('vat_rate', '0.10') ON CONFLICT DO NOTHING;
        INSERT INTO pos_settings (key, value) VALUES ('service_charge', '0.00') ON CONFLICT DO NOTHING;
        INSERT INTO pos_settings (key, value) VALUES ('currency_symbol', '$') ON CONFLICT DO NOTHING;
      `)
    } catch (e) { 
      console.log('Table creation note:', e)
    }

    // Ensure inventory-related columns on products
    try { await db.exec(`ALTER TABLE products ADD COLUMN IF NOT EXISTS bar_visibility BOOLEAN DEFAULT false`); } catch (e) { }
    try { await db.exec(`ALTER TABLE products ADD COLUMN IF NOT EXISTS restaurant_visibility BOOLEAN DEFAULT false`); } catch (e) { }

    // Patch existing tables to add missing columns (safe for existing deployments)
    try { await db.exec(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`); } catch (e) { console.log('rooms.is_active column note:', e); }
    try { await db.exec(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS floor INTEGER NOT NULL DEFAULT 1`); } catch (e) { console.log('rooms.floor column note:', e); }
    try { await db.exec(`ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS cost_center VARCHAR(50)`); } catch (e) { }
    try { await db.exec(`ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS shift_id VARCHAR(36)`); } catch (e) { }
    try { await db.exec(`ALTER TABLE table_status ADD COLUMN IF NOT EXISTS cost_center VARCHAR(50) DEFAULT 'Main Restaurant'`); } catch (e) { }
    try { await db.exec(`ALTER TABLE guests ADD COLUMN IF NOT EXISTS id_number TEXT`); } catch (e) { console.log('guests.id_number column note:', e); }
    
    // Create indexes
    try {
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_reservations_guest ON reservations(guest_id)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_reservations_room ON reservations(room_id)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_pos_orders_status ON pos_orders(status)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_pos_orders_cost_center ON pos_orders(cost_center)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_pos_shifts_status ON pos_shifts(status)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_table_status_status ON table_status(status)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_table_status_cost_center ON table_status(cost_center)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_table_status_last_update ON table_status(last_update)`)
      await db.exec(`DROP INDEX IF EXISTS pos_open_unique`);
      await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS pos_open_unique ON pos_orders(table_number, cost_center) WHERE status = 'open'`)
    } catch (e) { /* ignore if exists */ }

    // Safe room seeding: Only seed if the table is empty
    try {
      const roomCountRes = await db.query('SELECT COUNT(*) FROM rooms');
      const count = parseInt((roomCountRes as any).rows[0].count);
      
      if (count === 0) {
        console.log('DatabaseInitializer: Seeding default rooms...');
        for (const room of DEFAULT_ROOMS) {
          await db.query(
            'INSERT INTO rooms (id, number, type, floor, rate, status) VALUES (?, ?, ?, ?, ?, ?)',
            [room.id, room.number, room.type, room.floor || 1, room.rate, room.status]
          );
        }
        console.log('DatabaseInitializer: Seeding completed.');
      } else {
        console.log('DatabaseInitializer: Rooms already exist, skipping seed.');
      }
    } catch (e) {
      console.error('DatabaseInitializer: Room seeding failed:', e);
    }
    
    // Note: User can add their own data through the application
    
    return { ok: true, message: 'DB initialized successfully' }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'INIT_FAILED' }
  }
}
