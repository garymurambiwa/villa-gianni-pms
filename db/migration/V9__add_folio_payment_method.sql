-- Migration: Add payment_method to folios table
-- Description: Adds a column to persist the selected payment method for a guest folio.

ALTER TABLE public.folios ADD COLUMN IF NOT EXISTS payment_method text;
