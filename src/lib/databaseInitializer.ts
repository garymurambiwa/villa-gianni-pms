import db from '@/lib/db'
import { adminPermissionFixService } from '@/lib/adminPermissionFixService'
import pmsAuthDb from '@/lib/pmsAuthDb'

export async function initializeDatabase(): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const configured = await db.isConfigured()
    if (!configured) return { ok: false, error: 'DB_NOT_CONFIGURED' }
    
    const test = await db.testConnection()
    if (!test.ok) return { ok: false, error: test.error || 'DB_CONNECTION_FAILED' }
    
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
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS table_status (
          table_id VARCHAR(20) PRIMARY KEY,
          status VARCHAR(50) NOT NULL DEFAULT 'available',
          last_update TIMESTAMP NOT NULL DEFAULT NOW()
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
      `)
    } catch (e) { 
      console.log('Table creation note:', e)
    }
    
    // Create indexes
    try {
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_reservations_guest ON reservations(guest_id)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_reservations_room ON reservations(room_id)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_pos_orders_status ON pos_orders(status)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_table_status_status ON table_status(status)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_table_status_last_update ON table_status(last_update)`)
      await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS pos_open_unique ON pos_orders(table_number) WHERE status = 'open'`)
    } catch (e) { /* ignore if exists */ }

    // Note: No seed data is inserted - rooms and POS items will be empty
    // User should add their own data through the application
    
    return { ok: true, message: 'DB initialized successfully' }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'INIT_FAILED' }
  }
}
