-- ============================================================================
-- V12: Inventory Module Production Fixes
-- Date: 2026-05-11
-- Fixes: selling_price column, UOM deduplication, missing indexes,
--        transfer reference_note column, transaction_number uniqueness
-- ============================================================================

-- 1. Add selling_price to inv_items (was stored only in products, not inv_items)
ALTER TABLE public.inv_items ADD COLUMN IF NOT EXISTS selling_price NUMERIC(10,2) DEFAULT 0.00;

-- 2. Sync existing selling prices from products into inv_items
UPDATE public.inv_items i
SET selling_price = p.price
FROM public.products p
WHERE p.id = i.id AND p.price > 0;

-- 3. Deduplicate UOM: merge uom_l -> uom_liter (L -> LITER)
UPDATE public.inv_items         SET base_uom_id     = 'uom_liter' WHERE base_uom_id     = 'uom_l';
UPDATE public.inv_grn_lines     SET received_uom_id = 'uom_liter' WHERE received_uom_id = 'uom_l';
UPDATE public.inv_transfer_lines SET source_uom_id  = 'uom_liter' WHERE source_uom_id  = 'uom_l';
UPDATE public.inv_transfer_lines SET destination_uom_id = 'uom_liter' WHERE destination_uom_id = 'uom_l';
UPDATE public.inv_stock_ledger  SET base_uom_id     = 'uom_liter' WHERE base_uom_id     = 'uom_l';
UPDATE public.inv_uom_conversions SET from_uom_id   = 'uom_liter' WHERE from_uom_id     = 'uom_l';
UPDATE public.inv_uom_conversions SET to_uom_id     = 'uom_liter' WHERE to_uom_id       = 'uom_l';
DELETE FROM public.inv_uom_definitions WHERE id = 'uom_l';

-- 4. Deduplicate UOM: merge uom_gram -> uom_g (GRAM -> G)
UPDATE public.inv_items         SET base_uom_id     = 'uom_g' WHERE base_uom_id     = 'uom_gram';
UPDATE public.inv_grn_lines     SET received_uom_id = 'uom_g' WHERE received_uom_id = 'uom_gram';
UPDATE public.inv_transfer_lines SET source_uom_id  = 'uom_g' WHERE source_uom_id  = 'uom_gram';
UPDATE public.inv_transfer_lines SET destination_uom_id = 'uom_g' WHERE destination_uom_id = 'uom_gram';
UPDATE public.inv_stock_ledger  SET base_uom_id     = 'uom_g' WHERE base_uom_id     = 'uom_gram';
UPDATE public.inv_uom_conversions SET from_uom_id   = 'uom_g' WHERE from_uom_id     = 'uom_gram';
UPDATE public.inv_uom_conversions SET to_uom_id     = 'uom_g' WHERE to_uom_id       = 'uom_gram';
DELETE FROM public.inv_uom_definitions WHERE id = 'uom_gram';

-- 5. Ensure inventory_transactions.transaction_number has unique constraint (for ON CONFLICT)
ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT IF NOT EXISTS uniq_inventory_transactions_number UNIQUE (transaction_number);

-- 6. Add missing inserted_at timestamp to inv_stock_ledger if called transaction_date
ALTER TABLE public.inv_stock_ledger ADD COLUMN IF NOT EXISTS inserted_at TIMESTAMPTZ DEFAULT NOW();
UPDATE public.inv_stock_ledger SET inserted_at = transaction_date WHERE inserted_at IS NULL;

-- 7. Add posted_at to inv_grn_headers if missing
ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;
ALTER TABLE public.inv_grn_headers ADD COLUMN IF NOT EXISTS posted_by TEXT;

-- 8. Add description column to inv_locations if missing
ALTER TABLE public.inv_locations ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.inv_locations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 9. Add description to inv_uom_definitions if missing
ALTER TABLE public.inv_uom_definitions ADD COLUMN IF NOT EXISTS description TEXT;

-- 10. Ensure inv_transfer_headers has reference_text (not notes)
-- (already exists from V11 schema — just confirming)
ALTER TABLE public.inv_transfer_headers ADD COLUMN IF NOT EXISTS transfer_date DATE DEFAULT CURRENT_DATE;

-- 11. Performance index on inv_items.selling_price for POS sync queries
CREATE INDEX IF NOT EXISTS idx_inv_items_selling_price ON public.inv_items(selling_price) WHERE selling_price > 0;
CREATE INDEX IF NOT EXISTS idx_inv_items_active_category ON public.inv_items(is_active, category);

-- 12. Add unique constraint on inv_items.sku to prevent duplicate imports
-- (only for non-null SKUs)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inv_items_sku ON public.inv_items(sku) WHERE sku IS NOT NULL;

-- Log migration
DO $$
BEGIN
    RAISE NOTICE 'V12 Inventory Fixes applied successfully';
    RAISE NOTICE '- selling_price column added to inv_items';
    RAISE NOTICE '- Duplicate UOMs merged (uom_l->uom_liter, uom_gram->uom_g)';
    RAISE NOTICE '- Missing columns and constraints added';
END $$;
