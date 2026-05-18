-- Database Inspection Queries for inv_items table and inv_items_short_id_len constraint
-- Run these queries in your PostgreSQL database to inspect the current state

-- 1. Inspect the full schema of the inv_items table
\d+ public.inv_items

-- 2. Retrieve the precise definition of the inv_items_short_id_len check constraint
SELECT 
    conname AS constraint_name,
    pg_get_constraintdef(c.oid) AS constraint_definition
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
JOIN pg_namespace n ON t.relnamespace = n.oid
WHERE 
    n.nspname = 'public' 
    AND t.relname = 'inv_items'
    AND c.conname = 'inv_items_short_id_len';

-- 3. Alternative query using information_schema
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
    AND tc.constraint_schema = cc.constraint_schema
WHERE 
    tc.table_schema = 'public' 
    AND tc.table_name = 'inv_items'
    AND tc.constraint_name = 'inv_items_short_id_len';

-- 4. Check if there are any existing violations in the data
SELECT 
    id,
    short_id,
    char_length(short_id) as actual_length,
    CASE 
        WHEN short_id IS NULL THEN 'NULL'
        WHEN char_length(short_id) > 10 THEN 'TOO_LONG (>10)'
        ELSE 'VALID'
    END as validation_status
FROM public.inv_items
WHERE short_id IS NOT NULL 
AND char_length(short_id) > 10
ORDER BY char_length(short_id) DESC
LIMIT 20;

-- 5. Show statistics about short_id usage
SELECT 
    COUNT(*) as total_records,
    COUNT(short_id) as non_null_short_ids,
    MIN(char_length(short_id)) as min_length,
    MAX(char_length(short_id)) as max_length,
    AVG(char_length(short_id)) as avg_length
FROM public.inv_items
WHERE short_id IS NOT NULL;