begin;

-- ============================================================
-- MI CARTERA v0.3.0 DATA
-- Migration: 005_data_sources_v0.3.0
-- Adds provenance fields for externally sourced fund metadata.
-- Does NOT modify portfolio operations, accounts, transfers or shares.
-- ============================================================

alter table public.funds
  add column if not exists data_provider text,
  add column if not exists provider_symbol text,
  add column if not exists metadata_source text,
  add column if not exists metadata_fetched_at timestamptz,
  add column if not exists category text,
  add column if not exists category_source text,
  add column if not exists category_fetched_at timestamptz;

-- Remove only the manually assigned themes introduced by migration 002.
-- We do not delete any fund rows because they may already be referenced by
-- real operations. Source-backed category data will be filled by resolve-fund.
update public.funds
set theme = 'Sin clasificar'
where (isin = 'LU2145463613' and theme = 'Materiales')
   or (isin = 'LU0270816068' and theme = 'Semiconductores')
   or (isin = 'LU2466448532' and theme = 'Espacio')
   or (isin = 'IE00B3VXGD32' and theme = 'Biotecnología')
   or (isin = 'IE00B3CCJB88' and theme = 'Tecnología');

insert into public.app_meta (key, value)
values ('app_version', '0.3.0')
on conflict (key)
do update set value = excluded.value, updated_at = now();

commit;
