-- ============================================================================
-- V10: Add Inventory Reconciliation Module Tables
-- ============================================================================
-- This migration adds tables for period-by-period stock reconciliation:
-- 1. inventory_periods - Monthly period entities with status tracking
-- 2. inventory_transactions - Backdated purchase and GRV transactions
-- 3. inventory_reconciliations - Reconciliation records with audit trail
-- 4. inventory_period_audit - Audit trail for all period changes
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. INVENTORY PERIODS TABLE
-- Monthly reconciliation periods with status management
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Period identification
    period_year integer NOT NULL,
    period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_name text NOT NULL,
    
    -- Period dates
    start_date date NOT NULL,
    end_date date NOT NULL,
    
    -- Status: future (not started), open (active/reconciling), closed (locked)
    status text NOT NULL DEFAULT 'future' CHECK (status IN ('future', 'open', 'reconciling', 'closed', 'locked')),
    
    -- Stock values (rolling forward)
    opening_stock_value numeric(14,2) NOT NULL DEFAULT 0,
    closing_stock_value numeric(14,2),
    received_value numeric(14,2) NOT NULL DEFAULT 0,
    variance_value numeric(14,2),
    cogs_value numeric(14,2),
    
    -- Department breakdown for COGS
    kitchen_cogs numeric(14,2) NOT NULL DEFAULT 0,
    cellar_cogs numeric(14,2) NOT NULL DEFAULT 0,
    
    -- Closing process
    closed_at timestamptz,
    closed_by text,
    closed_reason text,
    
    -- Reopening
    reopened_at timestamptz,
    reopened_by text,
    reopen_reason text,
    
    -- Lock status (immutable once closed)
    is_locked boolean NOT NULL DEFAULT false,
    locked_at timestamptz,
    locked_by text,
    
    -- Notes
    notes text,
    
    -- Audit
    created_by text,
    inserted_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    
    UNIQUE (period_year, period_month)
);

CREATE INDEX IF NOT EXISTS inventory_periods_year_month_idx ON public.inventory_periods(period_year, period_month);
CREATE INDEX IF NOT EXISTS inventory_periods_status_idx ON public.inventory_periods(status);

-- ----------------------------------------------------------------------------
-- 2. INVENTORY TRANSACTIONS TABLE
-- Backdated inventory transactions associated with periods
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    
    transaction_type text NOT NULL CHECK (transaction_type IN ('purchase', 'grv', 'adjustment', 'transfer', 'variance_writeoff')),
    transaction_number text NOT NULL,
    
    -- Period association (for backdating)
    period_id uuid REFERENCES public.inventory_periods(id) ON DELETE RESTRICT,
    
    -- Transaction dates
    transaction_date date NOT NULL,
    entry_date date NOT NULL DEFAULT CURRENT_DATE,
    
    -- Supplier
    supplier_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
    supplier_name text,
    
    -- Department/Cost Centre (for expense tracking)
    department text NOT NULL CHECK (department IN ('Kitchen', 'Cellar', 'Bar', 'Restaurant', 'Room Service', 'Maintenance', 'Administration')),
    cost_center text,
    
    -- Items
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    
    -- Totals
    total_quantity numeric(14,3) NOT NULL DEFAULT 0,
    total_value numeric(14,2) NOT NULL DEFAULT 0,
    
    -- Reference documents
    reference_number text,
    grv_number text,
    
    -- Status
    is_deleted boolean NOT NULL DEFAULT false,
    deleted_at timestamptz,
    deleted_by text,
    delete_reason text,
    
    -- Audit
    created_by text,
    inserted_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_transactions_period_idx ON public.inventory_transactions(period_id);
CREATE INDEX IF NOT EXISTS inventory_transactions_type_idx ON public.inventory_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS inventory_transactions_date_idx ON public.inventory_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS inventory_transactions_department_idx ON public.inventory_transactions(department);

-- ----------------------------------------------------------------------------
-- 3. INVENTORY RECONCILIATIONS TABLE
-- Reconciliation records with full audit trail
-- ----------------------------------------------------------------------------
-- PHASE-4 ARCHITECTURE NOTE: This table (inventory_reconciliations) is defined
-- but currently unused — all reconciliation data is stored in inventory_snapshots
-- and aggregated from inventory_periods. This table is kept for potential future
-- use (detailed department-level reconciliation worksheets). Do NOT drop it;
-- it is part of the audit schema. No code reads or writes to it currently.
-- STR-01 from the audit report: "Ghost table — defined, never used."
CREATE TABLE IF NOT EXISTS public.inventory_reconciliations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    
    period_id uuid NOT NULL REFERENCES public.inventory_periods(id) ON DELETE RESTRICT,
    reconciliation_number text NOT NULL,
    reconciliation_date date NOT NULL,
    
    -- Kitchen department
    kitchen_opening_qty numeric(14,3) NOT NULL DEFAULT 0,
    kitchen_received_qty numeric(14,3) NOT NULL DEFAULT 0,
    kitchen_physical_qty numeric(14,3),
    kitchen_variance_qty numeric(14,3),
    kitchen_variance_value numeric(14,2),
    kitchen_cogs numeric(14,2),
    
    -- Cellar department
    cellar_opening_qty numeric(14,3) NOT NULL DEFAULT 0,
    cellar_received_qty numeric(14,3) NOT NULL DEFAULT 0,
    cellar_physical_qty numeric(14,3),
    cellar_variance_qty numeric(14,3),
    cellar_variance_value numeric(14,2),
    cellar_cogs numeric(14,2),
    
    -- Totals
    total_opening_value numeric(14,2) NOT NULL DEFAULT 0,
    total_received_value numeric(14,2) NOT NULL DEFAULT 0,
    total_physical_value numeric(14,2),
    total_variance_value numeric(14,2),
    total_cogs numeric(14,2),
    
    variance_reason text,
    
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'confirmed', 'reversed')),
    
    confirmed_at timestamptz,
    confirmed_by text,
    confirmation_notes text,
    
    reversed_at timestamptz,
    reversed_by text,
    reverse_reason text,
    
    -- Audit trail for modifications
    modification_history jsonb DEFAULT '[]'::jsonb,
    
    notes text,
    created_by text,
    inserted_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_reconciliations_period_idx ON public.inventory_reconciliations(period_id);
CREATE INDEX IF NOT EXISTS inventory_reconciliations_status_idx ON public.inventory_reconciliations(status);

-- ----------------------------------------------------------------------------
-- 4. INVENTORY PERIOD AUDIT TABLE
-- Comprehensive audit trail for all period changes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_period_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    
    period_id uuid NOT NULL REFERENCES public.inventory_periods(id) ON DELETE RESTRICT,
    
    action text NOT NULL CHECK (action IN (
        'PERIOD_CREATED', 'PERIOD_OPENED', 'PERIOD_STATUS_CHANGED',
        'TRANSACTION_ADDED', 'TRANSACTION_MODIFIED', 'TRANSACTION_DELETED',
        'RECONCILIATION_STARTED', 'RECONCILIATION_UPDATED', 'RECONCILIATION_CONFIRMED',
        'RECONCILIATION_REVERSED', 'PERIOD_CLOSED', 'PERIOD_LOCKED',
        'PERIOD_REOPENED', 'STOCK_ROLLED_FORWARD', 'BACKDATE_ADJUSTMENT'
    )),
    
    user_id text NOT NULL,
    user_name text,
    user_role text,
    
    timestamp timestamptz NOT NULL DEFAULT NOW(),
    
    previous_value jsonb,
    new_value jsonb,
    change_reason text,
    
    -- "Historical Audit Backfill" flag
    is_historical_backfill boolean NOT NULL DEFAULT false,
    backfill_reason text,
    
    ip_address text,
    session_id text
);

CREATE INDEX IF NOT EXISTS inventory_period_audit_period_idx ON public.inventory_period_audit(period_id);
CREATE INDEX IF NOT EXISTS inventory_period_audit_action_idx ON public.inventory_period_audit(action);
CREATE INDEX IF NOT EXISTS inventory_period_audit_user_idx ON public.inventory_period_audit(user_id);
CREATE INDEX IF NOT EXISTS inventory_period_audit_timestamp_idx ON public.inventory_period_audit(timestamp DESC);
CREATE INDEX IF NOT EXISTS inventory_period_audit_backfill_idx ON public.inventory_period_audit(is_historical_backfill);

-- ----------------------------------------------------------------------------
-- 5. PRODUCTS TABLE UPDATE - Add department tracking
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.products 
    ADD COLUMN IF NOT EXISTS department text CHECK (department IN ('Kitchen', 'Cellar', 'Bar', 'Restaurant', 'Room Service')),
    ADD COLUMN IF NOT EXISTS last_inventory_period_id uuid REFERENCES public.inventory_periods(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS last_physical_qty numeric(14,3),
    ADD COLUMN IF NOT EXISTS last_physical_date date;

-- ----------------------------------------------------------------------------
-- 6. VIEWS FOR COST OF GOODS BY DEPARTMENT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_cost_of_goods_by_department AS
SELECT 
    ip.period_year,
    ip.period_month,
    ip.period_name,
    'Kitchen' as department,
    ip.kitchen_cogs as cogs_amount
FROM public.inventory_periods ip
WHERE ip.status IN ('closed', 'locked')

UNION ALL

SELECT 
    ip.period_year,
    ip.period_month,
    ip.period_name,
    'Cellar' as department,
    ip.cellar_cogs as cogs_amount
FROM public.inventory_periods ip
WHERE ip.status IN ('closed', 'locked')

ORDER BY period_year DESC, period_month DESC, department;

-- ----------------------------------------------------------------------------
-- 7. INVENTORY TRANSACTIONS BY DEPARTMENT VIEW
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_inventory_transactions_by_department AS
SELECT 
    it.transaction_date,
    it.transaction_type,
    it.transaction_number,
    it.supplier_name,
    it.department,
    it.cost_center,
    it.total_quantity,
    it.total_value,
    ip.period_name,
    it.created_by,
    it.inserted_at
FROM public.inventory_transactions it
LEFT JOIN public.inventory_periods ip ON it.period_id = ip.id
WHERE it.is_deleted = false
ORDER BY it.transaction_date DESC;

-- ----------------------------------------------------------------------------
-- 8. PERIOD RECONCILIATION SUMMARY VIEW
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_inventory_period_summary AS
SELECT 
    id, period_name, period_year, period_month, start_date, end_date,
    status, opening_stock_value, received_value, closing_stock_value,
    variance_value, cogs_value, kitchen_cogs, cellar_cogs,
    closed_at, closed_by, is_locked, created_by, inserted_at
FROM public.inventory_periods
ORDER BY period_year DESC, period_month DESC;

-- ----------------------------------------------------------------------------
-- 9. TRIGGERS FOR updated_at
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_inventory_periods_updated_at') THEN
        CREATE TRIGGER update_inventory_periods_updated_at BEFORE UPDATE ON public.inventory_periods
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_inventory_transactions_updated_at') THEN
        CREATE TRIGGER update_inventory_transactions_updated_at BEFORE UPDATE ON public.inventory_transactions
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_inventory_reconciliations_updated_at') THEN
        CREATE TRIGGER update_inventory_reconciliations_updated_at BEFORE UPDATE ON public.inventory_reconciliations
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ============================================================================
-- END OF MIGRATION V10
-- ============================================================================
