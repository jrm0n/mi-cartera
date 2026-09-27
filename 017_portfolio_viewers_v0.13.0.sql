-- Mi Cartera v0.13.0: acceso de invitados, solo lectura y por cartera.
-- Ejecutar en SQL Editor con el rol administrador del proyecto antes de publicar.
begin;

create table if not exists public.portfolio_viewers (
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (portfolio_id, viewer_id)
);
create index if not exists portfolio_viewers_viewer_idx on public.portfolio_viewers(viewer_id, portfolio_id);
alter table public.portfolio_viewers enable row level security;
revoke all on public.portfolio_viewers from public, anon, authenticated;

-- SECURITY DEFINER consulta la pertenencia sin depender de políticas recursivas.
create or replace function public.can_view_portfolio_v1(p_portfolio_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.portfolios p
    where p.id = p_portfolio_id
      and (p.user_id = (select auth.uid()) or exists (
        select 1 from public.portfolio_viewers v
        where v.portfolio_id = p.id and v.viewer_id = (select auth.uid())
      ))
  );
$$;
create or replace function public.can_view_account_v1(p_account_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.accounts a
    where a.id = p_account_id and public.can_view_portfolio_v1(a.portfolio_id)
  );
$$;
revoke all on function public.can_view_portfolio_v1(uuid) from public, anon;
revoke all on function public.can_view_account_v1(uuid) from public, anon;
grant execute on function public.can_view_portfolio_v1(uuid), public.can_view_account_v1(uuid) to authenticated;

-- Estas políticas añaden SELECT. Las políticas existentes de escritura no se amplían.
alter table public.portfolios enable row level security;
alter table public.accounts enable row level security;
alter table public.operations enable row level security;
alter table public.transfers enable row level security;
alter table public.recurring_operations enable row level security;
drop policy if exists portfolios_select_viewers on public.portfolios;
create policy portfolios_select_viewers on public.portfolios for select to authenticated
  using (public.can_view_portfolio_v1(id));
drop policy if exists accounts_select_viewers on public.accounts;
create policy accounts_select_viewers on public.accounts for select to authenticated
  using (public.can_view_portfolio_v1(portfolio_id));
drop policy if exists operations_select_viewers on public.operations;
create policy operations_select_viewers on public.operations for select to authenticated
  using (public.can_view_account_v1(account_id));
drop policy if exists transfers_select_viewers on public.transfers;
create policy transfers_select_viewers on public.transfers for select to authenticated
  using (public.can_view_account_v1(from_account_id) and public.can_view_account_v1(to_account_id));
drop policy if exists recurring_select_viewers on public.recurring_operations;
create policy recurring_select_viewers on public.recurring_operations for select to authenticated
  using (public.can_view_portfolio_v1(portfolio_id));
grant select on public.portfolios, public.accounts, public.operations,
  public.transfers, public.recurring_operations to authenticated;

-- El historial global incluye ISIN procesados de otras carteras; no es público para invitados.
drop policy if exists "authenticated_read_market_refresh_runs" on public.market_refresh_runs;
revoke select on public.market_refresh_runs from authenticated;

-- La gestión de invitados exige ser dueño de la cartera. Los invitados no tienen escritura.
create or replace function public.set_portfolio_viewer_v1(p_portfolio_id uuid, p_email text, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_viewer uuid;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.portfolios where id = p_portfolio_id and user_id = (select auth.uid())
  ) then raise exception 'PORTFOLIO_OWNER_REQUIRED'; end if;
  select id into v_viewer from auth.users where lower(email) = lower(pg_catalog.btrim(p_email)) limit 1;
  if v_viewer is null then raise exception 'VIEWER_NOT_FOUND'; end if;
  if v_viewer = (select auth.uid()) then raise exception 'CANNOT_INVITE_SELF'; end if;
  if p_enabled then
    insert into public.portfolio_viewers(portfolio_id, viewer_id)
    values (p_portfolio_id, v_viewer) on conflict do nothing;
  else
    delete from public.portfolio_viewers where portfolio_id = p_portfolio_id and viewer_id = v_viewer;
  end if;
  return true;
end;
$$;
create or replace function public.list_portfolio_viewers_v1()
returns table(portfolio_id uuid, viewer_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select v.portfolio_id, v.viewer_id, u.email::text
  from public.portfolio_viewers v
  join public.portfolios p on p.id = v.portfolio_id
  join auth.users u on u.id = v.viewer_id
  where p.user_id = (select auth.uid())
  order by lower(u.email), v.portfolio_id;
$$;
revoke all on function public.set_portfolio_viewer_v1(uuid,text,boolean),
  public.list_portfolio_viewers_v1() from public, anon;
grant execute on function public.set_portfolio_viewer_v1(uuid,text,boolean),
  public.list_portfolio_viewers_v1() to authenticated;
commit;
