begin;

-- MI CARTERA v0.3.2
-- Validacion de operaciones frente a VL historico con tolerancia del 0,1 %.

insert into public.app_meta (key, value)
values ('app_version', '0.3.2')
on conflict (key)
do update set value = excluded.value, updated_at = now();

insert into public.app_meta (key, value)
values ('schema_version', '2')
on conflict (key)
do update set value = excluded.value, updated_at = now();

alter table public.operations
  add column if not exists request_date date,
  add column if not exists execution_date date,
  add column if not exists validation_status text,
  add column if not exists reference_nav numeric,
  add column if not exists reference_nav_date date,
  add column if not exists nav_difference_pct numeric;

update public.operations
set request_date = coalesce(request_date, operation_date),
    execution_date = case
      when status = 'completed' then coalesce(execution_date, operation_date)
      else execution_date
    end,
    validation_status = coalesce(validation_status,
      case when status = 'completed' then 'legacy_completed' else 'pending' end)
where request_date is null
   or (status = 'completed' and execution_date is null)
   or validation_status is null;

alter table public.transfers
  add column if not exists out_execution_date date,
  add column if not exists in_execution_date date,
  add column if not exists validation_status text,
  add column if not exists out_reference_nav numeric,
  add column if not exists in_reference_nav numeric,
  add column if not exists out_difference_pct numeric,
  add column if not exists in_difference_pct numeric;

update public.transfers
set validation_status = coalesce(validation_status,
  case when status = 'completed' then 'legacy_completed' else 'pending' end)
where validation_status is null;

create or replace function public.complete_transfer_v2(
    p_transfer_id uuid,
    p_shares_out numeric,
    p_shares_in numeric,
    p_out_date date,
    p_in_date date,
    p_nav_out numeric,
    p_nav_in numeric,
    p_out_reference_nav numeric default null,
    p_in_reference_nav numeric default null,
    p_out_difference_pct numeric default null,
    p_in_difference_pct numeric default null
)
returns public.transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_transfer public.transfers;
begin
    if auth.uid() is null then
        raise exception 'Authentication required';
    end if;

    select * into v_transfer
    from public.transfers
    where id = p_transfer_id
      and user_id = auth.uid()
    for update;

    if not found then
        raise exception 'Transfer not found';
    end if;

    if p_shares_out is null or p_shares_out <= 0
       or p_shares_in is null or p_shares_in <= 0 then
        raise exception 'Both share quantities must be positive';
    end if;

    if p_out_date is null or p_in_date is null then
        raise exception 'Both execution dates are required';
    end if;

    update public.transfers
    set shares_out = p_shares_out,
        shares_in = p_shares_in,
        settlement_date = p_in_date,
        out_execution_date = p_out_date,
        in_execution_date = p_in_date,
        nav_out = p_nav_out,
        nav_in = p_nav_in,
        out_reference_nav = p_out_reference_nav,
        in_reference_nav = p_in_reference_nav,
        out_difference_pct = p_out_difference_pct,
        in_difference_pct = p_in_difference_pct,
        validation_status = 'validated',
        status = 'completed',
        updated_at = now()
    where id = p_transfer_id
    returning * into v_transfer;

    if not exists (
        select 1 from public.operations
        where transfer_id = p_transfer_id
          and operation_type = 'transfer_out'
    ) then
        insert into public.operations (
            user_id, account_id, isin, operation_type, operation_date,
            request_date, execution_date, amount, shares_delta, nav,
            external_cashflow, status, transfer_id, validation_status,
            reference_nav, reference_nav_date, nav_difference_pct
        ) values (
            v_transfer.user_id,
            v_transfer.from_account_id,
            v_transfer.from_isin,
            'transfer_out',
            p_out_date,
            v_transfer.request_date,
            p_out_date,
            v_transfer.amount,
            -abs(p_shares_out),
            p_nav_out,
            0,
            'completed',
            p_transfer_id,
            'validated',
            p_out_reference_nav,
            p_out_date,
            p_out_difference_pct
        );
    end if;

    if not exists (
        select 1 from public.operations
        where transfer_id = p_transfer_id
          and operation_type = 'transfer_in'
    ) then
        insert into public.operations (
            user_id, account_id, isin, operation_type, operation_date,
            request_date, execution_date, amount, shares_delta, nav,
            external_cashflow, status, transfer_id, validation_status,
            reference_nav, reference_nav_date, nav_difference_pct
        ) values (
            v_transfer.user_id,
            v_transfer.to_account_id,
            v_transfer.to_isin,
            'transfer_in',
            p_in_date,
            v_transfer.request_date,
            p_in_date,
            v_transfer.amount,
            abs(p_shares_in),
            p_nav_in,
            0,
            'completed',
            p_transfer_id,
            'validated',
            p_in_reference_nav,
            p_in_date,
            p_in_difference_pct
        );
    end if;

    return v_transfer;
end;
$$;

revoke all on function public.complete_transfer_v2(uuid, numeric, numeric, date, date, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.complete_transfer_v2(uuid, numeric, numeric, date, date, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.complete_transfer_v2(uuid, numeric, numeric, date, date, numeric, numeric, numeric, numeric, numeric, numeric) to service_role;

commit;
