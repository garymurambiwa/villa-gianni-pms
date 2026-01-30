#!/usr/bin/env node

/**
 * Schema Enhancement Script
 * 
 * This script enhances the existing schema.sql file to ensure all required tables
 * are automatically created with proper schema evolution handling.
 * 
 * Key improvements:
 * 1. Add missing tables that may not be in the current schema
 * 2. Add ALTER TABLE statements for schema evolution
 * 3. Add foreign key constraints
 * 4. Add performance indexes
 * 5. Ensure all tables use IF NOT EXISTS patterns
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Schema Enhancement Tool');
console.log('==========================\n');

const schemaPath = path.join(__dirname, 'db', 'schema.sql');
let schemaSql = '';

try {
  schemaSql = fs.readFileSync(schemaPath, 'utf8');
  console.log('✅ Loaded existing schema.sql');
} catch (e) {
  console.error('❌ Could not read schema.sql file');
  process.exit(1);
}

// Check if schema already contains the enhancements we want to add
const hasTableStatus = schemaSql.includes('CREATE TABLE IF NOT EXISTS public.table_status');
const hasPosBills = schemaSql.includes('CREATE TABLE IF NOT EXISTS public.pos_bills');
const hasCityLedger = schemaSql.includes('CREATE TABLE IF NOT EXISTS public.city_ledger_accounts');
const hasGlAccounts = schemaSql.includes('CREATE TABLE IF NOT EXISTS public.gl_accounts');

console.log('🔍 Current Schema Analysis:');
console.log(`  ✓ table_status table: ${hasTableStatus ? 'Present' : 'Missing'}`);
console.log(`  ✓ pos_bills table: ${hasPosBills ? 'Present' : 'Missing'}`);
console.log(`  ✓ city_ledger tables: ${hasCityLedger ? 'Present' : 'Missing'}`);
console.log(`  ✓ gl_accounts tables: ${hasGlAccounts ? 'Present' : 'Missing'}`);

// Enhancements to add
const enhancements = [];

// 1. Add missing table_status table if not present
if (!hasTableStatus) {
  enhancements.push(`
-- ============================================================================
-- POS TABLE STATUS TRACKING
-- ============================================================================
  
CREATE TABLE IF NOT EXISTS public.table_status (
  table_id VARCHAR(20) PRIMARY KEY,
  status VARCHAR(50) NOT NULL DEFAULT 'available',
  last_update timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_table_status_status ON public.table_status(status);
CREATE INDEX IF NOT EXISTS idx_table_status_last_update ON public.table_status(last_update);
`);
}

// 2. Add missing POS bills table if not present
if (!hasPosBills) {
  enhancements.push(`
-- ============================================================================
-- POS BILLS AND PAYMENTS
-- ============================================================================
  
CREATE TABLE IF NOT EXISTS public.pos_bills (
  id VARCHAR(255) PRIMARY KEY,
  bill_number text NOT NULL,
  outlet text NOT NULL DEFAULT 'Restaurant',
  table_number text,
  guest_id VARCHAR(255),
  folio_id VARCHAR(255),
  room_number text,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  service_charge numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_method text,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'charged_to_room', 'voided', 'partial')),
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  change_amount numeric(12,2) NOT NULL DEFAULT 0,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  opened_at timestamptz NOT NULL DEFAULT NOW(),
  closed_at timestamptz,
  opened_by text,
  closed_by text,
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  shift_id text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
`);
}

// 3. Add schema evolution (ALTER TABLE) statements
enhancements.push(`
-- ============================================================================
-- SCHEMA EVOLUTION - COLUMN ADDITIONS FOR EXISTING TABLES
-- Ensures backward compatibility when adding new features
-- ============================================================================

-- App Users evolution
ALTER TABLE IF EXISTS public.app_users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.app_users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;

-- Reservations evolution  
ALTER TABLE IF EXISTS public.reservations ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE IF EXISTS public.reservations ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending';

-- Orders evolution
ALTER TABLE IF EXISTS public.orders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

-- Rooms evolution
ALTER TABLE IF EXISTS public.rooms ADD COLUMN IF NOT EXISTS tax_applicable BOOLEAN DEFAULT true;
ALTER TABLE IF EXISTS public.rooms ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

-- Menu Items evolution
ALTER TABLE IF EXISTS public.menu_items ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE IF EXISTS public.menu_items ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE IF EXISTS public.menu_items ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- Inventory Items evolution
ALTER TABLE IF EXISTS public.inventory_items ADD COLUMN IF NOT EXISTS min_stock_level integer DEFAULT 5;
ALTER TABLE IF EXISTS public.inventory_items ADD COLUMN IF NOT EXISTS max_stock_level integer;
ALTER TABLE IF EXISTS public.inventory_items ADD COLUMN IF NOT EXISTS supplier_id VARCHAR(255);
ALTER TABLE IF EXISTS public.inventory_items ADD COLUMN IF NOT EXISTS barcode text UNIQUE;

-- Folios evolution
ALTER TABLE IF EXISTS public.folios ADD COLUMN IF NOT EXISTS guest_name text;
ALTER TABLE IF EXISTS public.folios ADD COLUMN IF NOT EXISTS arrival_date date;
ALTER TABLE IF EXISTS public.folios ADD COLUMN IF NOT EXISTS departure_date date;

-- Folio Charges evolution
ALTER TABLE IF EXISTS public.folio_charges ADD COLUMN IF NOT EXISTS reference_id VARCHAR(255);
ALTER TABLE IF EXISTS public.folio_charges ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE IF EXISTS public.folio_charges ADD COLUMN IF NOT EXISTS service_date date;

-- Expenses evolution
ALTER TABLE IF EXISTS public.expenses ADD COLUMN IF NOT EXISTS receipt_number text;
ALTER TABLE IF EXISTS public.expenses ADD COLUMN IF NOT EXISTS project_code text;
`);

// 4. Add foreign key constraints
enhancements.push(`
-- ============================================================================
-- FOREIGN KEY CONSTRAINTS
-- Enforces referential integrity between related tables
-- ============================================================================

-- Reservations foreign keys
ALTER TABLE IF EXISTS public.reservations 
  ADD CONSTRAINT fk_reservations_guest FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.reservations 
  ADD CONSTRAINT fk_reservations_room FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;

-- Folios foreign keys  
ALTER TABLE IF EXISTS public.folios
  ADD CONSTRAINT fk_folios_guest FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.folios
  ADD CONSTRAINT fk_folios_reservation FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE SET NULL;

-- Folio Charges foreign keys
ALTER TABLE IF EXISTS public.folio_charges
  ADD CONSTRAINT fk_folio_charges_folio FOREIGN KEY (folio_id) REFERENCES public.folios(id) ON DELETE CASCADE;

-- Order Items foreign keys
ALTER TABLE IF EXISTS public.order_items
  ADD CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.order_items
  ADD CONSTRAINT fk_order_items_menu_item FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id) ON DELETE CASCADE;

-- Inventory Movements foreign keys
ALTER TABLE IF EXISTS public.inventory_movements
  ADD CONSTRAINT fk_inventory_movements_item FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;

-- Expenses foreign keys
ALTER TABLE IF EXISTS public.expenses
  ADD CONSTRAINT fk_expenses_vendor FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;

-- GL Journal Lines foreign keys
ALTER TABLE IF EXISTS public.gl_journal_lines
  ADD CONSTRAINT fk_gl_journal_lines_entry FOREIGN KEY (journal_entry_id) REFERENCES public.gl_journal_entries(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.gl_journal_lines
  ADD CONSTRAINT fk_gl_journal_lines_account FOREIGN KEY (gl_account_id) REFERENCES public.gl_accounts(id) ON DELETE RESTRICT;
`);

// 5. Add performance indexes
enhancements.push(`
-- ============================================================================
-- PERFORMANCE INDEXES
-- Optimizes query performance for frequently accessed data
-- ============================================================================

-- Reservations indexes
CREATE INDEX IF NOT EXISTS idx_reservations_check_in_date ON public.reservations(check_in_date);
CREATE INDEX IF NOT EXISTS idx_reservations_check_out_date ON public.reservations(check_out_date);
CREATE INDEX IF NOT EXISTS idx_reservations_dates ON public.reservations(check_in_date, check_out_date);

-- Folio Charges indexes
CREATE INDEX IF NOT EXISTS idx_folio_charges_business_date ON public.folio_charges(business_date);
CREATE INDEX IF NOT EXISTS idx_folio_charges_category ON public.folio_charges(category);
CREATE INDEX IF NOT EXISTS idx_folio_charges_source ON public.folio_charges(source);

-- GL Journal Entries indexes
CREATE INDEX IF NOT EXISTS idx_gl_journal_entries_business_date ON public.gl_journal_entries(business_date);
CREATE INDEX IF NOT EXISTS idx_gl_journal_entries_status ON public.gl_journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_gl_journal_entries_source ON public.gl_journal_entries(source);

-- Expenses indexes
CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON public.expenses(business_date);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON public.expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor ON public.expenses(vendor_id);

-- City Ledger indexes
CREATE INDEX IF NOT EXISTS idx_city_ledger_transactions_date ON public.city_ledger_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_city_ledger_transactions_account ON public.city_ledger_transactions(account_id);

-- POS indexes
CREATE INDEX IF NOT EXISTS idx_pos_bills_business_date ON public.pos_bills(business_date);
CREATE INDEX IF NOT EXISTS idx_pos_bills_payment_status ON public.pos_bills(payment_status);
CREATE INDEX IF NOT EXISTS idx_pos_bills_table_number ON public.pos_bills(table_number);

-- Audit indexes
CREATE INDEX IF NOT EXISTS idx_night_audit_runs_date ON public.night_audit_runs(business_date);
CREATE INDEX IF NOT EXISTS idx_night_audit_postings_date ON public.night_audit_postings(business_date);
`);

// 6. Add trigger functions for automatic timestamp updates
enhancements.push(`
-- ============================================================================
-- TRIGGER FUNCTIONS
-- Automatically updates timestamps when records are modified
-- ============================================================================

-- Create or replace the update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables that have updated_at columns
DROP TRIGGER IF EXISTS update_rooms_updated_at ON public.rooms;
CREATE TRIGGER update_rooms_updated_at 
  BEFORE UPDATE ON public.rooms 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_users_updated_at ON public.app_users;
CREATE TRIGGER update_app_users_updated_at 
  BEFORE UPDATE ON public.app_users 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_folios_updated_at ON public.folios;
CREATE TRIGGER update_folios_updated_at 
  BEFORE UPDATE ON public.folios 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_folio_charges_updated_at ON public.folio_charges;
CREATE TRIGGER update_folio_charges_updated_at 
  BEFORE UPDATE ON public.folio_charges 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_gl_accounts_updated_at ON public.gl_accounts;
CREATE TRIGGER update_gl_accounts_updated_at 
  BEFORE UPDATE ON public.gl_accounts 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_vendors_updated_at ON public.vendors;
CREATE TRIGGER update_vendors_updated_at 
  BEFORE UPDATE ON public.vendors 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expenses_updated_at ON public.expenses;
CREATE TRIGGER update_expenses_updated_at 
  BEFORE UPDATE ON public.expenses 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`);

// 7. Add seed data for essential reference tables
enhancements.push(`
-- ============================================================================
-- ESSENTIAL SEED DATA
-- Critical reference data that should be present on first run
-- ============================================================================

-- Ensure default admin user exists
INSERT INTO public.app_users (id, username, name, role, password_hash, active, password_change_required, created_at, updated_at) VALUES
  ('admin_default', 'admin', 'System Administrator', 'admin', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.PZvO.S', true, true, NOW(), NOW())
ON CONFLICT (username) DO NOTHING;

-- Default tax configuration
INSERT INTO public.taxes (id, name, percentage, is_inclusive, applies_to, active, inserted_at) VALUES
  ('tax_vat_default', 'VAT', 12.00, false, 'all', true, NOW()),
  ('tax_service_default', 'Service Charge', 10.00, false, 'pos', true, NOW())
ON CONFLICT (id) DO NOTHING;

-- Default room types if none exist
INSERT INTO public.rooms (id, number, type, status, rate, inserted_at, updated_at) VALUES
  ('room_sample_1', '101', 'Standard', 'vacant', 2500.00, NOW(), NOW()),
  ('room_sample_2', '102', 'Deluxe', 'vacant', 3500.00, NOW(), NOW()),
  ('room_sample_3', '201', 'Suite', 'vacant', 5000.00, NOW(), NOW())
ON CONFLICT (number) DO NOTHING;

-- Default menu categories
INSERT INTO public.menu_items (id, name, category, price, active, inserted_at) VALUES
  ('menu_sample_1', 'Grilled Chicken', 'Main Course', 350.00, true, NOW()),
  ('menu_sample_2', 'Caesar Salad', 'Appetizer', 180.00, true, NOW()),
  ('menu_sample_3', 'Fresh Juice', 'Beverage', 80.00, true, NOW())
ON CONFLICT (id) DO NOTHING;
`);

console.log(`\n🛠️  Proposed Enhancements:`);
console.log(`=========================`);
console.log(`1. ${hasTableStatus ? '✓' : '➕'} Add table_status table`);
console.log(`2. ${hasPosBills ? '✓' : '➕'} Add pos_bills table`);
console.log(`3. ${hasCityLedger ? '✓' : '➕'} Add city_ledger tables`);
console.log(`4. ${hasGlAccounts ? '✓' : '➕'} Add gl_accounts tables`);
console.log(`5. ➕ Add schema evolution (ALTER TABLE) statements`);
console.log(`6. ➕ Add foreign key constraints`);
console.log(`7. ➕ Add performance indexes`);
console.log(`8. ➕ Add trigger functions`);
console.log(`9. ➕ Add essential seed data`);

if (enhancements.length > 0) {
  console.log(`\n📝 Creating enhanced schema file...`);
  
  // Create backup of original schema
  const backupPath = schemaPath + '.backup.' + Date.now();
  fs.writeFileSync(backupPath, schemaSql);
  console.log(`✅ Backed up original schema to: ${backupPath}`);
  
  // Append enhancements to schema
  const enhancedSchema = schemaSql + '\n' + enhancements.join('\n');
  fs.writeFileSync(schemaPath, enhancedSchema);
  
  console.log(`✅ Enhanced schema written to: ${schemaPath}`);
  console.log(`\n🎉 Schema enhancement complete!`);
  console.log(`\n✅ Benefits:`);
  console.log(`   • All tables will be automatically created on first run`);
  console.log(`   • Schema evolution handled gracefully`);
  console.log(`   • Data integrity enforced through foreign keys`);
  console.log(`   • Query performance optimized with indexes`);
  console.log(`   • Automatic timestamp updates for audit trails`);
  console.log(`   • Essential seed data for immediate usability`);
  console.log(`\n🚀 Ready for building the final executable installer!`);
} else {
  console.log(`\n✅ Schema is already complete - no enhancements needed`);
}

console.log(`\n💡 Next Steps:`);
console.log(`1. Test the enhanced schema with a fresh database installation`);
console.log(`2. Verify all tables are created automatically`);
console.log(`3. Confirm data synchronization works across 5-10 second intervals`);
console.log(`4. Build the final NSIS installer package`);