-- Breakfast Packages Schema Migration
-- This migration adds breakfast package functionality to the rate management system

-- Create breakfast_packages table for storing breakfast package definitions
CREATE TABLE IF NOT EXISTS public.breakfast_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- Create breakfast_package_seasonal_rates table for seasonal pricing adjustments
CREATE TABLE IF NOT EXISTS public.breakfast_package_seasonal_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  breakfast_package_id uuid NOT NULL REFERENCES public.breakfast_packages(id) ON DELETE CASCADE,
  season_key text NOT NULL, -- References season keys from rate_plan_config
  price_multiplier numeric(5,4) NOT NULL DEFAULT 1.0000, -- Multiplier applied to base prices (e.g., 1.2 for +20%)
  start_date date,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(breakfast_package_id, season_key)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS breakfast_packages_code_idx ON public.breakfast_packages(code);
CREATE INDEX IF NOT EXISTS breakfast_packages_active_idx ON public.breakfast_packages(is_active);
CREATE INDEX IF NOT EXISTS breakfast_package_seasonal_rates_package_idx ON public.breakfast_package_seasonal_rates(breakfast_package_id);
CREATE INDEX IF NOT EXISTS breakfast_package_seasonal_rates_season_idx ON public.breakfast_package_seasonal_rates(season_key);

-- Insert default breakfast packages
INSERT INTO public.breakfast_packages (code, name, description, base_price, adult_price, child_price, sort_order) VALUES
  ('RO', 'Room Only', 'No breakfast included', 0, 0, 0, 0),
  ('BB', 'Bed & Breakfast', 'Continental breakfast included', 15, 10, 5, 1),
  ('HB', 'Half Board', 'Breakfast and dinner included', 35, 25, 15, 2),
  ('FB', 'Full Board', 'Three meals included', 50, 35, 20, 3)
ON CONFLICT (code) DO NOTHING;

-- Add breakfast package column to reservations table if not exists
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS breakfast_package_code text DEFAULT 'RO';
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS breakfast_adults integer DEFAULT 0;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS breakfast_children integer DEFAULT 0;

-- Create indexes for reservation breakfast columns
CREATE INDEX IF NOT EXISTS reservations_breakfast_package_idx ON public.reservations(breakfast_package_code);