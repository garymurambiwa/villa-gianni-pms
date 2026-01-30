-- ============================================================================
-- V6: Add Accounting Module Tables
-- ============================================================================
-- This migration creates tables for complete accounting functionality:
-- 1. gl_accounts - Chart of Accounts
-- 2. gl_code_mappings - PMS code to GL account mappings
-- 3. gl_journal_entries - General Ledger journal entries (header)
-- 4. gl_journal_lines - Journal entry line items (debits/credits)
-- 5. expenses - Expense records
-- 6. vendors - Vendor/Payee records for expenses
-- 7. budgets - Budget records for departmental tracking
-- 8. expense_attachments - File attachments for expenses
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. GL ACCOUNTS TABLE (Chart of Accounts)
-- USALI-compliant chart of accounts for hotel accounting
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gl_accounts (
  id text PRIMARY KEY, -- Account code e.g., '4000', '5200-01'
  
  -- Account details
  name text NOT NULL,
  description text,
  
  -- Classification
  category text NOT NULL CHECK (category IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  account_type text, -- Sub-classification e.g., 'Current Asset', 'Operating Expense'
  
  -- USALI alignment
  usali_code text, -- USALI standard account code
  usali_name text, -- USALI standard account name
  
  -- Department (for departmental P&L)
  department text, -- e.g., 'Rooms', 'F&B', 'Administration', 'Sales & Marketing'
  
  -- Hierarchy
  parent_account_id text REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  level integer NOT NULL DEFAULT 1, -- Account hierarchy level
  
  -- Normal balance
  normal_balance text NOT NULL DEFAULT 'debit' CHECK (normal_balance IN ('debit', 'credit')),
  
  -- Status
  is_active boolean NOT NULL DEFAULT true,
  is_header boolean NOT NULL DEFAULT false, -- Header accounts for grouping
  is_system boolean NOT NULL DEFAULT false, -- System-generated, cannot delete
  
  -- Balance tracking (denormalized for performance)
  current_balance numeric(14,2) NOT NULL DEFAULT 0,
  ytd_balance numeric(14,2) NOT NULL DEFAULT 0,
  
  -- Audit
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gl_accounts_category_idx ON public.gl_accounts(category);
CREATE INDEX IF NOT EXISTS gl_accounts_department_idx ON public.gl_accounts(department);
CREATE INDEX IF NOT EXISTS gl_accounts_parent_idx ON public.gl_accounts(parent_account_id);
CREATE INDEX IF NOT EXISTS gl_accounts_active_idx ON public.gl_accounts(is_active);

-- ----------------------------------------------------------------------------
-- 2. GL CODE MAPPINGS TABLE
-- Maps PMS charge codes to GL accounts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gl_code_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- PMS code
  pms_code text NOT NULL UNIQUE, -- e.g., 'ROOM_REVENUE', 'FB_REVENUE', 'TAX'
  pms_code_description text,
  
  -- GL account mapping
  gl_account_id text NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  
  -- Mapping context
  mapping_type text NOT NULL DEFAULT 'revenue' CHECK (mapping_type IN ('revenue', 'expense', 'asset', 'liability', 'equity')),
  cost_center text, -- Optional cost center
  department text, -- Optional department override
  
  -- Status
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false, -- System-required mappings
  
  -- Audit
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gl_code_mappings_pms_code_idx ON public.gl_code_mappings(pms_code);
CREATE INDEX IF NOT EXISTS gl_code_mappings_gl_account_idx ON public.gl_code_mappings(gl_account_id);
CREATE INDEX IF NOT EXISTS gl_code_mappings_active_idx ON public.gl_code_mappings(is_active);

-- ----------------------------------------------------------------------------
-- 3. GL JOURNAL ENTRIES TABLE (Header)
-- General Ledger journal entry records
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gl_journal_entries (
  id text PRIMARY KEY, -- e.g., 'GLJE_2026-01-02', 'JE_RECON_2026-01-02_123456'
  
  -- Entry details
  entry_date date NOT NULL,
  business_date date NOT NULL,
  description text,
  reference text, -- e.g., 'NightAudit 2026-01-02', 'Expense INV-001'
  
  -- Source tracking
  source text NOT NULL DEFAULT 'manual' CHECK (source IN (
    'manual', 'night_audit', 'expense', 'pos', 'folio', 
    'reconciliation', 'adjustment', 'closing', 'opening', 'system'
  )),
  source_reference text, -- Reference to source document
  source_id text, -- ID of source record
  
  -- Entry type
  entry_type text NOT NULL DEFAULT 'standard' CHECK (entry_type IN (
    'standard', 'adjusting', 'closing', 'opening', 'reversing', 'recurring'
  )),
  
  -- Status
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'pending', 'posted', 'voided', 'reversed')),
  
  -- Totals (for quick validation)
  total_debit numeric(14,2) NOT NULL DEFAULT 0,
  total_credit numeric(14,2) NOT NULL DEFAULT 0,
  is_balanced boolean NOT NULL DEFAULT true,
  
  -- Void tracking
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  
  -- Reversal tracking
  reversed_by_entry_id text REFERENCES public.gl_journal_entries(id) ON DELETE SET NULL,
  reverses_entry_id text REFERENCES public.gl_journal_entries(id) ON DELETE SET NULL,
  
  -- Attachments (stored as JSONB for flexibility)
  attachments jsonb DEFAULT '{}'::jsonb,
  
  -- Audit
  created_by text,
  posted_by text,
  posted_at timestamptz,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gl_journal_entries_entry_date_idx ON public.gl_journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS gl_journal_entries_business_date_idx ON public.gl_journal_entries(business_date);
CREATE INDEX IF NOT EXISTS gl_journal_entries_source_idx ON public.gl_journal_entries(source);
CREATE INDEX IF NOT EXISTS gl_journal_entries_status_idx ON public.gl_journal_entries(status);
CREATE INDEX IF NOT EXISTS gl_journal_entries_posted_at_idx ON public.gl_journal_entries(posted_at DESC);

-- ----------------------------------------------------------------------------
-- 4. GL JOURNAL LINES TABLE
-- Individual debit/credit lines for journal entries
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gl_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Parent entry
  journal_entry_id text NOT NULL REFERENCES public.gl_journal_entries(id) ON DELETE CASCADE,
  line_number integer NOT NULL DEFAULT 1,
  
  -- Account
  gl_account_id text NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  
  -- Amounts (only one should be non-zero)
  debit_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  
  -- Description
  description text,
  memo text,
  
  -- Department/Cost Center (for departmental reporting)
  department text,
  cost_center text,
  
  -- Reference
  reference text,
  
  -- Audit
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  
  -- Constraint: only debit or credit, not both
  CONSTRAINT check_debit_or_credit CHECK (
    (debit_amount > 0 AND credit_amount = 0) OR 
    (debit_amount = 0 AND credit_amount > 0) OR
    (debit_amount = 0 AND credit_amount = 0)
  )
);

CREATE INDEX IF NOT EXISTS gl_journal_lines_entry_idx ON public.gl_journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS gl_journal_lines_account_idx ON public.gl_journal_lines(gl_account_id);
CREATE INDEX IF NOT EXISTS gl_journal_lines_department_idx ON public.gl_journal_lines(department);

-- ----------------------------------------------------------------------------
-- 5. VENDORS TABLE
-- Vendor/Payee records for expense management
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Vendor details
  name text NOT NULL,
  code text UNIQUE, -- Short code for quick reference
  
  -- Classification
  vendor_type text NOT NULL DEFAULT 'Supplier' CHECK (vendor_type IN (
    'Supplier', 'Contractor', 'Service Provider', 'Utility', 'Government', 'Other'
  )),
  category text, -- e.g., 'Food & Beverage', 'Maintenance', 'Utilities'
  
  -- Contact info
  contact_name text,
  phone text,
  email text,
  website text,
  
  -- Address
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text DEFAULT 'Philippines',
  
  -- Tax/Legal
  tax_id text, -- TIN
  business_registration text,
  
  -- Payment terms
  payment_terms text DEFAULT 'Net 30',
  default_gl_account_id text REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  default_cost_center text,
  
  -- Banking
  bank_name text,
  bank_account_number text,
  bank_routing_number text,
  
  -- Status
  is_active boolean NOT NULL DEFAULT true,
  
  -- Notes
  notes text,
  
  -- Audit
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vendors_name_idx ON public.vendors(name);
CREATE INDEX IF NOT EXISTS vendors_code_idx ON public.vendors(code);
CREATE INDEX IF NOT EXISTS vendors_vendor_type_idx ON public.vendors(vendor_type);
CREATE INDEX IF NOT EXISTS vendors_active_idx ON public.vendors(is_active);

-- ----------------------------------------------------------------------------
-- 6. EXPENSES TABLE
-- Expense records for payables and expense tracking
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Expense identification
  expense_number text NOT NULL UNIQUE, -- Auto-generated EXP-YYYYMMDD-XXX
  
  -- Vendor
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  vendor_name text, -- Denormalized for display
  
  -- Invoice/Document details
  invoice_number text,
  invoice_date date,
  due_date date,
  
  -- Dates
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  
  -- Classification
  expense_type text NOT NULL DEFAULT 'Operating' CHECK (expense_type IN (
    'Operating', 'Capital', 'Payroll', 'Tax', 'Interest', 'Other'
  )),
  category text NOT NULL DEFAULT 'General',
  
  -- GL Account
  gl_account_id text REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  cost_center text,
  department text,
  
  -- Amounts
  amount numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'PHP',
  exchange_rate numeric(10,6) DEFAULT 1.0,
  amount_local numeric(14,2), -- Amount in local currency
  
  -- Payment
  payment_method text CHECK (payment_method IN ('Cash', 'Check', 'BankTransfer', 'CreditCard', 'Petty Cash', 'Other')),
  payment_reference text,
  paid_date date,
  paid_amount numeric(14,2) DEFAULT 0,
  
  -- Status
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_approval', 'approved', 'rejected', 'posted', 'paid', 'voided'
  )),
  
  -- Approval workflow
  requires_approval boolean NOT NULL DEFAULT false,
  approval_threshold numeric(14,2), -- Amount above which approval is needed
  approved_by text,
  approved_at timestamptz,
  approval_notes text,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  
  -- GL Journal Entry link
  journal_entry_id text REFERENCES public.gl_journal_entries(id) ON DELETE SET NULL,
  
  -- Description
  description text,
  notes text,
  
  -- Void tracking
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  
  -- Recurring expense
  is_recurring boolean NOT NULL DEFAULT false,
  recurring_frequency text CHECK (recurring_frequency IN ('weekly', 'monthly', 'quarterly', 'annually')),
  recurring_end_date date,
  parent_expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  
  -- Audit
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expenses_expense_number_idx ON public.expenses(expense_number);
CREATE INDEX IF NOT EXISTS expenses_vendor_id_idx ON public.expenses(vendor_id);
CREATE INDEX IF NOT EXISTS expenses_expense_date_idx ON public.expenses(expense_date);
CREATE INDEX IF NOT EXISTS expenses_business_date_idx ON public.expenses(business_date);
CREATE INDEX IF NOT EXISTS expenses_status_idx ON public.expenses(status);
CREATE INDEX IF NOT EXISTS expenses_gl_account_idx ON public.expenses(gl_account_id);
CREATE INDEX IF NOT EXISTS expenses_department_idx ON public.expenses(department);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON public.expenses(category);

-- ----------------------------------------------------------------------------
-- 7. EXPENSE ATTACHMENTS TABLE
-- File attachments for expense documentation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expense_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Parent expense
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  
  -- File details
  file_name text NOT NULL,
  file_type text, -- MIME type
  file_size integer, -- Size in bytes
  
  -- Storage
  storage_type text NOT NULL DEFAULT 'base64' CHECK (storage_type IN ('base64', 'url', 'file_path')),
  file_data text, -- Base64 encoded data or URL/path
  
  -- Description
  description text,
  
  -- Audit
  uploaded_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expense_attachments_expense_id_idx ON public.expense_attachments(expense_id);

-- ----------------------------------------------------------------------------
-- 8. BUDGETS TABLE
-- Departmental and account-level budgets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Budget period
  budget_year integer NOT NULL,
  budget_month integer, -- NULL for annual budgets, 1-12 for monthly
  period_type text NOT NULL DEFAULT 'monthly' CHECK (period_type IN ('monthly', 'quarterly', 'annual')),
  
  -- Budget scope
  gl_account_id text REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  department text,
  cost_center text,
  
  -- Amounts
  budgeted_amount numeric(14,2) NOT NULL DEFAULT 0,
  revised_amount numeric(14,2), -- Revised budget if changed
  
  -- Actuals (denormalized for reporting performance)
  actual_amount numeric(14,2) NOT NULL DEFAULT 0,
  variance_amount numeric(14,2) GENERATED ALWAYS AS (budgeted_amount - actual_amount) STORED,
  variance_percent numeric(8,4) GENERATED ALWAYS AS (
    CASE WHEN budgeted_amount != 0 THEN ((budgeted_amount - actual_amount) / budgeted_amount * 100) ELSE 0 END
  ) STORED,
  
  -- Status
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'locked', 'closed')),
  
  -- Notes
  notes text,
  
  -- Audit
  created_by text,
  approved_by text,
  approved_at timestamptz,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  
  -- Unique constraint for budget periods
  UNIQUE (budget_year, budget_month, gl_account_id, department, cost_center)
);

CREATE INDEX IF NOT EXISTS budgets_year_month_idx ON public.budgets(budget_year, budget_month);
CREATE INDEX IF NOT EXISTS budgets_department_idx ON public.budgets(department);
CREATE INDEX IF NOT EXISTS budgets_gl_account_idx ON public.budgets(gl_account_id);
CREATE INDEX IF NOT EXISTS budgets_status_idx ON public.budgets(status);

-- ----------------------------------------------------------------------------
-- 9. POS SHIFTS TABLE
-- Track POS shift data for reconciliation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_shifts (
  id text PRIMARY KEY, -- Shift ID
  
  -- Shift details
  outlet text NOT NULL DEFAULT 'Restaurant',
  shift_number integer NOT NULL DEFAULT 1,
  
  -- Date/Time
  business_date date NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT NOW(),
  closed_at timestamptz,
  
  -- Staff
  opened_by text NOT NULL,
  closed_by text,
  
  -- Cash drawer
  opening_cash numeric(12,2) NOT NULL DEFAULT 0,
  closing_cash numeric(12,2),
  expected_cash numeric(12,2),
  cash_variance numeric(12,2),
  
  -- Totals
  total_sales numeric(12,2) NOT NULL DEFAULT 0,
  total_cash numeric(12,2) NOT NULL DEFAULT 0,
  total_card numeric(12,2) NOT NULL DEFAULT 0,
  total_room_charge numeric(12,2) NOT NULL DEFAULT 0,
  total_city_ledger numeric(12,2) NOT NULL DEFAULT 0,
  total_voids numeric(12,2) NOT NULL DEFAULT 0,
  total_discounts numeric(12,2) NOT NULL DEFAULT 0,
  total_refunds numeric(12,2) NOT NULL DEFAULT 0,
  
  -- Transaction counts
  transaction_count integer NOT NULL DEFAULT 0,
  void_count integer NOT NULL DEFAULT 0,
  refund_count integer NOT NULL DEFAULT 0,
  
  -- Status
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed', 'reconciled')),
  
  -- Reconciliation
  is_reconciled boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz,
  reconciled_by text,
  reconciliation_notes text,
  
  -- Z-Reading reference
  z_reading_number text,
  
  -- Audit
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pos_shifts_business_date_idx ON public.pos_shifts(business_date);
CREATE INDEX IF NOT EXISTS pos_shifts_outlet_idx ON public.pos_shifts(outlet);
CREATE INDEX IF NOT EXISTS pos_shifts_status_idx ON public.pos_shifts(status);
CREATE INDEX IF NOT EXISTS pos_shifts_opened_by_idx ON public.pos_shifts(opened_by);

-- ----------------------------------------------------------------------------
-- 10. ACCOUNTING PERIODS TABLE
-- Track open/closed accounting periods
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Period identification
  period_year integer NOT NULL,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_name text, -- e.g., 'January 2026'
  
  -- Dates
  start_date date NOT NULL,
  end_date date NOT NULL,
  
  -- Status
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('future', 'open', 'closing', 'closed', 'locked')),
  
  -- Closing process
  closed_at timestamptz,
  closed_by text,
  closing_entry_id text REFERENCES public.gl_journal_entries(id) ON DELETE SET NULL,
  
  -- Reopening (for adjustments)
  reopened_at timestamptz,
  reopened_by text,
  reopen_reason text,
  
  -- Audit
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  
  UNIQUE (period_year, period_month)
);

CREATE INDEX IF NOT EXISTS accounting_periods_status_idx ON public.accounting_periods(status);
CREATE INDEX IF NOT EXISTS accounting_periods_year_month_idx ON public.accounting_periods(period_year, period_month);

-- ----------------------------------------------------------------------------
-- 11. UPDATE TRIGGERS FOR updated_at COLUMNS
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- gl_accounts
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_gl_accounts_updated_at') THEN
    CREATE TRIGGER update_gl_accounts_updated_at BEFORE UPDATE ON public.gl_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- gl_code_mappings
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_gl_code_mappings_updated_at') THEN
    CREATE TRIGGER update_gl_code_mappings_updated_at BEFORE UPDATE ON public.gl_code_mappings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- gl_journal_entries
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_gl_journal_entries_updated_at') THEN
    CREATE TRIGGER update_gl_journal_entries_updated_at BEFORE UPDATE ON public.gl_journal_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- vendors
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_vendors_updated_at') THEN
    CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON public.vendors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- expenses
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_expenses_updated_at') THEN
    CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- budgets
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_budgets_updated_at') THEN
    CREATE TRIGGER update_budgets_updated_at BEFORE UPDATE ON public.budgets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- pos_shifts
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_pos_shifts_updated_at') THEN
    CREATE TRIGGER update_pos_shifts_updated_at BEFORE UPDATE ON public.pos_shifts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- accounting_periods
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_accounting_periods_updated_at') THEN
    CREATE TRIGGER update_accounting_periods_updated_at BEFORE UPDATE ON public.accounting_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 12. SEED DEFAULT GL ACCOUNTS (USALI-aligned)
-- ----------------------------------------------------------------------------
INSERT INTO public.gl_accounts (id, name, category, normal_balance, department, is_system) VALUES
  -- Assets
  ('1000', 'Cash', 'Asset', 'debit', NULL, true),
  ('1010', 'Petty Cash', 'Asset', 'debit', NULL, true),
  ('1100', 'Accounts Receivable', 'Asset', 'debit', NULL, true),
  ('1110', 'Guest Ledger', 'Asset', 'debit', NULL, true),
  ('1120', 'City Ledger', 'Asset', 'debit', NULL, true),
  ('1200', 'Inventory', 'Asset', 'debit', NULL, true),
  ('1300', 'Prepaid Expenses', 'Asset', 'debit', NULL, true),
  ('1500', 'Fixed Assets', 'Asset', 'debit', NULL, true),
  ('1510', 'Accumulated Depreciation', 'Asset', 'credit', NULL, true),
  
  -- Liabilities
  ('2000', 'Accounts Payable', 'Liability', 'credit', NULL, true),
  ('2100', 'Accrued Expenses', 'Liability', 'credit', NULL, true),
  ('2200', 'Taxes Payable', 'Liability', 'credit', NULL, true),
  ('2210', 'VAT Payable', 'Liability', 'credit', NULL, true),
  ('2220', 'Withholding Tax Payable', 'Liability', 'credit', NULL, true),
  ('2300', 'Unearned Revenue', 'Liability', 'credit', NULL, true),
  ('2400', 'Loans Payable', 'Liability', 'credit', NULL, true),
  
  -- Equity
  ('3000', 'Owners Equity', 'Equity', 'credit', NULL, true),
  ('3100', 'Retained Earnings', 'Equity', 'credit', NULL, true),
  ('3200', 'Current Year Earnings', 'Equity', 'credit', NULL, true),
  
  -- Revenue - Rooms
  ('4000', 'Rooms Revenue', 'Revenue', 'credit', 'Rooms', true),
  ('4010', 'Room Rental', 'Revenue', 'credit', 'Rooms', true),
  ('4020', 'Package Revenue - Rooms', 'Revenue', 'credit', 'Rooms', true),
  ('4090', 'Rooms Allowances', 'Revenue', 'credit', 'Rooms', true),
  
  -- Revenue - F&B
  ('4100', 'Food Revenue', 'Revenue', 'credit', 'F&B', true),
  ('4110', 'Restaurant Food', 'Revenue', 'credit', 'F&B', true),
  ('4120', 'Room Service Food', 'Revenue', 'credit', 'F&B', true),
  ('4130', 'Banquet Food', 'Revenue', 'credit', 'F&B', true),
  ('4200', 'Beverage Revenue', 'Revenue', 'credit', 'F&B', true),
  ('4210', 'Bar Beverages', 'Revenue', 'credit', 'F&B', true),
  ('4220', 'Restaurant Beverages', 'Revenue', 'credit', 'F&B', true),
  ('4290', 'F&B Allowances', 'Revenue', 'credit', 'F&B', true),
  
  -- Revenue - Other
  ('4500', 'Minor Operating Revenue', 'Revenue', 'credit', NULL, true),
  ('4600', 'Rental & Other Income', 'Revenue', 'credit', NULL, true),
  ('4900', 'Other Revenue', 'Revenue', 'credit', NULL, true),
  ('4999', 'Revenue Variance', 'Revenue', 'credit', NULL, true),
  
  -- Expenses - Rooms
  ('5000', 'Rooms Expense', 'Expense', 'debit', 'Rooms', true),
  ('5010', 'Guest Supplies', 'Expense', 'debit', 'Rooms', true),
  ('5020', 'Laundry & Linen', 'Expense', 'debit', 'Rooms', true),
  ('5030', 'Cleaning Supplies', 'Expense', 'debit', 'Rooms', true),
  ('5090', 'Other Rooms Expense', 'Expense', 'debit', 'Rooms', true),
  
  -- Expenses - F&B
  ('5100', 'Cost of Food Sold', 'Expense', 'debit', 'F&B', true),
  ('5200', 'Cost of Beverage Sold', 'Expense', 'debit', 'F&B', true),
  ('5300', 'F&B Payroll', 'Expense', 'debit', 'F&B', true),
  ('5400', 'F&B Other Expense', 'Expense', 'debit', 'F&B', true),
  
  -- Expenses - Administrative
  ('6000', 'Administrative & General', 'Expense', 'debit', 'Administration', true),
  ('6100', 'Administrative Payroll', 'Expense', 'debit', 'Administration', true),
  ('6200', 'Professional Fees', 'Expense', 'debit', 'Administration', true),
  ('6300', 'Office Supplies', 'Expense', 'debit', 'Administration', true),
  ('6400', 'Insurance', 'Expense', 'debit', 'Administration', true),
  
  -- Expenses - Sales & Marketing
  ('6500', 'Sales & Marketing', 'Expense', 'debit', 'Sales & Marketing', true),
  ('6510', 'Advertising', 'Expense', 'debit', 'Sales & Marketing', true),
  ('6520', 'Promotions', 'Expense', 'debit', 'Sales & Marketing', true),
  ('6530', 'Travel Agent Commissions', 'Expense', 'debit', 'Sales & Marketing', true),
  
  -- Expenses - Utilities
  ('7000', 'Property Operations', 'Expense', 'debit', NULL, true),
  ('7100', 'Utilities', 'Expense', 'debit', NULL, true),
  ('7110', 'Electricity', 'Expense', 'debit', NULL, true),
  ('7120', 'Water', 'Expense', 'debit', NULL, true),
  ('7130', 'Gas', 'Expense', 'debit', NULL, true),
  ('7200', 'Repairs & Maintenance', 'Expense', 'debit', NULL, true),
  
  -- Expenses - Other
  ('7500', 'Depreciation & Amortization', 'Expense', 'debit', NULL, true),
  ('7600', 'Cash Over/Short', 'Expense', 'debit', NULL, true),
  ('7700', 'Interest Expense', 'Expense', 'debit', NULL, true),
  ('7800', 'Bank Charges', 'Expense', 'debit', NULL, true),
  
  -- Special accounts
  ('9000', 'Income Tax Expense', 'Expense', 'debit', NULL, true),
  ('9900', 'Suspense Account', 'Asset', 'debit', NULL, true),
  ('9999', 'Clearing Account', 'Asset', 'debit', NULL, true)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 13. SEED DEFAULT GL CODE MAPPINGS
-- ----------------------------------------------------------------------------
INSERT INTO public.gl_code_mappings (pms_code, pms_code_description, gl_account_id, mapping_type, is_system) VALUES
  ('ROOM_REVENUE', 'Room Revenue', '4000', 'revenue', true),
  ('FB_REVENUE', 'Food & Beverage Revenue', '4100', 'revenue', true),
  ('TAX', 'Tax Collected', '2200', 'liability', true),
  ('CASH', 'Cash Receipts', '1000', 'asset', true),
  ('CARD', 'Card Receipts', '1000', 'asset', true),
  ('ROOM_CHARGE', 'Room Charges', '4010', 'revenue', true),
  ('CITY_LEDGER', 'City Ledger Transfers', '1120', 'asset', true),
  ('GUEST_LEDGER', 'Guest Ledger', '1110', 'asset', true),
  ('ACCOUNTS_RECEIVABLE', 'Accounts Receivable', '1100', 'asset', true),
  ('ACCOUNTS_PAYABLE', 'Accounts Payable', '2000', 'liability', true),
  ('VARIANCE', 'Revenue Variance', '4999', 'revenue', true),
  ('SUSPENSE', 'Suspense Account', '9900', 'asset', true)
ON CONFLICT (pms_code) DO NOTHING;

-- ============================================================================
-- END OF MIGRATION V6
-- ============================================================================
