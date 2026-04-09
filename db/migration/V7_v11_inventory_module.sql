-- ============================================================================
-- COREPMS v11 - Advanced Inventory & Menu Engineering Module
-- Migration V7: Multi-location Inventory System with GRN, Transfers, and Recipes
-- Namespace: inv_* (prevents collision with existing tables)
-- Date: 2026-04-09
-- Compatible with: PostgreSQL 17.8+ (Neon)
-- ============================================================================

-- ============================================================================
-- 1. LOCATION HIERARCHY TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_locations (
  id VARCHAR(255) PRIMARY KEY,
  name text NOT NULL UNIQUE,
  location_type text NOT NULL CHECK (location_type IN ('Storage', 'Outlet')),
  parent_location_id VARCHAR(255) REFERENCES public.inv_locations(id) ON DELETE SET NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inv_locations_parent_idx ON public.inv_locations(parent_location_id);
CREATE INDEX IF NOT EXISTS inv_locations_type_idx ON public.inv_locations(location_type);

-- Seed essential locations (only if not exists)
INSERT INTO public.inv_locations (id, name, location_type, description)
SELECT 'loc_main_cellar', 'Main Cellar', 'Storage', 'Bulk spirits, wines, beverages storage'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_locations WHERE id = 'loc_main_cellar');

INSERT INTO public.inv_locations (id, name, location_type, description)
SELECT 'loc_dry_goods', 'Dry Goods Store', 'Storage', 'Non-perishable food and supplies'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_locations WHERE id = 'loc_dry_goods');

INSERT INTO public.inv_locations (id, name, location_type, description)
SELECT 'loc_freezer', 'Freezer / Perishables', 'Storage', 'Frozen and chilled food items'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_locations WHERE id = 'loc_freezer');

INSERT INTO public.inv_locations (id, name, location_type, description)
SELECT 'loc_bar1', 'Bar 1', 'Outlet', 'Primary bar outlet - broken down stock'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_locations WHERE id = 'loc_bar1');

INSERT INTO public.inv_locations (id, name, location_type, description)
SELECT 'loc_restaurant', 'Restaurant', 'Outlet', 'Restaurant food and garnishes'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_locations WHERE id = 'loc_restaurant');

-- ============================================================================
-- 2. UNIT OF MEASURE DEFINITIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_uom_definitions (
  id VARCHAR(255) PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('Volume', 'Weight', 'Count', 'Length')),
  description text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inv_uom_category_idx ON public.inv_uom_definitions(category);

-- Seed standard UOMs
INSERT INTO public.inv_uom_definitions (id, code, name, category, description)
SELECT 'uom_case', 'CASE', 'Case', 'Count', 'Wholesale case packaging'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_uom_definitions WHERE code = 'CASE');

INSERT INTO public.inv_uom_definitions (id, code, name, category, description)
SELECT 'uom_bottle', 'BOTTLE', 'Bottle', 'Count', 'Standard wine/spirit bottle (750ml)'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_uom_definitions WHERE code = 'BOTTLE');

INSERT INTO public.inv_uom_definitions (id, code, name, category, description)
SELECT 'uom_ml', 'ML', 'Millilitre', 'Volume', 'Millilitres - base volume unit'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_uom_definitions WHERE code = 'ML');

INSERT INTO public.inv_uom_definitions (id, code, name, category, description)
SELECT 'uom_tot', 'TOT', 'Tot', 'Volume', '25ml standard measure (spirits)'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_uom_definitions WHERE code = 'TOT');

INSERT INTO public.inv_uom_definitions (id, code, name, category, description)
SELECT 'uom_gram', 'GRAM', 'Gram', 'Weight', 'Grammes - base weight unit'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_uom_definitions WHERE code = 'GRAM');

INSERT INTO public.inv_uom_definitions (id, code, name, category, description)
SELECT 'uom_kg', 'KG', 'Kilogram', 'Weight', 'Kilograms'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_uom_definitions WHERE code = 'KG');

INSERT INTO public.inv_uom_definitions (id, code, name, category, description)
SELECT 'uom_liter', 'LITER', 'Litre', 'Volume', 'Litres'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_uom_definitions WHERE code = 'LITER');

INSERT INTO public.inv_uom_definitions (id, code, name, category, description)
SELECT 'uom_unit', 'UNIT', 'Unit', 'Count', 'Individual items'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_uom_definitions WHERE code = 'UNIT');

INSERT INTO public.inv_uom_definitions (id, code, name, category, description)
SELECT 'uom_crate', 'CRATE', 'Crate', 'Count', 'Crate packaging (water, beer)'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_uom_definitions WHERE code = 'CRATE');

INSERT INTO public.inv_uom_definitions (id, code, name, category, description)
SELECT 'uom_drum', 'DRUM', 'Drum', 'Count', 'Drum container (oils, syrups)'
WHERE NOT EXISTS (SELECT 1 FROM public.inv_uom_definitions WHERE code = 'DRUM');

-- ============================================================================
-- 3. INVENTORY ITEMS MASTER (with base UOM and wastage factors)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_items (
  id VARCHAR(255) PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('Beverage', 'Food', 'Supply')),
  base_uom_id VARCHAR(255) NOT NULL REFERENCES public.inv_uom_definitions(id) ON DELETE RESTRICT,
  weighted_avg_cost numeric(12,2) NOT NULL DEFAULT 0.00,
  default_wastage_pct numeric(5,2) NOT NULL DEFAULT 0.00,
  reorder_level numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inv_items_category_idx ON public.inv_items(category);
CREATE INDEX IF NOT EXISTS inv_items_active_idx ON public.inv_items(is_active);

-- ============================================================================
-- 4. UOM CONVERSION RULES (per-item hierarchical conversions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_uom_conversions (
  id VARCHAR(255) PRIMARY KEY,
  item_id VARCHAR(255) NOT NULL REFERENCES public.inv_items(id) ON DELETE CASCADE,
  from_uom_id VARCHAR(255) NOT NULL REFERENCES public.inv_uom_definitions(id) ON DELETE RESTRICT,
  to_uom_id VARCHAR(255) NOT NULL REFERENCES public.inv_uom_definitions(id) ON DELETE RESTRICT,
  conversion_factor numeric(12,4) NOT NULL,
  breakdown_allowed boolean NOT NULL DEFAULT false,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS inv_uom_conversions_unique 
  ON public.inv_uom_conversions(item_id, from_uom_id, to_uom_id);
CREATE INDEX IF NOT EXISTS inv_uom_conversions_item_idx ON public.inv_uom_conversions(item_id);

-- ============================================================================
-- 5. GOODS RECEIVED NOTE (GRN) - Header
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_grn_headers (
  id VARCHAR(255) PRIMARY KEY,
  grn_number text NOT NULL UNIQUE,
  supplier_name text NOT NULL,
  grn_date date NOT NULL DEFAULT CURRENT_DATE,
  destination_location_id VARCHAR(255) NOT NULL REFERENCES public.inv_locations(id) ON DELETE RESTRICT,
  total_value numeric(14,2) NOT NULL DEFAULT 0.00,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'voided', 'reversed')),
  posted_by text,
  posted_at timestamptz,
  created_by text NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS inv_grn_number_idx ON public.inv_grn_headers(grn_number);
CREATE INDEX IF NOT EXISTS inv_grn_status_idx ON public.inv_grn_headers(status);
CREATE INDEX IF NOT EXISTS inv_grn_location_idx ON public.inv_grn_headers(destination_location_id);

-- ============================================================================
-- 6. GOODS RECEIVED NOTE (GRN) - Line Items
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_grn_lines (
  id VARCHAR(255) PRIMARY KEY,
  grn_header_id VARCHAR(255) NOT NULL REFERENCES public.inv_grn_headers(id) ON DELETE CASCADE,
  item_id VARCHAR(255) NOT NULL REFERENCES public.inv_items(id) ON DELETE RESTRICT,
  qty_received numeric(12,4) NOT NULL,
  received_uom_id VARCHAR(255) NOT NULL REFERENCES public.inv_uom_definitions(id) ON DELETE RESTRICT,
  unit_cost numeric(12,2) NOT NULL,
  line_total numeric(14,2) NOT NULL,
  expiry_date date,
  line_number integer NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inv_grn_lines_header_idx ON public.inv_grn_lines(grn_header_id);
CREATE INDEX IF NOT EXISTS inv_grn_lines_item_idx ON public.inv_grn_lines(item_id);

-- ============================================================================
-- 7. STOCK TRANSFER - Header
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_transfer_headers (
  id VARCHAR(255) PRIMARY KEY,
  transfer_number text NOT NULL UNIQUE,
  source_location_id VARCHAR(255) NOT NULL REFERENCES public.inv_locations(id) ON DELETE RESTRICT,
  destination_location_id VARCHAR(255) NOT NULL REFERENCES public.inv_locations(id) ON DELETE RESTRICT,
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  reference_text text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'voided')),
  approved_by text,
  approved_at timestamptz,
  created_by text NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS inv_transfer_number_idx ON public.inv_transfer_headers(transfer_number);
CREATE INDEX IF NOT EXISTS inv_transfer_source_idx ON public.inv_transfer_headers(source_location_id);
CREATE INDEX IF NOT EXISTS inv_transfer_dest_idx ON public.inv_transfer_headers(destination_location_id);
CREATE INDEX IF NOT EXISTS inv_transfer_status_idx ON public.inv_transfer_headers(status);

-- ============================================================================
-- 8. STOCK TRANSFER - Line Items
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_transfer_lines (
  id VARCHAR(255) PRIMARY KEY,
  transfer_header_id VARCHAR(255) NOT NULL REFERENCES public.inv_transfer_headers(id) ON DELETE CASCADE,
  item_id VARCHAR(255) NOT NULL REFERENCES public.inv_items(id) ON DELETE RESTRICT,
  qty_requested numeric(12,4) NOT NULL,
  source_uom_id VARCHAR(255) NOT NULL REFERENCES public.inv_uom_definitions(id) ON DELETE RESTRICT,
  breakdown_flag boolean NOT NULL DEFAULT false,
  destination_uom_id VARCHAR(255) REFERENCES public.inv_uom_definitions(id) ON DELETE RESTRICT,
  current_source_balance numeric(12,4) NOT NULL,
  line_number integer NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inv_transfer_lines_header_idx ON public.inv_transfer_lines(transfer_header_id);
CREATE INDEX IF NOT EXISTS inv_transfer_lines_item_idx ON public.inv_transfer_lines(item_id);

-- ============================================================================
-- 9. STOCK LEDGER (single source of truth for all movements)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_stock_ledger (
  id VARCHAR(255) PRIMARY KEY,
  item_id VARCHAR(255) NOT NULL REFERENCES public.inv_items(id) ON DELETE RESTRICT,
  location_id VARCHAR(255) NOT NULL REFERENCES public.inv_locations(id) ON DELETE RESTRICT,
  ledger_type text NOT NULL CHECK (ledger_type IN ('GRN', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE_DEPLETION', 'PHYSICAL_COUNT', 'ADJUSTMENT', 'WASTAGE')),
  reference_number text,
  quantity_change numeric(12,4) NOT NULL,
  base_uom_id VARCHAR(255) NOT NULL REFERENCES public.inv_uom_definitions(id) ON DELETE RESTRICT,
  cost_per_unit numeric(12,2) NOT NULL DEFAULT 0.00,
  total_cost numeric(14,2) NOT NULL DEFAULT 0.00,
  gl_account_code text,
  posted_by text,
  posted_at timestamptz NOT NULL DEFAULT NOW(),
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inv_stock_ledger_item_idx ON public.inv_stock_ledger(item_id);
CREATE INDEX IF NOT EXISTS inv_stock_ledger_location_idx ON public.inv_stock_ledger(location_id);
CREATE INDEX IF NOT EXISTS inv_stock_ledger_type_idx ON public.inv_stock_ledger(ledger_type);
CREATE INDEX IF NOT EXISTS inv_stock_ledger_date_idx ON public.inv_stock_ledger(posted_at);

-- ============================================================================
-- 10. RECIPE / BILL OF MATERIALS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_recipes (
  id VARCHAR(255) PRIMARY KEY,
  menu_item_id VARCHAR(255) NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  effective_from date NOT NULL DEFAULT CURRENT_DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS inv_recipes_current 
  ON public.inv_recipes(menu_item_id) 
  WHERE is_current = true;
CREATE INDEX IF NOT EXISTS inv_recipes_menu_item_idx ON public.inv_recipes(menu_item_id);

-- ============================================================================
-- 11. RECIPE LINE ITEMS (Ingredients with wastage)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_recipe_lines (
  id VARCHAR(255) PRIMARY KEY,
  recipe_id VARCHAR(255) NOT NULL REFERENCES public.inv_recipes(id) ON DELETE CASCADE,
  item_id VARCHAR(255) NOT NULL REFERENCES public.inv_items(id) ON DELETE RESTRICT,
  qty_required numeric(12,4) NOT NULL,
  prep_uom_id VARCHAR(255) NOT NULL REFERENCES public.inv_uom_definitions(id) ON DELETE RESTRICT,
  wastage_pct numeric(5,2) NOT NULL DEFAULT 0.00,
  line_number integer NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inv_recipe_lines_recipe_idx ON public.inv_recipe_lines(recipe_id);
CREATE INDEX IF NOT EXISTS inv_recipe_lines_item_idx ON public.inv_recipe_lines(item_id);

-- ============================================================================
-- 12. VARIANCE REPORTS (Header)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_variance_reports (
  id VARCHAR(255) PRIMARY KEY,
  report_number text NOT NULL UNIQUE,
  location_id VARCHAR(255) NOT NULL REFERENCES public.inv_locations(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  variance_count integer NOT NULL DEFAULT 0,
  ok_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  critical_count integer NOT NULL DEFAULT 0,
  total_variance_value numeric(14,2) NOT NULL DEFAULT 0.00,
  generated_by text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT NOW(),
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inv_variance_location_idx ON public.inv_variance_reports(location_id);
CREATE INDEX IF NOT EXISTS inv_variance_period_idx ON public.inv_variance_reports(period_start, period_end);

-- ============================================================================
-- 13. VARIANCE REPORT LINE ITEMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inv_variance_lines (
  id VARCHAR(255) PRIMARY KEY,
  variance_report_id VARCHAR(255) NOT NULL REFERENCES public.inv_variance_reports(id) ON DELETE CASCADE,
  item_id VARCHAR(255) NOT NULL REFERENCES public.inv_items(id) ON DELETE RESTRICT,
  pos_theoretical_qty numeric(12,4) NOT NULL DEFAULT 0.00,
  physical_count_qty numeric(12,4) NOT NULL DEFAULT 0.00,
  variance_qty numeric(12,4) NOT NULL,
  variance_pct numeric(7,2) NOT NULL,
  variance_value numeric(14,2) NOT NULL,
  alert_level text NOT NULL DEFAULT 'OK' CHECK (alert_level IN ('OK', 'WARNING', 'CRITICAL')),
  base_uom_id VARCHAR(255) NOT NULL REFERENCES public.inv_uom_definitions(id) ON DELETE RESTRICT,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inv_variance_lines_report_idx ON public.inv_variance_lines(variance_report_id);
CREATE INDEX IF NOT EXISTS inv_variance_lines_item_idx ON public.inv_variance_lines(item_id);
CREATE INDEX IF NOT EXISTS inv_variance_lines_alert_idx ON public.inv_variance_lines(alert_level);

-- ============================================================================
-- SCHEMA VERIFICATION VIEW
-- ============================================================================

CREATE OR REPLACE VIEW public.inv_module_status AS
SELECT 'inv_locations' AS table_name, (SELECT COUNT(*) FROM public.inv_locations) AS row_count
UNION ALL
SELECT 'inv_uom_definitions', (SELECT COUNT(*) FROM public.inv_uom_definitions)
UNION ALL
SELECT 'inv_items', (SELECT COUNT(*) FROM public.inv_items)
UNION ALL
SELECT 'inv_grn_headers', (SELECT COUNT(*) FROM public.inv_grn_headers)
UNION ALL
SELECT 'inv_transfer_headers', (SELECT COUNT(*) FROM public.inv_transfer_headers)
UNION ALL
SELECT 'inv_stock_ledger', (SELECT COUNT(*) FROM public.inv_stock_ledger)
UNION ALL
SELECT 'inv_recipes', (SELECT COUNT(*) FROM public.inv_recipes)
UNION ALL
SELECT 'inv_variance_reports', (SELECT COUNT(*) FROM public.inv_variance_reports);

-- Migration V7 complete
