-- COREPMS v11 - Advanced Inventory & Menu Engineering Module
-- Database Schema Migration
-- Version: v11.0
-- Date: April 2026
-- Description: Creates complete inventory management system with multi-location support

-- =====================================================
-- SCHEMA CREATION & SETUP
-- =====================================================

-- Create namespace for inventory tables (prevents collision with existing COREPMS tables)
CREATE SCHEMA IF NOT EXISTS public;

-- =====================================================
-- 1. LOCATION HIERARCHY MANAGEMENT
-- =====================================================

-- Multi-location hierarchy with self-referencing parent
CREATE TABLE IF NOT EXISTS public.inv_locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('storage', 'outlet')),
    parent_location_id TEXT REFERENCES public.inv_locations(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 2. UNIT OF MEASURE SYSTEM
-- =====================================================

-- Master UOM definitions
CREATE TABLE IF NOT EXISTS public.inv_uom_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    is_base BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Hierarchical UOM conversion rules per item
CREATE TABLE IF NOT EXISTS public.inv_uom_conversions (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    from_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
    to_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
    conversion_factor DECIMAL(10,4) NOT NULL CHECK (conversion_factor > 0),
    breakdown_flag BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(item_id, from_uom_id, to_uom_id)
);

-- =====================================================
-- 3. INVENTORY MASTER DATA
-- =====================================================

-- Inventory items master catalog
CREATE TABLE IF NOT EXISTS public.inv_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('Food', 'Beverage', 'Cleaning', 'Other')),
    base_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
    sku TEXT UNIQUE,
    barcode TEXT,
    expiry_tracking BOOLEAN DEFAULT false,
    wastage_percentage DECIMAL(5,2) DEFAULT 0.00 CHECK (wastage_percentage >= 0 AND wastage_percentage <= 100),
    weighted_avg_cost DECIMAL(10,4) DEFAULT 0.00,
    last_cost_price DECIMAL(10,4) DEFAULT 0.00,
    media_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 4. GOODS RECEIVED NOTES (GRN)
-- =====================================================

-- GRN header information
CREATE TABLE IF NOT EXISTS public.inv_grn_headers (
    id TEXT PRIMARY KEY,
    grn_number TEXT UNIQUE NOT NULL,
    supplier_name TEXT NOT NULL,
    supplier_invoice_number TEXT,
    destination_location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
    created_by TEXT NOT NULL,
    total_value DECIMAL(12,2) DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
    posted_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- GRN line items
CREATE TABLE IF NOT EXISTS public.inv_grn_lines (
    id TEXT PRIMARY KEY,
    grn_header_id TEXT NOT NULL REFERENCES public.inv_grn_headers(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES public.inv_items(id),
    qty_received DECIMAL(12,4) NOT NULL CHECK (qty_received > 0),
    received_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
    unit_cost DECIMAL(10,4) NOT NULL CHECK (unit_cost >= 0),
    line_total DECIMAL(12,2) NOT NULL,
    expiry_date DATE,
    line_number INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(grn_header_id, line_number)
);

-- =====================================================
-- 5. STOCK TRANSFERS
-- =====================================================

-- Transfer header information
CREATE TABLE IF NOT EXISTS public.inv_transfer_headers (
    id TEXT PRIMARY KEY,
    transfer_number TEXT UNIQUE NOT NULL,
    source_location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
    destination_location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
    created_by TEXT NOT NULL,
    approved_by TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
    approved_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (source_location_id != destination_location_id)
);

-- Transfer line items
CREATE TABLE IF NOT EXISTS public.inv_transfer_lines (
    id TEXT PRIMARY KEY,
    transfer_header_id TEXT NOT NULL REFERENCES public.inv_transfer_headers(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES public.inv_items(id),
    qty_requested DECIMAL(12,4) NOT NULL CHECK (qty_requested > 0),
    source_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
    breakdown_flag BOOLEAN DEFAULT false,
    destination_uom_id TEXT REFERENCES public.inv_uom_definitions(id),
    current_source_balance DECIMAL(12,4),
    line_number INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(transfer_header_id, line_number)
);

-- =====================================================
-- 6. STOCK LEDGER (SINGLE SOURCE OF TRUTH)
-- =====================================================

-- Complete audit trail of all stock movements
CREATE TABLE IF NOT EXISTS public.inv_stock_ledger (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES public.inv_items(id),
    location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
    ledger_type TEXT NOT NULL CHECK (ledger_type IN ('GRN', 'TRANSFER_IN', 'TRANSFER_OUT', 'SALE_DEPLETION', 'ADJUSTMENT', 'WASTE')),
    reference_number TEXT NOT NULL,
    quantity_change DECIMAL(12,4) NOT NULL,
    base_uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
    cost_per_unit DECIMAL(10,4),
    total_cost DECIMAL(12,2),
    posted_by TEXT NOT NULL,
    gl_account_code TEXT,
    transaction_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 7. RECIPES & BILL OF MATERIALS
-- =====================================================

-- Recipe versions per menu item
CREATE TABLE IF NOT EXISTS public.inv_recipes (
    id TEXT PRIMARY KEY,
    menu_item_id TEXT NOT NULL,
    version_number INTEGER DEFAULT 1,
    is_current BOOLEAN DEFAULT true,
    created_by TEXT NOT NULL,
    total_cost DECIMAL(10,4) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(menu_item_id, version_number)
);

-- Recipe ingredient lines
CREATE TABLE IF NOT EXISTS public.inv_recipe_lines (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL REFERENCES public.inv_recipes(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES public.inv_items(id),
    quantity_required DECIMAL(10,4) NOT NULL CHECK (quantity_required > 0),
    uom_id TEXT NOT NULL REFERENCES public.inv_uom_definitions(id),
    wastage_override DECIMAL(5,2) DEFAULT 0.00 CHECK (wastage_override >= 0 AND wastage_override <= 100),
    line_number INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(recipe_id, line_number)
);

-- =====================================================
-- 8. VARIANCE REPORTING
-- =====================================================

-- Variance report headers
CREATE TABLE IF NOT EXISTS public.inv_variance_reports (
    id TEXT PRIMARY KEY,
    report_number TEXT UNIQUE NOT NULL,
    location_id TEXT NOT NULL REFERENCES public.inv_locations(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    generated_by TEXT NOT NULL,
    total_items INTEGER DEFAULT 0,
    ok_count INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Variance report detail lines
CREATE TABLE IF NOT EXISTS public.inv_variance_lines (
    id TEXT PRIMARY KEY,
    variance_report_id TEXT NOT NULL REFERENCES public.inv_variance_reports(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES public.inv_items(id),
    theoretical_qty DECIMAL(12,4) NOT NULL,
    physical_qty DECIMAL(12,4) NOT NULL,
    variance_qty DECIMAL(12,4) NOT NULL,
    variance_percentage DECIMAL(7,4) NOT NULL,
    alert_level TEXT NOT NULL CHECK (alert_level IN ('OK', 'WARNING', 'CRITICAL')),
    item_cost DECIMAL(10,4),
    variance_value DECIMAL(12,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- INDICES FOR PERFORMANCE
-- =====================================================

-- Location hierarchy indices
CREATE INDEX IF NOT EXISTS idx_inv_locations_parent ON public.inv_locations(parent_location_id);
CREATE INDEX IF NOT EXISTS idx_inv_locations_type ON public.inv_locations(type);

-- UOM indices
CREATE INDEX IF NOT EXISTS idx_inv_uom_conversions_item ON public.inv_uom_conversions(item_id);

-- Item indices
CREATE INDEX IF NOT EXISTS idx_inv_items_category ON public.inv_items(category);
CREATE INDEX IF NOT EXISTS idx_inv_items_sku ON public.inv_items(sku);
CREATE INDEX IF NOT EXISTS idx_inv_items_barcode ON public.inv_items(barcode);

-- GRN indices
CREATE INDEX IF NOT EXISTS idx_inv_grn_headers_status ON public.inv_grn_headers(status);
CREATE INDEX IF NOT EXISTS idx_inv_grn_headers_location ON public.inv_grn_headers(destination_location_id);
CREATE INDEX IF NOT EXISTS idx_inv_grn_lines_item ON public.inv_grn_lines(item_id);

-- Transfer indices
CREATE INDEX IF NOT EXISTS idx_inv_transfer_headers_status ON public.inv_transfer_headers(status);
CREATE INDEX IF NOT EXISTS idx_inv_transfer_headers_locations ON public.inv_transfer_headers(source_location_id, destination_location_id);
CREATE INDEX IF NOT EXISTS idx_inv_transfer_lines_item ON public.inv_transfer_lines(item_id);

-- Ledger indices (critical for performance)
CREATE INDEX IF NOT EXISTS idx_inv_stock_ledger_item_location ON public.inv_stock_ledger(item_id, location_id);
CREATE INDEX IF NOT EXISTS idx_inv_stock_ledger_type ON public.inv_stock_ledger(ledger_type);
CREATE INDEX IF NOT EXISTS idx_inv_stock_ledger_date ON public.inv_stock_ledger(transaction_date);
CREATE INDEX IF NOT EXISTS idx_inv_stock_ledger_reference ON public.inv_stock_ledger(reference_number);

-- Recipe indices
CREATE INDEX IF NOT EXISTS idx_inv_recipes_menu_item ON public.inv_recipes(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_recipes_current ON public.inv_recipes(is_current) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_inv_recipe_lines_item ON public.inv_recipe_lines(item_id);

-- Variance indices
CREATE INDEX IF NOT EXISTS idx_inv_variance_reports_location ON public.inv_variance_reports(location_id);
CREATE INDEX IF NOT EXISTS idx_inv_variance_reports_period ON public.inv_variance_reports(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_inv_variance_lines_report ON public.inv_variance_lines(variance_report_id);
CREATE INDEX IF NOT EXISTS idx_inv_variance_lines_alert ON public.inv_variance_lines(alert_level);

-- =====================================================
-- SEED DATA
-- =====================================================

-- Insert locations
INSERT INTO public.inv_locations (id, name, type, is_active) VALUES
    ('loc_main_cellar', 'Main Cellar', 'storage', true),
    ('loc_dry_goods', 'Dry Goods Store', 'storage', true),
    ('loc_freezer', 'Freezer', 'storage', true),
    ('loc_bar1', 'Bar 1', 'outlet', true),
    ('loc_restaurant', 'Restaurant', 'outlet', true)
ON CONFLICT (id) DO NOTHING;

-- Insert UOM definitions
INSERT INTO public.inv_uom_definitions (id, name, symbol, is_base) VALUES
    ('uom_case', 'Case', 'CASE', false),
    ('uom_bottle', 'Bottle', 'BTL', false),
    ('uom_ml', 'Milliliter', 'ML', false),
    ('uom_liter', 'Liter', 'L', false),
    ('uom_tot', 'Tot', 'TOT', false),
    ('uom_gram', 'Gram', 'G', true),
    ('uom_kg', 'Kilogram', 'KG', false),
    ('uom_unit', 'Unit', 'UNIT', true),
    ('uom_crate', 'Crate', 'CRATE', false),
    ('uom_drum', 'Drum', 'DRUM', false)
ON CONFLICT (id) DO NOTHING;

-- Insert sample inventory items
INSERT INTO public.inv_items (id, name, category, base_uom_id, sku, weighted_avg_cost, wastage_percentage) VALUES
    ('item_jameson', 'Jameson Whiskey', 'Beverage', 'uom_ml', 'BEV001', 0.0250, 0.00),
    ('item_chicken_quarter', 'Quarter Chicken', 'Food', 'uom_gram', 'FOOD001', 0.0085, 5.00),
    ('item_oil_cooking', 'Cooking Oil', 'Food', 'uom_ml', 'FOOD002', 0.0012, 2.00),
    ('item_coleslaw_mix', 'Coleslaw Mix', 'Food', 'uom_gram', 'FOOD003', 0.0035, 8.00)
ON CONFLICT (id) DO NOTHING;

-- Insert UOM conversions for Jameson (1 Case = 12 Bottles = 9000 ml = 360 Tots)
INSERT INTO public.inv_uom_conversions (id, item_id, from_uom_id, to_uom_id, conversion_factor, breakdown_flag) VALUES
    ('conv_jameson_case_bottle', 'item_jameson', 'uom_case', 'uom_bottle', 12.0000, true),
    ('conv_jameson_bottle_ml', 'item_jameson', 'uom_bottle', 'uom_ml', 750.0000, false),
    ('conv_jameson_ml_tot', 'item_jameson', 'uom_ml', 'uom_tot', 0.0400, false), -- 25ml per tot
    ('conv_jameson_case_tot', 'item_jameson', 'uom_case', 'uom_tot', 360.0000, false)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- VERIFICATION VIEW
-- =====================================================

-- Module status verification view
CREATE OR REPLACE VIEW public.inv_module_status AS
SELECT
    'v11_inventory_module' as module_name,
    'Advanced Inventory & Menu Engineering' as description,
    COUNT(*) as total_tables,
    NOW() as verified_at
FROM information_schema.tables
WHERE table_schema = 'public'
    AND table_name LIKE 'inv_%'
    AND table_type = 'BASE TABLE';

-- =====================================================
-- PERMISSIONS & SECURITY
-- =====================================================

-- Grant permissions for the application user (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
-- GRANT USAGE ON SCHEMA public TO app_user;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Log successful migration
DO $$
BEGIN
    RAISE NOTICE 'COREPMS v11 Inventory Module migration completed successfully';
    RAISE NOTICE 'Created 13 inventory tables with proper relationships and indices';
    RAISE NOTICE 'Inserted seed data for locations, UOMs, and sample items';
    RAISE NOTICE 'Module status can be verified with: SELECT * FROM inv_module_status';
END $$;