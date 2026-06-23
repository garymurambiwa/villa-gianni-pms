-- ============================================================================
-- One-shot remediation: GL account normal_balance defects
-- ============================================================================
-- CONTEXT
--   A GL setup audit found 9 chart-of-accounts rows with an incorrect
--   `normal_balance` reference attribute (the side an account normally carries):
--     • 4 Liabilities (2100 A/P, 2300 VAT Payable, 2400 Advance Deposits,
--       2500 Current Portion LTD) were set to 'debit'  → should be 'credit'
--     • 1 Equity      (3200 Current Year Earnings)     was set to 'debit'  → 'credit'
--     • 4 Revenue     (4300 Spa, 4400 Telephone/Internet, 4500 Other Operated,
--       4600 Misc Income)                              were set to 'debit'  → 'credit'
--
--   Double-entry convention (international / USALI):
--     Assets, Expenses          → normal_balance = 'debit'
--     Liabilities, Equity, Revenue → normal_balance = 'credit'
--
--   This corrects ONLY the reference attribute used for reporting sign
--   conventions. No posted journal amounts are touched, and the posting audit
--   confirmed all entries already balance with correct Dr/Cr sides (0 unbalanced,
--   0 wrong-side revenue/expense, 0 orphan lines).
--
-- USAGE
--   Already applied to Villa Gianni's database. Run once on any other deployment
--   that shares this chart of accounts (e.g. Baradzanwa's DB) to bring it into
--   line. IDEMPOTENT — re-running is a no-op once all accounts are correct.
-- ============================================================================

UPDATE gl_accounts
   SET normal_balance = CASE WHEN category IN ('Asset', 'Expense') THEN 'debit' ELSE 'credit' END,
       updated_at = NOW()
 WHERE (category IN ('Asset', 'Expense')              AND normal_balance <> 'debit')
    OR (category IN ('Revenue', 'Liability', 'Equity') AND normal_balance <> 'credit');

-- ── Verification (expect 0) ─────────────────────────────────────────────────
-- SELECT COUNT(*) AS remaining_normal_balance_defects
--   FROM gl_accounts
--  WHERE (category IN ('Asset','Expense')              AND normal_balance <> 'debit')
--     OR (category IN ('Revenue','Liability','Equity') AND normal_balance <> 'credit');
