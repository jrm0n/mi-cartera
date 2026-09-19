begin;

-- ============================================================
-- MI CARTERA v0.2.0
-- Migration: 002_cloud_helpers
-- Keeps schema version 1; adds safe client RPC helpers.
-- ============================================================

insert into public.app_meta (key, value)
values ('app_version', '0.2.0')
on conflict (key)
do update set value = excluded.value, updated_at = now();

-- Ensure a fund exists without granting direct write access to the shared
-- fund master. Existing fund records are left untouched.
create or replace function public.ensure_fund(
    p_isin text,
    p_name text default null,
    p_theme text default null,
    p_currency text default 'EUR'
)
returns public.funds
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_fund public.funds;
begin
    if auth.uid() is null then
        raise exception 'Authentication required';
    end if;

    if p_isin is null or length(trim(p_isin)) = 0 then
        raise exception 'ISIN required';
    end if;

    insert into public.funds (isin, name, theme, currency)
    values (
        upper(trim(p_isin)),
        coalesce(nullif(trim(p_name), ''), upper(trim(p_isin))),
        coalesce(nullif(trim(p_theme), ''), 'Sin clasificar'),
        upper(coalesce(nullif(trim(p_currency), ''), 'EUR'))
    )
    on conflict (isin) do nothing;

    select * into v_fund
    from public.funds
    where isin = upper(trim(p_isin));

    return v_fund;
end;
$$;

revoke all on function public.ensure_fund(text, text, text, text) from public, anon;
grant execute on function public.ensure_fund(text, text, text, text) to authenticated;
grant execute on function public.ensure_fund(text, text, text, text) to service_role;

-- Complete a pending transfer atomically and create the two ledger entries.
create or replace function public.complete_transfer(
    p_transfer_id uuid,
    p_shares_out numeric,
    p_shares_in numeric,
    p_settlement_date date default current_date,
    p_nav_out numeric default null,
    p_nav_in numeric default null
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

    update public.transfers
    set shares_out = p_shares_out,
        shares_in = p_shares_in,
        settlement_date = coalesce(p_settlement_date, request_date),
        nav_out = coalesce(p_nav_out, nav_out),
        nav_in = coalesce(p_nav_in, nav_in),
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
            amount, shares_delta, nav, external_cashflow, status, transfer_id
        ) values (
            v_transfer.user_id,
            v_transfer.from_account_id,
            v_transfer.from_isin,
            'transfer_out',
            coalesce(v_transfer.settlement_date, v_transfer.request_date),
            v_transfer.amount,
            -abs(p_shares_out),
            coalesce(p_nav_out, v_transfer.nav_out),
            0,
            'completed',
            p_transfer_id
        );
    end if;

    if not exists (
        select 1 from public.operations
        where transfer_id = p_transfer_id
          and operation_type = 'transfer_in'
    ) then
        insert into public.operations (
            user_id, account_id, isin, operation_type, operation_date,
            amount, shares_delta, nav, external_cashflow, status, transfer_id
        ) values (
            v_transfer.user_id,
            v_transfer.to_account_id,
            v_transfer.to_isin,
            'transfer_in',
            coalesce(v_transfer.settlement_date, v_transfer.request_date),
            v_transfer.amount,
            abs(p_shares_in),
            coalesce(p_nav_in, v_transfer.nav_in),
            0,
            'completed',
            p_transfer_id
        );
    end if;

    return v_transfer;
end;
$$;

revoke all on function public.complete_transfer(uuid, numeric, numeric, date, numeric, numeric) from public, anon;
grant execute on function public.complete_transfer(uuid, numeric, numeric, date, numeric, numeric) to authenticated;
grant execute on function public.complete_transfer(uuid, numeric, numeric, date, numeric, numeric) to service_role;

-- Seed the fund master with the ISINs already used in the prototype so the
-- first real-data migration can be performed without creating placeholder rows.
insert into public.funds (isin, name, manager, currency, theme)
values
    ('LU2145463613', 'Robeco Smart Materials D EUR', 'Robeco', 'EUR', 'Materiales'),
    ('LU0270816068', 'Fondo de Taiwán', null, 'EUR', 'Semiconductores'),
    ('LU2466448532', 'Echiquier Space B', 'La Financière de l’Échiquier', 'EUR', 'Espacio'),
    ('IE00B3VXGD32', 'Fondo de biotecnología', null, 'EUR', 'Biotecnología'),
    ('IE00B3CCJB88', 'Nasdaq 100', null, 'EUR', 'Tecnología')
on conflict (isin) do nothing;

commit;
