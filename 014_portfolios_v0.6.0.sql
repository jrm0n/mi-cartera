-- Mi Cartera v0.6.0
-- Varias carteras independientes bajo un mismo usuario autenticado.
-- Ejecutar una sola vez en Supabase > SQL Editor antes de publicar la app.

begin;

create extension if not exists pgcrypto;

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  is_default boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists portfolios_user_name_uidx
  on public.portfolios (user_id, lower(btrim(name)))
  where active = true;

alter table public.portfolios enable row level security;

drop policy if exists portfolios_select_own on public.portfolios;
create policy portfolios_select_own on public.portfolios
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists portfolios_insert_own on public.portfolios;
create policy portfolios_insert_own on public.portfolios
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists portfolios_update_own on public.portfolios;
create policy portfolios_update_own on public.portfolios
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists portfolios_delete_own on public.portfolios;
create policy portfolios_delete_own on public.portfolios
  for delete to authenticated
  using (user_id = auth.uid());

alter table public.accounts
  add column if not exists portfolio_id uuid references public.portfolios(id) on delete restrict;

-- Sustituye la unicidad antigua por usuario/entidad por una unicidad dentro de cada cartera.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'accounts'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%institution_code%'
      and pg_get_constraintdef(c.oid) not ilike '%portfolio_id%'
  loop
    execute format('alter table public.accounts drop constraint %I', r.conname);
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'accounts'
      and indexdef ilike 'create unique index%'
      and indexdef ilike '%institution_code%'
      and indexdef not ilike '%portfolio_id%'
      and indexname not ilike '%pkey%'
  loop
    execute format('drop index if exists public.%I', r.indexname);
  end loop;
end $$;

create unique index if not exists accounts_portfolio_institution_name_uidx
  on public.accounts (portfolio_id, institution_code, account_name)
  where portfolio_id is not null;

create index if not exists accounts_portfolio_idx
  on public.accounts (portfolio_id);

-- Crea la primera cartera y migra únicamente las cuentas del usuario conectado.
-- Se detecta el nombre habitual de la columna propietaria para mantener compatibilidad.
create or replace function public.ensure_default_portfolio_v1(p_name text default 'Mi cartera')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_portfolio uuid;
  v_owner_column text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select id into v_portfolio
  from public.portfolios
  where user_id = v_user and active = true
  order by is_default desc, sort_order, created_at
  limit 1;

  if v_portfolio is null then
    insert into public.portfolios (user_id, name, is_default, active, sort_order)
    values (v_user, coalesce(nullif(btrim(p_name), ''), 'Mi cartera'), true, true, 0)
    returning id into v_portfolio;
  end if;

  select case
    when exists (select 1 from information_schema.columns where table_schema='public' and table_name='accounts' and column_name='user_id') then 'user_id'
    when exists (select 1 from information_schema.columns where table_schema='public' and table_name='accounts' and column_name='owner_id') then 'owner_id'
    when exists (select 1 from information_schema.columns where table_schema='public' and table_name='accounts' and column_name='profile_id') then 'profile_id'
    else null
  end into v_owner_column;

  if v_owner_column is null then
    raise exception 'No se encuentra la columna propietaria de accounts';
  end if;

  execute format(
    'update public.accounts set portfolio_id = $1 where portfolio_id is null and %I = $2',
    v_owner_column
  ) using v_portfolio, v_user;

  return v_portfolio;
end;
$$;

revoke all on function public.ensure_default_portfolio_v1(text) from public;
grant execute on function public.ensure_default_portfolio_v1(text) to authenticated;

grant select, insert, update, delete on public.portfolios to authenticated;

commit;
