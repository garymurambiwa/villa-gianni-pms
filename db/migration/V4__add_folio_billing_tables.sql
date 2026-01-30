-- ============================================================================
-- V4: Add Folio, Billing, and Night Audit Tables
-- ============================================================================
-- This migration creates tables for:
-- 1. folios - Guest account folios
-- 2. folio_charges - Individual charges posted to guest folios
-- 3. folio_payments - Payments made against guest folios
-- 4. pos_bills - POS bill records
-- 5. night_audit_postings - Night audit room/tax postings
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FOLIOS TABLE
-- Master record for each guest's account during their stay
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
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

-- ----------------------------------------------------------------------------
-- 2. FOLIO CHARGES TABLE
-- Individual charges posted to guest folios (room charges, POS, services, etc.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.folio_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_id uuid REFERENCES public.folios(id) ON DELETE SET NULL,
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  room_number text,
  
  -- Charge details
  charge_type text NOT NULL DEFAULT 'charge' CHECK (charge_type IN ('charge', 'payment', 'adjustment', 'transfer', 'void')),
  category text NOT NULL DEFAULT 'Other',
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL,
  
  -- Source tracking
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'night_audit', 'pos', 'front_office', 'system', 'transfer')),
  source_reference text, -- e.g., POS bill ID, night audit date
  
  -- Posting details
  posting_date date NOT NULL DEFAULT CURRENT_DATE,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  
  -- Void tracking
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  
  -- Audit fields
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS folio_charges_folio_id_idx ON public.folio_charges(folio_id);
CREATE INDEX IF NOT EXISTS folio_charges_guest_id_idx ON public.folio_charges(guest_id);
CREATE INDEX IF NOT EXISTS folio_charges_reservation_id_idx ON public.folio_charges(reservation_id);
CREATE INDEX IF NOT EXISTS folio_charges_room_number_idx ON public.folio_charges(room_number);
CREATE INDEX IF NOT EXISTS folio_charges_posting_date_idx ON public.folio_charges(posting_date);
CREATE INDEX IF NOT EXISTS folio_charges_business_date_idx ON public.folio_charges(business_date);
CREATE INDEX IF NOT EXISTS folio_charges_category_idx ON public.folio_charges(category);
CREATE INDEX IF NOT EXISTS folio_charges_source_idx ON public.folio_charges(source);

-- ----------------------------------------------------------------------------
-- 3. FOLIO PAYMENTS TABLE
-- Payments made against guest folios
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.folio_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_id uuid REFERENCES public.folios(id) ON DELETE SET NULL,
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  room_number text,
  
  -- Payment details
  amount numeric(12,2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'Cash',
  reference_number text,
  card_last_four text,
  
  -- Status
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'refunded', 'voided')),
  
  -- Posting details
  posting_date date NOT NULL DEFAULT CURRENT_DATE,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  
  -- Void/refund tracking
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  
  -- Audit fields
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS folio_payments_folio_id_idx ON public.folio_payments(folio_id);
CREATE INDEX IF NOT EXISTS folio_payments_guest_id_idx ON public.folio_payments(guest_id);
CREATE INDEX IF NOT EXISTS folio_payments_posting_date_idx ON public.folio_payments(posting_date);
CREATE INDEX IF NOT EXISTS folio_payments_business_date_idx ON public.folio_payments(business_date);
CREATE INDEX IF NOT EXISTS folio_payments_payment_method_idx ON public.folio_payments(payment_method);

-- ----------------------------------------------------------------------------
-- 4. POS BILLS TABLE
-- POS transaction records (bills)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number text NOT NULL,
  
  -- Location/source
  outlet text NOT NULL DEFAULT 'Restaurant',
  table_number text,
  
  -- Guest linking (if charged to room)
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  folio_id uuid REFERENCES public.folios(id) ON DELETE SET NULL,
  room_number text,
  
  -- Bill details
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  service_charge numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  
  -- Items stored as JSONB for flexibility
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  
  -- Payment details
  payment_method text,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'charged_to_room', 'voided', 'partial')),
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  change_amount numeric(12,2) NOT NULL DEFAULT 0,
  
  -- Timestamps
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  opened_at timestamptz NOT NULL DEFAULT NOW(),
  closed_at timestamptz,
  
  -- Staff tracking
  opened_by text,
  closed_by text,
  
  -- Void tracking
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  
  -- Shift reference
  shift_id text,
  
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pos_bills_bill_number_idx ON public.pos_bills(bill_number);
CREATE INDEX IF NOT EXISTS pos_bills_outlet_idx ON public.pos_bills(outlet);
CREATE INDEX IF NOT EXISTS pos_bills_guest_id_idx ON public.pos_bills(guest_id);
CREATE INDEX IF NOT EXISTS pos_bills_folio_id_idx ON public.pos_bills(folio_id);
CREATE INDEX IF NOT EXISTS pos_bills_business_date_idx ON public.pos_bills(business_date);
CREATE INDEX IF NOT EXISTS pos_bills_payment_status_idx ON public.pos_bills(payment_status);
CREATE INDEX IF NOT EXISTS pos_bills_shift_id_idx ON public.pos_bills(shift_id);

-- ----------------------------------------------------------------------------
-- 5. NIGHT AUDIT POSTINGS TABLE
-- Room and tax charges posted during night audit
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.night_audit_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Business date this posting belongs to
  business_date date NOT NULL,
  
  -- Room/guest information
  room_number text NOT NULL,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  folio_id uuid REFERENCES public.folios(id) ON DELETE SET NULL,
  
  -- Charge breakdown
  posting_type text NOT NULL DEFAULT 'ROOM_TAX' CHECK (posting_type IN ('ROOM_TAX', 'ROOM_ONLY', 'TAX_ONLY', 'ADJUSTMENT', 'CITY_LEDGER_TRANSFER')),
  base_rate numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  
  -- Rate plan info
  rate_plan_code text,
  package_code text DEFAULT 'RO',
  
  -- Status
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'voided', 'reversed')),
  
  -- Linked folio charge
  folio_charge_id uuid REFERENCES public.folio_charges(id) ON DELETE SET NULL,
  
  -- Audit trail
  posted_by text,
  posted_at timestamptz NOT NULL DEFAULT NOW(),
  
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS night_audit_postings_business_date_idx ON public.night_audit_postings(business_date);
CREATE INDEX IF NOT EXISTS night_audit_postings_room_number_idx ON public.night_audit_postings(room_number);
CREATE INDEX IF NOT EXISTS night_audit_postings_guest_id_idx ON public.night_audit_postings(guest_id);
CREATE INDEX IF NOT EXISTS night_audit_postings_status_idx ON public.night_audit_postings(status);

-- ----------------------------------------------------------------------------
-- 6. NIGHT AUDIT RUNS TABLE
-- Record of each night audit execution
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.night_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Business date being closed
  business_date date NOT NULL UNIQUE,
  next_business_date date NOT NULL,
  
  -- Summary metrics
  rooms_posted integer NOT NULL DEFAULT 0,
  room_revenue numeric(12,2) NOT NULL DEFAULT 0,
  tax_revenue numeric(12,2) NOT NULL DEFAULT 0,
  total_revenue numeric(12,2) NOT NULL DEFAULT 0,
  city_ledger_transfers integer NOT NULL DEFAULT 0,
  city_ledger_amount numeric(12,2) NOT NULL DEFAULT 0,
  
  -- Occupancy stats
  occupied_rooms integer NOT NULL DEFAULT 0,
  available_rooms integer NOT NULL DEFAULT 0,
  occupancy_percent numeric(5,2) NOT NULL DEFAULT 0,
  adr numeric(12,2) NOT NULL DEFAULT 0, -- Average Daily Rate
  revpar numeric(12,2) NOT NULL DEFAULT 0, -- Revenue Per Available Room
  
  -- Status
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed', 'failed', 'rolled_back')),
  
  -- Audit info
  run_by text,
  started_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz,
  
  -- Error tracking
  error_message text,
  
  -- Reports snapshot (JSONB for flexibility)
  reports_snapshot jsonb,
  
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS night_audit_runs_business_date_idx ON public.night_audit_runs(business_date);
CREATE INDEX IF NOT EXISTS night_audit_runs_status_idx ON public.night_audit_runs(status);

-- ----------------------------------------------------------------------------
-- 7. CITY LEDGER ACCOUNTS TABLE
-- Direct bill and credit accounts for companies/agents
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.city_ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Account details
  account_name text NOT NULL,
  account_type text NOT NULL DEFAULT 'Corporate' CHECK (account_type IN ('Corporate', 'Travel Agent', 'Credit Card Company', 'Banquet/Event', 'Direct Bill', 'Other')),
  
  -- Financials
  credit_limit numeric(12,2) NOT NULL DEFAULT 0,
  current_balance numeric(12,2) NOT NULL DEFAULT 0,
  
  -- Terms
  payment_terms text DEFAULT 'Net 30',
  billing_cycle text DEFAULT 'Monthly',
  
  -- Contact info
  contact_name text,
  contact_phone text,
  contact_email text,
  address text,
  
  -- Status
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'On Hold', 'Closed')),
  
  -- Dates
  activated_on date DEFAULT CURRENT_DATE,
  last_activity_date date,
  
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS city_ledger_accounts_account_type_idx ON public.city_ledger_accounts(account_type);
CREATE INDEX IF NOT EXISTS city_ledger_accounts_status_idx ON public.city_ledger_accounts(status);

-- ----------------------------------------------------------------------------
-- 8. CITY LEDGER TRANSACTIONS TABLE
-- Transactions on city ledger accounts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.city_ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.city_ledger_accounts(id) ON DELETE CASCADE,
  
  -- Transaction details
  transaction_type text NOT NULL CHECK (transaction_type IN ('charge', 'payment', 'adjustment', 'transfer_in')),
  description text NOT NULL,
  reference_number text,
  
  -- Amounts
  debit_amount numeric(12,2) NOT NULL DEFAULT 0,
  credit_amount numeric(12,2) NOT NULL DEFAULT 0,
  
  -- Source tracking
  source_folio_id uuid REFERENCES public.folios(id) ON DELETE SET NULL,
  source_guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  
  -- Dates
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  
  -- Audit
  created_by text,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS city_ledger_transactions_account_id_idx ON public.city_ledger_transactions(account_id);
CREATE INDEX IF NOT EXISTS city_ledger_transactions_transaction_date_idx ON public.city_ledger_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS city_ledger_transactions_business_date_idx ON public.city_ledger_transactions(business_date);

-- ----------------------------------------------------------------------------
-- 9. UPDATE TRIGGER FOR updated_at COLUMNS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at
DO $$
BEGIN
  -- folios
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_folios_updated_at') THEN
    CREATE TRIGGER update_folios_updated_at BEFORE UPDATE ON public.folios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- folio_charges
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_folio_charges_updated_at') THEN
    CREATE TRIGGER update_folio_charges_updated_at BEFORE UPDATE ON public.folio_charges
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- folio_payments
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_folio_payments_updated_at') THEN
    CREATE TRIGGER update_folio_payments_updated_at BEFORE UPDATE ON public.folio_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- pos_bills
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_pos_bills_updated_at') THEN
    CREATE TRIGGER update_pos_bills_updated_at BEFORE UPDATE ON public.pos_bills
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- city_ledger_accounts
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_city_ledger_accounts_updated_at') THEN
    CREATE TRIGGER update_city_ledger_accounts_updated_at BEFORE UPDATE ON public.city_ledger_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ============================================================================
-- END OF MIGRATION V4
-- ============================================================================
