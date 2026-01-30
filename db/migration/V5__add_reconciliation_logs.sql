-- V5: Add reconciliation logs and variance journal entries tables
-- Tracks automatic reconciliation fallbacks and forced night audit completions

-- =============================================================================
-- RECONCILIATION LOGS TABLE
-- Records all reconciliation events including automatic fallbacks
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.reconciliation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Business date context
  business_date date NOT NULL,
  
  -- Reconciliation type
  reconciliation_type text NOT NULL DEFAULT 'manual' 
    CHECK (reconciliation_type IN ('manual', 'automatic', 'forced', 'override')),
  
  -- Status
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'failed', 'forced_complete')),
  
  -- Totals being reconciled
  folio_total numeric(12,2) NOT NULL DEFAULT 0,
  shift_total numeric(12,2) NOT NULL DEFAULT 0,
  postings_total numeric(12,2) NOT NULL DEFAULT 0,
  
  -- Variance amounts
  variance_folio_vs_shift numeric(12,2) NOT NULL DEFAULT 0,
  variance_folio_vs_postings numeric(12,2) NOT NULL DEFAULT 0,
  total_variance numeric(12,2) NOT NULL DEFAULT 0,
  
  -- Was this a forced reconciliation?
  is_forced boolean NOT NULL DEFAULT false,
  force_reason text,
  
  -- Journal entries created for variances
  journal_entry_ids text[], -- Array of GL journal entry IDs created
  
  -- Affected accounts
  affected_accounts jsonb DEFAULT '[]'::jsonb,
  
  -- Audit trail
  performed_by text,
  performed_at timestamp with time zone NOT NULL DEFAULT now(),
  
  -- Related night audit run
  night_audit_run_id uuid REFERENCES public.night_audit_runs(id) ON DELETE SET NULL,
  
  -- Additional metadata
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  
  inserted_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_reconciliation_logs_business_date 
  ON public.reconciliation_logs(business_date);
CREATE INDEX IF NOT EXISTS idx_reconciliation_logs_type 
  ON public.reconciliation_logs(reconciliation_type);
CREATE INDEX IF NOT EXISTS idx_reconciliation_logs_forced 
  ON public.reconciliation_logs(is_forced) WHERE is_forced = true;
CREATE INDEX IF NOT EXISTS idx_reconciliation_logs_performed_at 
  ON public.reconciliation_logs(performed_at DESC);

-- =============================================================================
-- VARIANCE JOURNAL ENTRIES TABLE
-- Records journal entries created for reconciliation variances
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.variance_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to reconciliation
  reconciliation_log_id uuid REFERENCES public.reconciliation_logs(id) ON DELETE CASCADE,
  
  -- Journal entry details
  journal_entry_id text NOT NULL, -- GL journal entry ID
  business_date date NOT NULL,
  
  -- Entry type
  entry_type text NOT NULL DEFAULT 'variance_adjustment'
    CHECK (entry_type IN ('variance_adjustment', 'over_short', 'suspense', 'correction')),
  
  -- Accounts affected
  debit_account text NOT NULL,
  credit_account text NOT NULL,
  
  -- Amounts
  amount numeric(12,2) NOT NULL,
  
  -- Description
  description text NOT NULL,
  reference text,
  
  -- Audit trail
  created_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  
  -- Metadata
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_variance_journal_entries_reconciliation 
  ON public.variance_journal_entries(reconciliation_log_id);
CREATE INDEX IF NOT EXISTS idx_variance_journal_entries_business_date 
  ON public.variance_journal_entries(business_date);
CREATE INDEX IF NOT EXISTS idx_variance_journal_entries_journal_id 
  ON public.variance_journal_entries(journal_entry_id);

-- =============================================================================
-- AUDIT LOG EXTENSION
-- Add reconciliation events to access_logs if not tracked elsewhere
-- =============================================================================

-- Comments for documentation
COMMENT ON TABLE public.reconciliation_logs IS 
  'Tracks all reconciliation events including automatic fallbacks during night audit';
COMMENT ON COLUMN public.reconciliation_logs.is_forced IS 
  'True if reconciliation was forced to complete despite variances';
COMMENT ON COLUMN public.reconciliation_logs.journal_entry_ids IS 
  'Array of GL journal entry IDs created to account for variances';
COMMENT ON COLUMN public.reconciliation_logs.affected_accounts IS 
  'JSON array of accounts affected by variance adjustments';

COMMENT ON TABLE public.variance_journal_entries IS 
  'Journal entries created for reconciliation variances - audit trail for accounting';
COMMENT ON COLUMN public.variance_journal_entries.entry_type IS 
  'Type of variance entry: variance_adjustment, over_short, suspense, correction';
