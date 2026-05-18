-- Schema Migration Script for inv_items_short_id_len constraint
-- This script safely modifies the constraint length requirement
-- Only run this if you need to change the length requirement (e.g., increase from 10 to 15)

-- Safety Check: First, verify current constraint definition
DO $$
DECLARE
    v_constraint_def text;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO v_constraint_def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE 
        n.nspname = 'public' 
        AND t.relname = 'inv_items'
        AND c.conname = 'inv_items_short_id_len';
    
    RAISE NOTICE 'Current constraint definition: %', v_constraint_def;
END $$;

-- Check for existing data that would violate a new constraint (if decreasing length)
-- Uncomment and modify the length below if you plan to decrease the limit
/*
DO $$
DECLARE
    v_violation_count integer;
BEGIN
    SELECT COUNT(*) INTO v_violation_count
    FROM public.inv_items
    WHERE short_id IS NOT NULL 
    AND char_length(short_id) > 8; -- Change 8 to your new desired length
    
    IF v_violation_count > 0 THEN
        RAISE EXCEPTION 'Cannot decrease constraint length: % records would violate new limit', v_violation_count
        USING HINT = 'Either update existing records or increase the length instead';
    END IF;
END $$;
*/

-- Migration Script: Modify constraint length
-- Example: Increasing length from 10 to 15 characters
BEGIN;

-- Step 1: Drop existing constraint (if it exists)
ALTER TABLE public.inv_items 
DROP CONSTRAINT IF EXISTS inv_items_short_id_len;

-- Step 2: Re-create constraint with new length
-- Change the number 15 below to your desired maximum length
ALTER TABLE public.inv_items 
ADD CONSTRAINT inv_items_short_id_len 
CHECK (short_id IS NULL OR char_length(short_id) <= 15);

-- Step 3: Verify the change
DO $$
DECLARE
    v_new_constraint_def text;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO v_new_constraint_def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE 
        n.nspname = 'public' 
        AND t.relname = 'inv_items'
        AND c.conname = 'inv_items_short_id_len';
    
    RAISE NOTICE 'New constraint definition: %', v_new_constraint_def;
END $$;

COMMIT;

-- Step 4: Validate no existing data violates the new constraint
DO $$
DECLARE
    v_invalid_count integer;
BEGIN
    SELECT COUNT(*) INTO v_invalid_count
    FROM public.inv_items
    WHERE short_id IS NOT NULL 
    AND char_length(short_id) > 15; -- Match the length used above
    
    IF v_invalid_count > 0 THEN
        RAISE WARNING 'Migration completed but % records violate the new constraint', v_invalid_count
        USING HINT = 'These records need to be fixed manually';
    ELSE
        RAISE NOTICE 'Migration successful: all records comply with the new constraint';
    END IF;
END $$;

-- Alternative: If you want to DECREASE the length (e.g., from 10 to 8), use this instead:
/*
BEGIN;
ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS inv_items_short_id_len;
ALTER TABLE public.inv_items ADD CONSTRAINT inv_items_short_id_len CHECK (short_id IS NULL OR char_length(short_id) <= 8);
COMMIT;
*/