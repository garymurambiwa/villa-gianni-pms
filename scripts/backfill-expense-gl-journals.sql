-- ============================================================================
-- One-shot backfill: vendor expenses → GL journal entries
-- ============================================================================
-- CONTEXT
--   Vendor expenses are supposed to post a balanced GL entry on save
--   (Dr Expense / Cr Accounts Payable) via persistJournalEntryToDB →
--   POST /api/gl/journal-entries. That endpoint was MISSING from Villa Gianni's
--   server/index.cjs (it lived only in api/handler.js), so every expense save
--   404'd at the GL step and silently wrote no journal. Result: 76 expenses
--   totalling $1,578.13 existed in vendor_expenses but NONE appeared in the GL,
--   so the P&L / Trial Balance / Daily Journal / daily expense reports omitted
--   them entirely.
--
--   The endpoint is now ported (so NEW expenses sync automatically). This script
--   backfills the historical expenses so the reports reflect them.
--
-- WHAT IT DOES (idempotent, balanced, non-destructive)
--   For each non-voided vendor_expense with total_cost > 0, creates a posted
--   journal entry GL_<expense_id>:
--     Dr  department-mapped Expense account   total_cost
--     Cr  2100 Accounts Payable               total_cost
--   Department → expense account mapping mirrors the live posting path.
--   ON CONFLICT / NOT EXISTS guards make re-running a no-op.
--
-- USAGE
--   Already applied to Villa Gianni. Run once on any other deployment that
--   shares this schema (e.g. Baradzanwa's DB) whose expenses pre-date the
--   endpoint fix.
-- ============================================================================

-- 1. Headers
INSERT INTO gl_journal_entries
  (id, entry_date, business_date, description, reference, source, status,
   total_debit, total_credit, is_balanced, created_by, posted_by, posted_at, inserted_at)
SELECT 'GL_'||e.id, COALESCE(e.expense_date::date, CURRENT_DATE), COALESCE(e.expense_date::date, CURRENT_DATE),
       'Vendor Expense: '||COALESCE(e.description,''), 'Vendor Expense '||e.id, 'expense', 'posted',
       e.total_cost, e.total_cost, true, 'expense_backfill', 'expense_backfill', NOW(), NOW()
FROM vendor_expenses e
WHERE COALESCE(e.status,'') <> 'voided' AND COALESCE(e.total_cost,0) > 0
ON CONFLICT (id) DO NOTHING;

-- 2. Debit lines — Expense account by CATEGORY (refined; falls back to
--    department-level USALI account, then A&G overhead). Mirrors the live path's
--    category→GL mapping so backfilled and newly-posted expenses agree.
INSERT INTO gl_journal_lines (id, journal_entry_id, gl_account_id, debit_amount, credit_amount, description, inserted_at)
SELECT 'GL_'||e.id||'_L1', 'GL_'||e.id,
  CASE e.category
    -- Villa Gianni category vocabulary
    WHEN 'Cost of Food Sold'      THEN '5100'      -- F&B Cost of Sales (COGS)
    WHEN 'Kitchen Supplies'       THEN '5297-01'   -- F&B other operating
    WHEN 'Other F&B Expenses'     THEN '5297-01'
    WHEN 'Cleaning Supplies'      THEN '5000'      -- Rooms
    WHEN 'Guest Supplies'         THEN '5000'
    WHEN 'Laundry & Linen'        THEN '5000'
    WHEN 'Equipment Maintenance'  THEN '5500'      -- Property Operations & Maintenance
    WHEN 'Other POM Expenses'     THEN '5500'
    WHEN 'Other A&G Expenses'     THEN '5300'      -- Administrative & General
    WHEN 'Professional Fees'      THEN '5300'
    -- Baradzanwa category vocabulary (note: its COA has no 5297-01)
    WHEN 'Cost of Goods Sold'     THEN '5100'
    WHEN 'Repairs & Maintenance'  THEN '5500'
    WHEN 'Grounds and Gardens'    THEN '5500'
    WHEN 'Administrative'         THEN '5300'
    WHEN 'Supplies'               THEN '5300'
    ELSE CASE e.department                          -- fallback: department-level account
      WHEN 'Administrative & General'          THEN '5300'
      WHEN 'Food & Beverage'                   THEN '5100'
      WHEN 'Property Operations & Maintenance' THEN '5500'
      WHEN 'Rooms'                             THEN '5000'
      ELSE '5300'
    END
  END,
  e.total_cost, 0, COALESCE(e.description,'Vendor expense'), NOW()
FROM vendor_expenses e
WHERE COALESCE(e.status,'') <> 'voided' AND COALESCE(e.total_cost,0) > 0
  AND EXISTS     (SELECT 1 FROM gl_journal_entries je WHERE je.id = 'GL_'||e.id)
  AND NOT EXISTS (SELECT 1 FROM gl_journal_lines  jl WHERE jl.id = 'GL_'||e.id||'_L1');

-- 3. Credit lines — Accounts Payable (2100)
INSERT INTO gl_journal_lines (id, journal_entry_id, gl_account_id, debit_amount, credit_amount, description, inserted_at)
SELECT 'GL_'||e.id||'_L2', 'GL_'||e.id, '2100', 0, e.total_cost, 'AP - '||COALESCE(e.vendor_id,'Vendor'), NOW()
FROM vendor_expenses e
WHERE COALESCE(e.status,'') <> 'voided' AND COALESCE(e.total_cost,0) > 0
  AND EXISTS     (SELECT 1 FROM gl_journal_entries je WHERE je.id = 'GL_'||e.id)
  AND NOT EXISTS (SELECT 1 FROM gl_journal_lines  jl WHERE jl.id = 'GL_'||e.id||'_L2');

-- ── Verification ────────────────────────────────────────────────────────────
-- SELECT COUNT(*) entries, COUNT(*) FILTER (WHERE ROUND(total_debit::numeric,2)=ROUND(total_credit::numeric,2)) balanced,
--        SUM(total_debit)::numeric(12,2) total
--   FROM gl_journal_entries WHERE source='expense';   -- expect entries=balanced, total = sum(vendor_expenses)
