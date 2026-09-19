-- Mi Cartera v0.1.0 - backend inicial de sincronización
create table if not exists public.portfolio_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null default 1,
  revision bigint not null default 0,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.portfolio_state enable row level security;

create policy "users_read_own_portfolio"
on public.portfolio_state for select
using (auth.uid() = user_id);

create policy "users_insert_own_portfolio"
on public.portfolio_state for insert
with check (auth.uid() = user_id);

create policy "users_update_own_portfolio"
on public.portfolio_state for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.fund_navs (
  isin text not null,
  nav_date date not null,
  nav numeric not null,
  currency text not null default 'EUR',
  source text,
  fetched_at timestamptz not null default now(),
  primary key (isin, nav_date)
);
