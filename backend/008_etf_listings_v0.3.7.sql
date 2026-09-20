begin;

-- MI CARTERA v0.3.7
-- Cotizaciones por mercado para ETF y otros instrumentos con varias admisiones a cotizacion.
-- No modifica importes, participaciones ni operaciones existentes.

insert into public.app_meta (key, value)
values ('app_version', '0.3.7')
on conflict (key)
do update set value = excluded.value, updated_at = now();

insert into public.app_meta (key, value)
values ('schema_version', '4')
on conflict (key)
do update set value = excluded.value, updated_at = now();

create table if not exists public.instrument_listings (
  provider_symbol text primary key,
  isin text not null references public.funds(isin) on delete cascade,
  ticker text not null,
  exchange_code text not null,
  exchange_name text,
  currency text,
  instrument_type text,
  is_primary boolean not null default false,
  source text not null default 'EODHD Search API',
  fetched_at timestamptz not null default now(),
  unique (isin, provider_symbol)
);

create index if not exists instrument_listings_isin_idx
  on public.instrument_listings (isin);

alter table public.instrument_listings enable row level security;

drop policy if exists "authenticated_read_instrument_listings" on public.instrument_listings;
create policy "authenticated_read_instrument_listings"
on public.instrument_listings for select
to authenticated
using (true);

grant select on public.instrument_listings to authenticated;
grant all on public.instrument_listings to service_role;

create table if not exists public.listing_prices (
  provider_symbol text not null references public.instrument_listings(provider_symbol) on delete cascade,
  price_date date not null,
  price numeric not null,
  currency text,
  source text,
  fetched_at timestamptz not null default now(),
  primary key (provider_symbol, price_date)
);

create index if not exists listing_prices_symbol_date_idx
  on public.listing_prices (provider_symbol, price_date desc);

alter table public.listing_prices enable row level security;

drop policy if exists "authenticated_read_listing_prices" on public.listing_prices;
create policy "authenticated_read_listing_prices"
on public.listing_prices for select
to authenticated
using (true);

grant select on public.listing_prices to authenticated;
grant all on public.listing_prices to service_role;

alter table public.operations
  add column if not exists listing_symbol text references public.instrument_listings(provider_symbol);

create index if not exists operations_listing_symbol_idx
  on public.operations (listing_symbol);

-- An ETF no debe conservar una unica cotizacion global por ISIN: la cotizacion
-- valida depende de la bolsa/listado elegido en cada operacion/posicion.
update public.funds
set provider_symbol = null,
    updated_at = now()
where upper(coalesce(instrument_type, '')) like '%ETF%';

commit;
