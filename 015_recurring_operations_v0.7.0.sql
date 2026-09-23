-- Mi Cartera v0.7.0
-- Reglas de aportación recurrente. Una fila representa toda la recurrencia;
-- las ejecuciones se calculan en la app con el VL/precio histórico exacto.
-- Ejecutar una sola vez en Supabase > SQL Editor antes de publicar la app.

begin;

create extension if not exists pgcrypto;

create table if not exists public.recurring_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  isin text not null references public.funds(isin) on update cascade on delete restrict,
  listing_symbol text null,
  amount numeric not null check (amount > 0),
  start_date date not null,
  day_of_month smallint not null check (day_of_month between 1 and 31),
  interval_months smallint not null check (interval_months in (1, 2, 3, 6, 12)),
  end_date date null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_operations_valid_dates check (end_date is null or end_date >= start_date)
);

create index if not exists recurring_operations_portfolio_idx
  on public.recurring_operations (portfolio_id, active, start_date);

create index if not exists recurring_operations_account_isin_idx
  on public.recurring_operations (account_id, isin);

alter table public.recurring_operations enable row level security;

drop policy if exists recurring_operations_select_own on public.recurring_operations;
create policy recurring_operations_select_own on public.recurring_operations
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists recurring_operations_insert_own on public.recurring_operations;
create policy recurring_operations_insert_own on public.recurring_operations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.portfolios p where p.id = recurring_operations.portfolio_id and p.user_id = auth.uid())
    and exists (select 1 from public.accounts a where a.id = recurring_operations.account_id and a.portfolio_id = recurring_operations.portfolio_id)
  );

drop policy if exists recurring_operations_update_own on public.recurring_operations;
create policy recurring_operations_update_own on public.recurring_operations
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.portfolios p where p.id = recurring_operations.portfolio_id and p.user_id = auth.uid())
    and exists (select 1 from public.accounts a where a.id = recurring_operations.account_id and a.portfolio_id = recurring_operations.portfolio_id)
  );

drop policy if exists recurring_operations_delete_own on public.recurring_operations;
create policy recurring_operations_delete_own on public.recurring_operations
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.recurring_operations to authenticated;

commit;
