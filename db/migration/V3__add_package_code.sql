-- Add package_code to reservations and folios (if exists)
-- Default 'RO' (Room Only), NOT NULL
do $$
begin
  alter table public.reservations add column if not exists package_code text not null default 'RO';
exception when others then null;
end $$;

-- Folios table is optional in current schema; guard with IF EXISTS
do $$
begin
  execute $$alter table if exists public.folios add column if not exists package_code text not null default 'RO'$$;
exception when others then null;
end $$;

