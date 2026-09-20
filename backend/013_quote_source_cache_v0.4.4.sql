begin;

-- MI CARTERA v0.4.4
-- Cachea la pagina externa usada para el precio de cierre de cada listing.
-- Evita tener que redescubrir la URL de MarketScreener en cada refresco.

insert into public.app_meta (key, value)
values ('app_version', '0.4.4')
on conflict (key)
do update set value = excluded.value, updated_at = now();

insert into public.app_meta (key, value)
values ('schema_version', '8')
on conflict (key)
do update set value = excluded.value, updated_at = now();

alter table public.instrument_listings
  add column if not exists valuation_source_url text,
  add column if not exists valuation_source_name text,
  add column if not exists valuation_source_checked_at timestamptz;

commit;
