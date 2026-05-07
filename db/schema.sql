-- ============================================================================
-- COREPMS Combined Database Schema
-- Auto-generated from migration files V1-V6
-- For use with bundled PostgreSQL portable installation
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- CORE TABLES (V1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admins (
  user_id VARCHAR(255) PRIMARY KEY,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id VARCHAR(255) PRIMARY KEY,
  email text,
  full_name text,
  role text,
  property_id text,
  is_active boolean DEFAULT true,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.printer_configs (
  id VARCHAR(255) PRIMARY KEY,
  property_id text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS printer_configs_property_id_idx ON public.printer_configs(property_id);

CREATE TABLE IF NOT EXISTS public.rooms (
  id VARCHAR(255) PRIMARY KEY,
  number text UNIQUE NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'vacant',
  rate numeric(12,2) NOT NULL DEFAULT 0,
  floor integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.guests (
  id VARCHAR(255) PRIMARY KEY,
  full_name text NOT NULL,
  email text,
  phone text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reservations (
  id VARCHAR(255) PRIMARY KEY,
  guest_id VARCHAR(255) NOT NULL,
  room_id VARCHAR(255),
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  status text NOT NULL DEFAULT 'booked',
  source text,
  id_document_enc text,
  id_document_type text,
  nationality_code text,
  nationality_name text,
  booking_source text,
  partner_code text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  terms_accepted boolean,
  confirmed_at timestamptz,
  signature_encrypted text,
  payment_info_source text,
  payment_verified boolean,
  package_code text NOT NULL DEFAULT 'RO',
  room_type text,
  rate numeric(12,2) DEFAULT 0,
  adults integer DEFAULT 1,
  children integer DEFAULT 0,
  room_preference text,
  booking_name text,
  booking_type text,
  company_name text,
  payment_method text,
  settle_at_checkout boolean DEFAULT true,
  origin_region text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.menu_items (
  id VARCHAR(255) PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  price numeric(12,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255),
  table_no text,
  status text NOT NULL DEFAULT 'open',
  total numeric(12,2) NOT NULL DEFAULT 0,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id VARCHAR(255) PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL,
  menu_item_id VARCHAR(255) NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  price numeric(12,2) NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id VARCHAR(255) PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'units',
  reorder_level integer NOT NULL DEFAULT 10,
  cost numeric(12,2) NOT NULL DEFAULT 0,
  stock_level integer DEFAULT 0,
  price numeric(12,2) DEFAULT 0,
  visibility text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id VARCHAR(255) PRIMARY KEY,
  item_id VARCHAR(255) NOT NULL,
  delta numeric NOT NULL,
  reason text,
  user_id VARCHAR(255),
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id VARCHAR(255) PRIMARY KEY,
  name text NOT NULL,
  contact text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- USER AUTHENTICATION TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_users (
  id VARCHAR(255) PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  password_change_required BOOLEAN NOT NULL DEFAULT false,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_mock_account BOOLEAN NOT NULL DEFAULT false,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  lockout_until TIMESTAMP,
  password_changed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login TIMESTAMP,
  last_activity TIMESTAMP,
  permissions TEXT[],
  two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  two_factor_secret TEXT
);

CREATE TABLE IF NOT EXISTS public.access_logs (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMP NOT NULL DEFAULT NOW(),
  user_username VARCHAR(255),
  event VARCHAR(255) NOT NULL,
  detail JSONB
);

CREATE TABLE IF NOT EXISTS public.email_verifications (
  token VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMP NOT NULL DEFAULT NOW(),
  user_username VARCHAR(255),
  ip VARCHAR(50),
  user_agent TEXT,
  ok BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS public.taxes (
  id VARCHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  percentage NUMERIC(12,2) NOT NULL,
  is_inclusive BOOLEAN NOT NULL DEFAULT false,
  applies_to VARCHAR(50) NOT NULL CHECK (applies_to IN ('all','accommodation','pos','services')),
  active BOOLEAN NOT NULL DEFAULT true,
  inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pos_orders (
  id VARCHAR(36) PRIMARY KEY,
  table_number VARCHAR(20),
  items JSONB,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for authentication
CREATE INDEX IF NOT EXISTS idx_app_users_username ON public.app_users(username);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON public.app_users(email);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON public.login_attempts(user_username);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ts ON public.login_attempts(ts);
CREATE INDEX IF NOT EXISTS idx_reservations_guest ON public.reservations(guest_id);
CREATE INDEX IF NOT EXISTS idx_reservations_room ON public.reservations(room_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON public.reservations(status);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS taxes_active_idx ON public.taxes(active);
CREATE INDEX IF NOT EXISTS taxes_applies_idx ON public.taxes(applies_to);

-- ============================================================================
-- FOLIO & BILLING TABLES (V4)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.folios (
  id VARCHAR(255) PRIMARY KEY,
  guest_id VARCHAR(255) NOT NULL,
  reservation_id VARCHAR(255),
  room_number text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'pending', 'transferred')),
  balance numeric(12,2) NOT NULL DEFAULT 0,
  package_code text NOT NULL DEFAULT 'RO',
  created_by text,
  closed_at timestamptz,
  closed_by text,
  notes text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS folios_guest_id_idx ON public.folios(guest_id);
CREATE INDEX IF NOT EXISTS folios_reservation_id_idx ON public.folios(reservation_id);
CREATE INDEX IF NOT EXISTS folios_status_idx ON public.folios(status);
CREATE INDEX IF NOT EXISTS folios_room_number_idx ON public.folios(room_number);

CREATE TABLE IF NOT EXISTS public.folio_charges (
  id VARCHAR(255) PRIMARY KEY,
  folio_id VARCHAR(255),
  guest_id VARCHAR(255) NOT NULL,
  reservation_id VARCHAR(255),
  room_number text,
  charge_type text NOT NULL DEFAULT 'charge' CHECK (charge_type IN ('charge', 'payment', 'adjustment', 'transfer', 'void')),
  category text NOT NULL DEFAULT 'Other',
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'night_audit', 'pos', 'front_office', 'system', 'transfer')),
  source_reference text,
  posting_date date NOT NULL DEFAULT CURRENT_DATE,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS folio_charges_folio_id_idx ON public.folio_charges(folio_id);
CREATE INDEX IF NOT EXISTS folio_charges_guest_id_idx ON public.folio_charges(guest_id);
CREATE INDEX IF NOT EXISTS folio_charges_posting_date_idx ON public.folio_charges(posting_date);
CREATE INDEX IF NOT EXISTS folio_charges_business_date_idx ON public.folio_charges(business_date);

CREATE TABLE IF NOT EXISTS public.folio_payments (
  id VARCHAR(255) PRIMARY KEY,
  folio_id VARCHAR(255),
  guest_id VARCHAR(255) NOT NULL,
  reservation_id VARCHAR(255),
  room_number text,
  amount numeric(12,2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'Cash',
  reference_number text,
  card_last_four text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'refunded', 'voided')),
  posting_date date NOT NULL DEFAULT CURRENT_DATE,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS public.night_audit_postings (
  id VARCHAR(255) PRIMARY KEY,
  business_date date NOT NULL,
  room_number text NOT NULL,
  guest_id VARCHAR(255),
  reservation_id VARCHAR(255),
  folio_id VARCHAR(255),
  posting_type text NOT NULL DEFAULT 'ROOM_TAX' CHECK (posting_type IN ('ROOM_TAX', 'ROOM_ONLY', 'TAX_ONLY', 'ADJUSTMENT', 'CITY_LEDGER_TRANSFER')),
  base_rate numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  rate_plan_code text,
  package_code text DEFAULT 'RO',
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'voided', 'reversed')),
  folio_charge_id VARCHAR(255),
  posted_by text,
  posted_at timestamptz NOT NULL DEFAULT NOW(),
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.night_audit_runs (
  id VARCHAR(255) PRIMARY KEY,
  business_date date NOT NULL UNIQUE,
  next_business_date date NOT NULL,
  rooms_posted integer NOT NULL DEFAULT 0,
  room_revenue numeric(12,2) NOT NULL DEFAULT 0,
  tax_revenue numeric(12,2) NOT NULL DEFAULT 0,
  total_revenue numeric(12,2) NOT NULL DEFAULT 0,
  city_ledger_transfers integer NOT NULL DEFAULT 0,
  city_ledger_amount numeric(12,2) NOT NULL DEFAULT 0,
  occupied_rooms integer NOT NULL DEFAULT 0,
  available_rooms integer NOT NULL DEFAULT 0,
  occupancy_percent numeric(5,2) NOT NULL DEFAULT 0,
  adr numeric(12,2) NOT NULL DEFAULT 0,
  revpar numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed', 'failed', 'rolled_back')),
  run_by text,
  started_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz,
  error_message text,
  reports_snapshot jsonb,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.city_ledger_accounts (
  id VARCHAR(255) PRIMARY KEY,
  account_name text NOT NULL,
  account_type text NOT NULL DEFAULT 'Corporate' CHECK (account_type IN ('Corporate', 'Travel Agent', 'Credit Card Company', 'Banquet/Event', 'Direct Bill', 'Other')),
  credit_limit numeric(12,2) NOT NULL DEFAULT 0,
  current_balance numeric(12,2) NOT NULL DEFAULT 0,
  payment_terms text DEFAULT 'Net 30',
  billing_cycle text DEFAULT 'Monthly',
  contact_name text,
  contact_phone text,
  contact_email text,
  address text,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'On Hold', 'Closed')),
  activated_on date DEFAULT CURRENT_DATE,
  last_activity_date date,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.city_ledger_transactions (
  id VARCHAR(255) PRIMARY KEY,
  account_id VARCHAR(255) NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('charge', 'payment', 'adjustment', 'transfer_in')),
  description text NOT NULL,
  reference_number text,
  debit_amount numeric(12,2) NOT NULL DEFAULT 0,
  credit_amount numeric(12,2) NOT NULL DEFAULT 0,
  source_folio_id VARCHAR(255),
  source_guest_id VARCHAR(255),
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- RECONCILIATION TABLES (V5)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reconciliation_logs (
  id VARCHAR(255) PRIMARY KEY,
  business_date date NOT NULL,
  reconciliation_type text NOT NULL DEFAULT 'manual' CHECK (reconciliation_type IN ('manual', 'automatic', 'forced', 'override')),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'forced_complete')),
  folio_total numeric(12,2) NOT NULL DEFAULT 0,
  shift_total numeric(12,2) NOT NULL DEFAULT 0,
  postings_total numeric(12,2) NOT NULL DEFAULT 0,
  variance_folio_vs_shift numeric(12,2) NOT NULL DEFAULT 0,
  variance_folio_vs_postings numeric(12,2) NOT NULL DEFAULT 0,
  total_variance numeric(12,2) NOT NULL DEFAULT 0,
  is_forced boolean NOT NULL DEFAULT false,
  force_reason text,
  journal_entry_ids text[],
  affected_accounts jsonb DEFAULT '[]'::jsonb,
  performed_by text,
  performed_at timestamptz NOT NULL DEFAULT NOW(),
  night_audit_run_id VARCHAR(255),
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.variance_journal_entries (
  id VARCHAR(255) PRIMARY KEY,
  reconciliation_log_id VARCHAR(255),
  journal_entry_id text NOT NULL,
  business_date date NOT NULL,
  entry_type text NOT NULL DEFAULT 'variance_adjustment' CHECK (entry_type IN ('variance_adjustment', 'over_short', 'suspense', 'correction')),
  debit_account text NOT NULL,
  credit_account text NOT NULL,
  amount numeric(12,2) NOT NULL,
  description text NOT NULL,
  reference text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  metadata jsonb DEFAULT '{}'::jsonb
);

-- ============================================================================
-- ACCOUNTING MODULE TABLES (V6)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gl_accounts (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  account_type text,
  usali_code text,
  usali_name text,
  department text,
  parent_account_id text REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  level integer NOT NULL DEFAULT 1,
  normal_balance text NOT NULL DEFAULT 'debit' CHECK (normal_balance IN ('debit', 'credit')),
  is_active boolean NOT NULL DEFAULT true,
  is_header boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  current_balance numeric(14,2) NOT NULL DEFAULT 0,
  ytd_balance numeric(14,2) NOT NULL DEFAULT 0,
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.gl_code_mappings (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  pms_code text NOT NULL UNIQUE,
  pms_code_description text,
  gl_account_id text NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  mapping_type text NOT NULL DEFAULT 'revenue' CHECK (mapping_type IN ('revenue', 'expense', 'asset', 'liability', 'equity')),
  cost_center text,
  department text,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.gl_journal_entries (
  id text PRIMARY KEY,
  entry_date date NOT NULL,
  business_date date NOT NULL,
  description text,
  reference text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'night_audit', 'expense', 'pos', 'folio', 'reconciliation', 'adjustment', 'closing', 'opening', 'system')),
  source_reference text,
  source_id text,
  entry_type text NOT NULL DEFAULT 'standard' CHECK (entry_type IN ('standard', 'adjusting', 'closing', 'opening', 'reversing', 'recurring')),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'pending', 'posted', 'voided', 'reversed')),
  total_debit numeric(14,2) NOT NULL DEFAULT 0,
  total_credit numeric(14,2) NOT NULL DEFAULT 0,
  is_balanced boolean NOT NULL DEFAULT true,
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  reversed_by_entry_id text REFERENCES public.gl_journal_entries(id) ON DELETE SET NULL,
  reverses_entry_id text REFERENCES public.gl_journal_entries(id) ON DELETE SET NULL,
  attachments jsonb DEFAULT '{}'::jsonb,
  created_by text,
  posted_by text,
  posted_at timestamptz,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.gl_journal_lines (
  id VARCHAR(255) PRIMARY KEY,
  journal_entry_id text NOT NULL,
  line_number integer NOT NULL DEFAULT 1,
  gl_account_id text NOT NULL,
  debit_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  description text,
  memo text,
  department text,
  cost_center text,
  reference text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vendors (
  id VARCHAR(255) PRIMARY KEY,
  name text NOT NULL,
  code text UNIQUE,
  vendor_type text NOT NULL DEFAULT 'Supplier' CHECK (vendor_type IN ('Supplier', 'Contractor', 'Service Provider', 'Utility', 'Government', 'Other')),
  category text,
  contact_name text,
  phone text,
  email text,
  website text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text DEFAULT 'Philippines',
  tax_id text,
  business_registration text,
  payment_terms text DEFAULT 'Net 30',
  default_gl_account_id text,
  default_cost_center text,
  bank_name text,
  bank_account_number text,
  bank_routing_number text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id VARCHAR(255) PRIMARY KEY,
  expense_number text NOT NULL UNIQUE,
  vendor_id VARCHAR(255),
  vendor_name text,
  invoice_number text,
  invoice_date date,
  due_date date,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  expense_type text NOT NULL DEFAULT 'Operating' CHECK (expense_type IN ('Operating', 'Capital', 'Payroll', 'Tax', 'Interest', 'Other')),
  category text NOT NULL DEFAULT 'General',
  gl_account_id text REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  cost_center text,
  department text,
  amount numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'PHP',
  exchange_rate numeric(10,6) DEFAULT 1.0,
  amount_local numeric(14,2),
  payment_method text CHECK (payment_method IN ('Cash', 'Check', 'BankTransfer', 'CreditCard', 'Petty Cash', 'Other')),
  payment_reference text,
  paid_date date,
  paid_amount numeric(14,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'posted', 'paid', 'voided')),
  requires_approval boolean NOT NULL DEFAULT false,
  approval_threshold numeric(14,2),
  approved_by text,
  approved_at timestamptz,
  approval_notes text,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  journal_entry_id text REFERENCES public.gl_journal_entries(id) ON DELETE SET NULL,
  description text,
  notes text,
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  is_recurring boolean NOT NULL DEFAULT false,
  recurring_frequency text CHECK (recurring_frequency IN ('weekly', 'monthly', 'quarterly', 'annually')),
  recurring_end_date date,
  parent_expense_id VARCHAR(255),
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_attachments (
  id VARCHAR(255) PRIMARY KEY,
  expense_id VARCHAR(255) NOT NULL,
  file_name text NOT NULL,
  file_type text,
  file_size integer,
  storage_type text NOT NULL DEFAULT 'base64' CHECK (storage_type IN ('base64', 'url', 'file_path')),
  file_data text,
  description text,
  uploaded_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.budgets (
  id VARCHAR(255) PRIMARY KEY,
  budget_year integer NOT NULL,
  budget_month integer,
  period_type text NOT NULL DEFAULT 'monthly' CHECK (period_type IN ('monthly', 'quarterly', 'annual')),
  gl_account_id text,
  department text,
  cost_center text,
  budgeted_amount numeric(14,2) NOT NULL DEFAULT 0,
  revised_amount numeric(14,2),
  actual_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'locked', 'closed')),
  notes text,
  created_by text,
  approved_by text,
  approved_at timestamptz,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (budget_year, budget_month, gl_account_id, department, cost_center)
);

CREATE TABLE IF NOT EXISTS public.pos_shifts (
  id text PRIMARY KEY,
  outlet text NOT NULL DEFAULT 'Restaurant',
  shift_number integer NOT NULL DEFAULT 1,
  business_date date NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT NOW(),
  closed_at timestamptz,
  opened_by text NOT NULL,
  closed_by text,
  opening_cash numeric(12,2) NOT NULL DEFAULT 0,
  closing_cash numeric(12,2),
  expected_cash numeric(12,2),
  cash_variance numeric(12,2),
  total_sales numeric(12,2) NOT NULL DEFAULT 0,
  total_cash numeric(12,2) NOT NULL DEFAULT 0,
  total_card numeric(12,2) NOT NULL DEFAULT 0,
  total_room_charge numeric(12,2) NOT NULL DEFAULT 0,
  total_city_ledger numeric(12,2) NOT NULL DEFAULT 0,
  total_voids numeric(12,2) NOT NULL DEFAULT 0,
  total_discounts numeric(12,2) NOT NULL DEFAULT 0,
  total_refunds numeric(12,2) NOT NULL DEFAULT 0,
  transaction_count integer NOT NULL DEFAULT 0,
  void_count integer NOT NULL DEFAULT 0,
  refund_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed', 'reconciled')),
  is_reconciled boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz,
  reconciled_by text,
  reconciliation_notes text,
  z_reading_number text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id VARCHAR(255) PRIMARY KEY,
  period_year integer NOT NULL,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_name text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('future', 'open', 'closing', 'closed', 'locked')),
  closed_at timestamptz,
  closed_by text,
  closing_entry_id text,
  reopened_at timestamptz,
  reopened_by text,
  reopen_reason text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (period_year, period_month)
);

-- ============================================================================
-- UPDATE TRIGGER FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================================================
-- SEED DEFAULT GL ACCOUNTS (USALI-aligned)
-- ============================================================================

INSERT INTO public.gl_accounts (id, name, category, normal_balance, department, is_system) VALUES
  ('1000', 'Cash', 'Asset', 'debit', NULL, true),
  ('1010', 'Petty Cash', 'Asset', 'debit', NULL, true),
  ('1100', 'Accounts Receivable', 'Asset', 'debit', NULL, true),
  ('1110', 'Guest Ledger', 'Asset', 'debit', NULL, true),
  ('1120', 'City Ledger', 'Asset', 'debit', NULL, true),
  ('1200', 'Inventory', 'Asset', 'debit', NULL, true),
  ('2000', 'Accounts Payable', 'Liability', 'credit', NULL, true),
  ('2200', 'Taxes Payable', 'Liability', 'credit', NULL, true),
  ('3000', 'Owners Equity', 'Equity', 'credit', NULL, true),
  ('3100', 'Retained Earnings', 'Equity', 'credit', NULL, true),
  ('4000', 'Rooms Revenue', 'Revenue', 'credit', 'Rooms', true),
  ('4010', 'Room Rental', 'Revenue', 'credit', 'Rooms', true),
  ('4100', 'Food Revenue', 'Revenue', 'credit', 'F&B', true),
  ('4200', 'Beverage Revenue', 'Revenue', 'credit', 'F&B', true),
  ('4999', 'Revenue Variance', 'Revenue', 'credit', NULL, true),
  ('5000', 'Rooms Expense', 'Expense', 'debit', 'Rooms', true),
  ('5100', 'Cost of Food Sold', 'Expense', 'debit', 'F&B', true),
  ('5200', 'Cost of Beverage Sold', 'Expense', 'debit', 'F&B', true),
  ('6000', 'Administrative & General', 'Expense', 'debit', 'Administration', true),
  ('7100', 'Utilities', 'Expense', 'debit', NULL, true),
  ('7600', 'Cash Over/Short', 'Expense', 'debit', NULL, true),
  ('9900', 'Suspense Account', 'Asset', 'debit', NULL, true),
  ('9999', 'Clearing Account', 'Asset', 'debit', NULL, true)
ON CONFLICT (id) DO NOTHING;

-- Seed default GL code mappings
     INSERT INTO public.gl_code_mappings (pms_code, pms_code_description, gl_account_id, mapping_type, is_system) VALUES
  ('ROOM_REVENUE', 'Room Revenue', '4000', 'revenue', true),
  ('FB_REVENUE', 'Food & Beverage Revenue', '4100', 'revenue', true),
  ('TAX', 'Tax Collected', '2200', 'liability', true),
  ('CASH', 'Cash Receipts', '1000', 'asset', true),
  ('VARIANCE', 'Revenue Variance', '4999', 'revenue', true),
  ('SUSPENSE', 'Suspense Account', '9900', 'asset', true)
ON CONFLICT (pms_code) DO NOTHING;

-- ============================================================================
-- BREAKFAST PACKAGES TABLES (V7)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.breakfast_packages (
  id VARCHAR(255) PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  base_price numeric(12,2) NOT NULL DEFAULT 0,
  adult_price numeric(12,2) NOT NULL DEFAULT 0,
  child_price numeric(12,2) NOT NULL DEFAULT 0,
  applicable_room_types jsonb DEFAULT '[]'::jsonb, -- JSON array of room types this package applies to (empty = all)
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.breakfast_package_seasonal_rates (
  id VARCHAR(255) PRIMARY KEY,
  breakfast_package_id VARCHAR(255) NOT NULL REFERENCES public.breakfast_packages(id) ON DELETE CASCADE,
  season_key text NOT NULL, -- References season keys from rate_plan_config
  price_multiplier numeric(5,4) NOT NULL DEFAULT 1.0000, -- Multiplier applied to base prices (e.g., 1.2 for +20%)
  start_date date,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Create indexes for breakfast packages performance
CREATE INDEX IF NOT EXISTS breakfast_packages_code_idx ON public.breakfast_packages(code);
CREATE INDEX IF NOT EXISTS breakfast_packages_active_idx ON public.breakfast_packages(is_active);

-- ============================================================================
-- ROOM AUDITS (V8)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.room_audits (
  id VARCHAR(255) PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id VARCHAR(255),
  user_username VARCHAR(255),
  user_role VARCHAR(50),
  action VARCHAR(50) NOT NULL,
  room_id VARCHAR(255),
  before_state JSONB,
  after_state JSONB,
  message TEXT,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS room_audits_room_id_idx ON public.room_audits(room_id);
CREATE INDEX IF NOT EXISTS room_audits_timestamp_idx ON public.room_audits(timestamp);

-- ============================================================================
-- SYSTEM CONFIGS (V8)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.system_configs (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(255)
);

-- ============================================================================
-- MAINTENANCE (V9)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.assets (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  serial_number VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.work_orders (
  id VARCHAR(255) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  room_number VARCHAR(50),
  asset_id VARCHAR(255) REFERENCES public.assets(id),
  priority VARCHAR(50) DEFAULT 'medium', -- low, medium, high
  status VARCHAR(50) NOT NULL DEFAULT 'open', -- open, in_progress, closed
  assigned_to VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

-- ============================================================================
-- EXPENSES (V9)
-- ============================================================================

-- [DUPLICATE V9 EXPENSES REMOVED/COMMENTED OUT to favor V6]
-- CREATE TABLE IF NOT EXISTS public.expenses (
--   id VARCHAR(255) PRIMARY KEY,
--   date DATE NOT NULL,
--   vendor_id VARCHAR(255) NOT NULL,
--   invoice_ref VARCHAR(255) NOT NULL,
--   payment_method VARCHAR(50) NOT NULL,
--   amount NUMERIC(12, 2) NOT NULL,
--   currency VARCHAR(10) DEFAULT 'USD',
--   gl_account_id VARCHAR(50) NOT NULL,
--   cost_center VARCHAR(100) NOT NULL,
--   description TEXT,
--   attachment_name VARCHAR(255),
--   attachment_url TEXT,
--   status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, pending_approval, approved, posted
--   approved_by VARCHAR(255),
--   approved_at TIMESTAMPTZ,
--   posted_at TIMESTAMPTZ,
--   created_by VARCHAR(255),
--   comments JSONB DEFAULT '[]'::jsonb,
--   inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- );

-- CREATE INDEX IF NOT EXISTS expenses_date_idx ON public.expenses(date);
-- CREATE INDEX IF NOT EXISTS expenses_status_idx ON public.expenses(status);

-- ============================================================================
-- COCKTAIL / F&B (V10)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cocktail_ingredients (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(50) NOT NULL, -- ml, oz, cl, each
  stock_qty NUMERIC(12, 4) DEFAULT 0,
  threshold NUMERIC(12, 4),
  cost_per_unit NUMERIC(12, 4),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cocktail_recipes (
  id VARCHAR(255) PRIMARY KEY,
  item_id VARCHAR(255) NOT NULL, -- Link to POS item
  name VARCHAR(255) NOT NULL,
  ingredients JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of { ingredientId, qty, unit }
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cocktail_usage (
  id VARCHAR(255) PRIMARY KEY,
  item_id VARCHAR(255),
  count INTEGER,
  recipe_id VARCHAR(255),
  ingredients_snapshot JSONB, -- Snapshot of recipe at time of usage
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cocktail_waste (
  id VARCHAR(255) PRIMARY KEY,
  ingredient_id VARCHAR(255) REFERENCES public.cocktail_ingredients(id),
  qty NUMERIC(12, 4) NOT NULL,
  reason TEXT,
  bartender_id VARCHAR(255),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cocktail_usage_ts_idx ON public.cocktail_usage(timestamp);

-- ============================================================================
-- PHASE 6: FINAL POLISH (V11)
-- ============================================================================

-- [DUPLICATE V11 VENDORS REMOVED to favor V6]
-- CREATE TABLE IF NOT EXISTS public.vendors (
--   id VARCHAR(255) PRIMARY KEY,
--   name VARCHAR(255) NOT NULL,
--   currency VARCHAR(10) DEFAULT 'USD',
--   terms VARCHAR(255),
--   created_at TIMESTAMPTZ DEFAULT NOW(),
--   updated_at TIMESTAMPTZ
-- );

-- ============================================================================
-- UNIFIED PRODUCTS TABLE (POS + Inventory source of truth)
-- Replaces the split menu_items + inventory_items for POS management
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.products (
  id VARCHAR(255) PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  department text NOT NULL DEFAULT 'Restaurant',
  price numeric(12,2) NOT NULL DEFAULT 0,
  cost_price numeric(12,2) NOT NULL DEFAULT 0,
  stock_level numeric(12,4) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'units',
  active boolean NOT NULL DEFAULT true,
  visibility jsonb DEFAULT '{"bar": true, "restaurant": true}'::jsonb,
  bar_visibility boolean NOT NULL DEFAULT true,
  restaurant_visibility boolean NOT NULL DEFAULT true,
  is_stock_item boolean NOT NULL DEFAULT true,
  category_id VARCHAR(255),
  sub_id VARCHAR(255),
  parent_sub_id VARCHAR(255),
  notes text,
  barcodes jsonb DEFAULT '[]'::jsonb,
  cos_percent numeric(5,2) DEFAULT 0,
  gp_percent numeric(5,2) DEFAULT 0,
  gp_amount numeric(12,2) DEFAULT 0,
  qty_received numeric(12,4) DEFAULT 0,
  image_bg_color text,
  picture_data text,
  reorder_level numeric(12,4) DEFAULT 0,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_department ON public.products(department);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(active);
CREATE INDEX IF NOT EXISTS idx_products_is_stock ON public.products(is_stock_item);
CREATE INDEX IF NOT EXISTS idx_products_bar_vis ON public.products(bar_visibility);
CREATE INDEX IF NOT EXISTS idx_products_rest_vis ON public.products(restaurant_visibility);
CREATE INDEX IF NOT EXISTS idx_products_name ON public.products(name);

-- Auto-update trigger for products
DROP TRIGGER IF EXISTS update_products_updated_at ON public.products;
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VENDOR EXPENSES & PAYMENTS (persistent expense tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vendor_expenses (
  id VARCHAR(255) PRIMARY KEY,
  vendor_id VARCHAR(255),
  vendor_name text NOT NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  department text NOT NULL DEFAULT 'Administration',
  quantity numeric(12,4) NOT NULL DEFAULT 1,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_cost numeric(12,2) NOT NULL DEFAULT 0,
  reference_number text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'cleared', 'voided')),
  gl_account_id text,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by text,
  approved_by text,
  approved_at timestamptz,
  notes text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vendor_payments (
  id VARCHAR(255) PRIMARY KEY,
  vendor_id VARCHAR(255),
  vendor_name text NOT NULL,
  expense_id VARCHAR(255) REFERENCES public.vendor_expenses(id) ON DELETE SET NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'Cash',
  reference_number text,
  bank_reference text,
  notes text,
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_expenses_date ON public.vendor_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_vendor_expenses_vendor ON public.vendor_expenses(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_expenses_status ON public.vendor_expenses(status);
CREATE INDEX IF NOT EXISTS idx_vendor_expenses_dept ON public.vendor_expenses(department);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_date ON public.vendor_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor ON public.vendor_payments(vendor_id);

-- ============================================================================
-- POS ORDERS EXTENDED COLUMNS
-- Ensures pos_orders supports shift_id and other fields used by reporting
-- ============================================================================

ALTER TABLE IF EXISTS public.pos_orders ADD COLUMN IF NOT EXISTS shift_id text;
ALTER TABLE IF EXISTS public.pos_orders ADD COLUMN IF NOT EXISTS outlet text DEFAULT 'Restaurant';
ALTER TABLE IF EXISTS public.pos_orders ADD COLUMN IF NOT EXISTS opened_by text;
ALTER TABLE IF EXISTS public.pos_orders ADD COLUMN IF NOT EXISTS closed_by text;
ALTER TABLE IF EXISTS public.pos_orders ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE IF EXISTS public.pos_orders ADD COLUMN IF NOT EXISTS business_date date DEFAULT CURRENT_DATE;
ALTER TABLE IF EXISTS public.pos_orders ADD COLUMN IF NOT EXISTS table_number text;
ALTER TABLE IF EXISTS public.pos_orders ADD COLUMN IF NOT EXISTS guest_id text;
ALTER TABLE IF EXISTS public.pos_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_pos_orders_shift ON public.pos_orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_date ON public.pos_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_pos_orders_business_date ON public.pos_orders(business_date);
CREATE INDEX IF NOT EXISTS idx_pos_orders_status ON public.pos_orders(status);

CREATE TABLE IF NOT EXISTS public.z_readings (
  id VARCHAR(255) PRIMARY KEY,
  reading_number INTEGER NOT NULL,
  shift_id VARCHAR(255) NOT NULL,
  outlet VARCHAR(50) DEFAULT 'default',
  data JSONB NOT NULL, -- Full report data
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_audits (
  id VARCHAR(255) PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  action VARCHAR(255) NOT NULL,
  entity_type VARCHAR(100),
  entity_id VARCHAR(255),
  user_id VARCHAR(255),
  details JSONB
);

CREATE INDEX IF NOT EXISTS z_readings_shift_idx ON public.z_readings(shift_id);
CREATE INDEX IF NOT EXISTS system_audits_ts_idx ON public.system_audits(timestamp);
CREATE INDEX IF NOT EXISTS system_audits_entity_idx ON public.system_audits(entity_type, entity_id);




CREATE INDEX IF NOT EXISTS breakfast_package_seasonal_rates_package_idx ON public.breakfast_package_seasonal_rates(breakfast_package_id);
CREATE INDEX IF NOT EXISTS breakfast_package_seasonal_rates_season_idx ON public.breakfast_package_seasonal_rates(season_key);

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================


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
ALTER TABLE IF EXISTS public.reservations ADD COLUMN IF NOT EXISTS breakfast_package_code text DEFAULT 'RO';
ALTER TABLE IF EXISTS public.reservations ADD COLUMN IF NOT EXISTS breakfast_adults integer DEFAULT 0;
ALTER TABLE IF EXISTS public.reservations ADD COLUMN IF NOT EXISTS breakfast_children integer DEFAULT 0;

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
ALTER TABLE IF EXISTS public.inventory_items ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

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

-- Reservation breakfast indexes
CREATE INDEX IF NOT EXISTS reservations_breakfast_package_idx ON public.reservations(breakfast_package_code);


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

DROP TRIGGER IF EXISTS update_inventory_items_updated_at ON public.inventory_items;
CREATE TRIGGER update_inventory_items_updated_at 
  BEFORE UPDATE ON public.inventory_items 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


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
  -- Standard Rooms ($80)
  ('room_101', '101', 'Standard Room', 'vacant', 80.00, NOW(), NOW()),
  ('room_103', '103', 'Standard Room', 'vacant', 80.00, NOW(), NOW()),
  ('room_105', '105', 'Standard Room', 'vacant', 80.00, NOW(), NOW()),
  ('room_107', '107', 'Standard Room', 'vacant', 80.00, NOW(), NOW()),
  ('room_108', '108', 'Standard Room', 'vacant', 80.00, NOW(), NOW()),

  -- Executive Rooms ($100)
  ('room_109', '109', 'Executive Room', 'vacant', 100.00, NOW(), NOW()),
  ('room_106', '106', 'Executive Room', 'vacant', 100.00, NOW(), NOW()),
  ('room_110', '110', 'Executive Room', 'vacant', 100.00, NOW(), NOW()),
  ('room_112', '112', 'Executive Room', 'vacant', 100.00, NOW(), NOW()),

  -- Executive Suites ($150)
  ('room_111', '111', 'Executive Suite', 'vacant', 150.00, NOW(), NOW()),
  ('room_104', '104', 'Executive Suite', 'vacant', 150.00, NOW(), NOW()),

  -- Villa/Lodge ($300)
  ('room_114', '114', 'Villa Self Catering', 'vacant', 300.00, NOW(), NOW()),
  ('room_115', '115', 'Villa Self Catering', 'vacant', 300.00, NOW(), NOW()),
  ('room_116', '116', 'New Lodge', 'vacant', 300.00, NOW(), NOW())
ON CONFLICT (number) DO NOTHING; -- Never overwrite existing room configurations (Baradzanwa protection)

-- Default menu categories
INSERT INTO public.menu_items (id, name, category, price, active, inserted_at) VALUES
  ('menu_sample_1', 'Grilled Chicken', 'Main Course', 350.00, true, NOW()),
  ('menu_sample_2', 'Caesar Salad', 'Appetizer', 180.00, true, NOW()),
  ('menu_sample_3', 'Fresh Juice', 'Beverage', 80.00, true, NOW())
ON CONFLICT (id) DO NOTHING;

-- Default breakfast packages
INSERT INTO public.breakfast_packages (id, code, name, description, base_price, adult_price, child_price, sort_order, inserted_at) VALUES
  ('bp_ro', 'RO', 'Room Only', 'No breakfast included', 0, 0, 0, 0, NOW()),
  ('bp_bb', 'BB', 'Bed & Breakfast', 'Continental breakfast included', 15, 10, 5, 1, NOW()),
  ('bp_hb', 'HB', 'Half Board', 'Breakfast and dinner included', 35, 25, 15, 2, NOW()),
  ('bp_fb', 'FB', 'Full Board', 'Three meals included', 50, 35, 20, 3, NOW())
ON CONFLICT (code) DO NOTHING;
