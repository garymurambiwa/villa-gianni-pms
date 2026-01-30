-- Add missing fields to reservations table
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS room_type text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS rate numeric(12,2) DEFAULT 0;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS adults integer DEFAULT 1;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS children integer DEFAULT 0;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS room_preference text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS booking_name text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS booking_type text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS settle_at_checkout boolean DEFAULT true;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS origin_region text;
