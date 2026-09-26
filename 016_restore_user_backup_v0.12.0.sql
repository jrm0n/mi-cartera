-- Mi Cartera v0.12.0. Ejecutar una vez en Supabase SQL Editor ANTES de publicar el frontend.
-- Restaura solo las cinco tablas propias del usuario autenticado dentro del mismo proyecto.
-- No restaura fondos, cotizaciones, instituciones ni un proyecto Supabase eliminado.
-- La petición RPC es una transacción: cualquier error deshace todas las inserciones.

begin;

create or replace function public.restore_user_backup_v1(p_backup jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tables jsonb;
  v_name text;
  v_expected integer;
  v_counts jsonb := '{}'::jsonb;
begin
  if v_user is null then
    raise exception 'BACKUP_AUTH_REQUIRED';
  end if;
  if p_backup->>'app' is distinct from 'Mi Cartera'
     or p_backup->>'formatVersion' is distinct from '2'
     or p_backup->>'schemaVersion' is distinct from '10'
     or p_backup->>'ownerId' is distinct from v_user::text then
    raise exception 'BACKUP_WRONG_FORMAT_OR_OWNER';
  end if;
  v_tables := p_backup->'tables';
  foreach v_name in array array['portfolios','accounts','operations','transfers','recurring_operations'] loop
    if pg_catalog.jsonb_typeof(v_tables->v_name) is distinct from 'array' then
      raise exception 'BACKUP_MISSING_TABLE: %', v_name;
    end if;
    v_expected := pg_catalog.jsonb_array_length(v_tables->v_name);
    if v_expected > 50000 then raise exception 'BACKUP_TOO_MANY_ROWS: %', v_name; end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(v_tables->v_name) as row_data(value)
      where row_data.value->>'user_id' is distinct from v_user::text
         or row_data.value->>'id' is null
    ) then
      raise exception 'BACKUP_INVALID_ROW_OWNER_OR_ID: %', v_name;
    end if;
    v_counts := v_counts || pg_catalog.jsonb_build_object(v_name,v_expected);
  end loop;

  -- Un cliente no puede usar una copia para añadir o reemplazar registros existentes.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,0));
  if exists(select 1 from public.accounts where user_id=v_user)
     or exists(select 1 from public.operations where user_id=v_user)
     or exists(select 1 from public.transfers where user_id=v_user)
     or exists(select 1 from public.recurring_operations where user_id=v_user) then
    raise exception 'BACKUP_TARGET_NOT_EMPTY';
  end if;
  -- El inicio de la app puede haber creado una cartera por defecto vacía.
  if exists(select 1 from public.accounts a join public.portfolios p on p.id=a.portfolio_id where p.user_id=v_user) then
    raise exception 'BACKUP_TARGET_PORTFOLIO_HAS_ACCOUNTS';
  end if;

  -- Las referencias internas deben permanecer dentro de los registros de la copia.
  if exists(
    select 1 from pg_catalog.jsonb_to_recordset(v_tables->'accounts') as a(portfolio_id uuid)
    where not exists(select 1 from pg_catalog.jsonb_to_recordset(v_tables->'portfolios') as p(id uuid)
                     where p.id=a.portfolio_id)
  ) then raise exception 'BACKUP_INVALID_PORTFOLIO_REFERENCE'; end if;
  if exists(
    select 1 from pg_catalog.jsonb_to_recordset(v_tables->'operations') as o(account_id uuid)
    where not exists(select 1 from pg_catalog.jsonb_to_recordset(v_tables->'accounts') as a(id uuid)
                     where a.id=o.account_id)
  ) then raise exception 'BACKUP_INVALID_ACCOUNT_REFERENCE'; end if;
  if exists(
    select 1 from pg_catalog.jsonb_to_recordset(v_tables->'operations') as o(transfer_id uuid)
    where o.transfer_id is not null
      and not exists(select 1 from pg_catalog.jsonb_to_recordset(v_tables->'transfers') as t(id uuid)
                     where t.id=o.transfer_id)
  ) then raise exception 'BACKUP_INVALID_OPERATION_TRANSFER_REFERENCE'; end if;
  if exists(
    select 1 from pg_catalog.jsonb_to_recordset(v_tables->'transfers') as t(from_account_id uuid,to_account_id uuid)
    where not exists(select 1 from pg_catalog.jsonb_to_recordset(v_tables->'accounts') as a(id uuid)
                     where a.id=t.from_account_id)
       or not exists(select 1 from pg_catalog.jsonb_to_recordset(v_tables->'accounts') as a(id uuid)
                     where a.id=t.to_account_id)
  ) then raise exception 'BACKUP_INVALID_TRANSFER_REFERENCE'; end if;
  if exists(
    select 1 from pg_catalog.jsonb_to_recordset(v_tables->'recurring_operations') as r(portfolio_id uuid,account_id uuid)
    where not exists(select 1 from pg_catalog.jsonb_to_recordset(v_tables->'accounts') as a(id uuid,portfolio_id uuid)
                     where a.id=r.account_id and a.portfolio_id=r.portfolio_id)
  ) then raise exception 'BACKUP_INVALID_RECURRING_REFERENCE'; end if;

  -- Validar dependencias externas ANTES de borrar la cartera vacía.
  if exists(
    select 1 from pg_catalog.jsonb_to_recordset(v_tables->'accounts') as x(institution_code text)
    where not exists(select 1 from public.institutions i where i.code=x.institution_code)
  ) then raise exception 'BACKUP_MISSING_INSTITUTION'; end if;
  if exists(
    select 1 from (
      select isin from pg_catalog.jsonb_to_recordset(v_tables->'operations') as x(isin text)
      union select from_isin from pg_catalog.jsonb_to_recordset(v_tables->'transfers') as x(from_isin text)
      union select to_isin from pg_catalog.jsonb_to_recordset(v_tables->'transfers') as x(to_isin text)
      union select isin from pg_catalog.jsonb_to_recordset(v_tables->'recurring_operations') as x(isin text)
    ) refs where not exists(select 1 from public.funds f where f.isin=refs.isin)
  ) then raise exception 'BACKUP_MISSING_FUND'; end if;
  if exists(
    select 1 from (
      select listing_symbol from pg_catalog.jsonb_to_recordset(v_tables->'operations') as x(listing_symbol text)
      union select listing_symbol from pg_catalog.jsonb_to_recordset(v_tables->'recurring_operations') as x(listing_symbol text)
    ) refs where refs.listing_symbol is not null
      and not exists(select 1 from public.instrument_listings l where l.provider_symbol=refs.listing_symbol)
  ) then raise exception 'BACKUP_MISSING_LISTING'; end if;

  -- Sólo el valor booleano false, enviado explícitamente, permite escribir.
  if p_dry_run is distinct from false then
    return pg_catalog.jsonb_build_object('ready',true,'dry_run',true,'counts',v_counts);
  end if;

  delete from public.portfolios where user_id=v_user;

  insert into public.portfolios(id,user_id,name,is_default,active,sort_order,created_at,updated_at)
  select x.id,v_user,x.name,x.is_default,x.active,x.sort_order,x.created_at,x.updated_at
  from pg_catalog.jsonb_to_recordset(v_tables->'portfolios') as x(
    id uuid,user_id uuid,name text,is_default boolean,active boolean,sort_order integer,
    created_at timestamptz,updated_at timestamptz);

  insert into public.accounts(id,user_id,institution_code,account_name,active,created_at,updated_at,portfolio_id)
  select x.id,v_user,x.institution_code,x.account_name,x.active,x.created_at,x.updated_at,x.portfolio_id
  from pg_catalog.jsonb_to_recordset(v_tables->'accounts') as x(
    id uuid,user_id uuid,institution_code text,account_name text,active boolean,
    created_at timestamptz,updated_at timestamptz,portfolio_id uuid);

  insert into public.transfers(
    id,user_id,from_account_id,from_isin,to_account_id,to_isin,request_date,settlement_date,
    amount,shares_out,shares_in,nav_out,nav_in,status,notes,created_at,updated_at,
    out_execution_date,in_execution_date,validation_status,out_reference_nav,
    in_reference_nav,out_difference_pct,in_difference_pct)
  select x.id,v_user,x.from_account_id,x.from_isin,x.to_account_id,x.to_isin,x.request_date,x.settlement_date,
    x.amount,x.shares_out,x.shares_in,x.nav_out,x.nav_in,x.status,x.notes,x.created_at,x.updated_at,
    x.out_execution_date,x.in_execution_date,x.validation_status,x.out_reference_nav,
    x.in_reference_nav,x.out_difference_pct,x.in_difference_pct
  from pg_catalog.jsonb_to_recordset(v_tables->'transfers') as x(
    id uuid,user_id uuid,from_account_id uuid,from_isin text,to_account_id uuid,to_isin text,
    request_date date,settlement_date date,amount numeric,shares_out numeric,shares_in numeric,
    nav_out numeric,nav_in numeric,status text,notes text,created_at timestamptz,updated_at timestamptz,
    out_execution_date date,in_execution_date date,validation_status text,out_reference_nav numeric,
    in_reference_nav numeric,out_difference_pct numeric,in_difference_pct numeric);

  insert into public.operations(
    id,user_id,account_id,isin,operation_type,operation_date,amount,shares_delta,nav,fees,
    external_cashflow,status,transfer_id,notes,created_at,updated_at,request_date,execution_date,
    validation_status,reference_nav,reference_nav_date,nav_difference_pct,listing_symbol,
    input_consistency_pct,execution_confirmed)
  select x.id,v_user,x.account_id,x.isin,x.operation_type,x.operation_date,x.amount,x.shares_delta,x.nav,x.fees,
    x.external_cashflow,x.status,x.transfer_id,x.notes,x.created_at,x.updated_at,x.request_date,x.execution_date,
    x.validation_status,x.reference_nav,x.reference_nav_date,x.nav_difference_pct,x.listing_symbol,
    x.input_consistency_pct,x.execution_confirmed
  from pg_catalog.jsonb_to_recordset(v_tables->'operations') as x(
    id uuid,user_id uuid,account_id uuid,isin text,operation_type text,operation_date date,
    amount numeric,shares_delta numeric,nav numeric,fees numeric,external_cashflow numeric,
    status text,transfer_id uuid,notes text,created_at timestamptz,updated_at timestamptz,
    request_date date,execution_date date,validation_status text,reference_nav numeric,
    reference_nav_date date,nav_difference_pct numeric,listing_symbol text,
    input_consistency_pct numeric,execution_confirmed boolean);

  insert into public.recurring_operations(
    id,user_id,portfolio_id,account_id,isin,listing_symbol,amount,start_date,day_of_month,
    interval_months,end_date,active,created_at,updated_at)
  select x.id,v_user,x.portfolio_id,x.account_id,x.isin,x.listing_symbol,x.amount,x.start_date,
    x.day_of_month,x.interval_months,x.end_date,x.active,x.created_at,x.updated_at
  from pg_catalog.jsonb_to_recordset(v_tables->'recurring_operations') as x(
    id uuid,user_id uuid,portfolio_id uuid,account_id uuid,isin text,listing_symbol text,
    amount numeric,start_date date,day_of_month smallint,interval_months smallint,
    end_date date,active boolean,created_at timestamptz,updated_at timestamptz);

  if (select count(*) from public.portfolios where user_id=v_user) <> (v_counts->>'portfolios')::integer
     or (select count(*) from public.accounts where user_id=v_user) <> (v_counts->>'accounts')::integer
     or (select count(*) from public.operations where user_id=v_user) <> (v_counts->>'operations')::integer
     or (select count(*) from public.transfers where user_id=v_user) <> (v_counts->>'transfers')::integer
     or (select count(*) from public.recurring_operations where user_id=v_user) <> (v_counts->>'recurring_operations')::integer then
    raise exception 'BACKUP_RESTORE_COUNT_MISMATCH';
  end if;
  return pg_catalog.jsonb_build_object('ready',true,'dry_run',false,'counts',v_counts);
end;
$$;

revoke all on function public.restore_user_backup_v1(jsonb,boolean) from public, anon;
grant execute on function public.restore_user_backup_v1(jsonb,boolean) to authenticated;

commit;
