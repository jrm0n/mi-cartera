begin;

-- MI CARTERA v0.3.8
-- Unifica Tradegate en un único listing canónico para evitar que una posición
-- seleccionada como Tradegate termine valorándose con un alias EODHD distinto.

insert into public.app_meta (key, value)
values ('app_version', '0.3.8')
on conflict (key)
do update set value = excluded.value, updated_at = now();

insert into public.app_meta (key, value)
values ('schema_version', '5')
on conflict (key)
do update set value = excluded.value, updated_at = now();

-- Crear listing canónico para cualquier ISIN que ya tenga un listing identificado
-- como Tradegate. Se copia únicamente identidad de mercado; NO se copia precio.
insert into public.instrument_listings (
  provider_symbol, isin, ticker, exchange_code, exchange_name,
  currency, instrument_type, is_primary, source, fetched_at
)
select distinct on (l.isin)
  'TRADEGATE:' || l.isin,
  l.isin,
  l.ticker,
  'TGAT',
  'Tradegate',
  coalesce(l.currency, 'EUR'),
  coalesce(l.instrument_type, 'ETF'),
  false,
  'Tradegate Exchange',
  now()
from public.instrument_listings l
where upper(coalesce(l.exchange_code, '')) in ('TDG','TGAT','TGATE','TRADEGATE')
   or lower(coalesce(l.exchange_name, '')) like '%tradegate%'
   or l.provider_symbol like 'TRADEGATE:%'
order by l.isin,
         case when l.provider_symbol like 'TRADEGATE:%' then 0 else 1 end,
         l.fetched_at desc
on conflict (provider_symbol) do update set
  ticker = excluded.ticker,
  exchange_code = 'TGAT',
  exchange_name = 'Tradegate',
  currency = coalesce(excluded.currency, public.instrument_listings.currency, 'EUR'),
  instrument_type = coalesce(excluded.instrument_type, public.instrument_listings.instrument_type, 'ETF'),
  source = 'Tradegate Exchange',
  fetched_at = now();

-- Migrar operaciones que apuntaban a aliases EODHD de Tradegate.
update public.operations o
set listing_symbol = 'TRADEGATE:' || o.isin,
    updated_at = now()
from public.instrument_listings l
where o.listing_symbol = l.provider_symbol
  and o.listing_symbol <> 'TRADEGATE:' || o.isin
  and (
    upper(coalesce(l.exchange_code, '')) in ('TDG','TGAT','TGATE','TRADEGATE')
    or lower(coalesce(l.exchange_name, '')) like '%tradegate%'
  )
  and exists (
    select 1 from public.instrument_listings c
    where c.provider_symbol = 'TRADEGATE:' || o.isin
  );

-- Los aliases EODHD de Tradegate ya no deben aparecer como alternativas distintas.
-- Al no estar referenciados por operaciones después de la migración, se pueden limpiar.
delete from public.instrument_listings l
where l.provider_symbol not like 'TRADEGATE:%'
  and (
    upper(coalesce(l.exchange_code, '')) in ('TDG','TGAT','TGATE','TRADEGATE')
    or lower(coalesce(l.exchange_name, '')) like '%tradegate%'
  )
  and not exists (
    select 1 from public.operations o where o.listing_symbol = l.provider_symbol
  );

commit;
