begin;

-- MI CARTERA v0.3.3
-- Gestion segura de operaciones existentes y soporte de tipo de instrumento.

insert into public.app_meta (key, value)
values ('app_version', '0.3.3')
on conflict (key)
do update set value = excluded.value, updated_at = now();

insert into public.app_meta (key, value)
values ('schema_version', '3')
on conflict (key)
do update set value = excluded.value, updated_at = now();

alter table public.funds
  add column if not exists instrument_type text;

create or replace function public.delete_operation_v1(p_operation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.operations
    where id = p_operation_id
      and user_id = auth.uid()
      and transfer_id is null
  ) then
    raise exception 'Operation not found or belongs to a transfer';
  end if;

  delete from public.operations
  where id = p_operation_id
    and user_id = auth.uid()
    and transfer_id is null;

  return found;
end;
$$;

revoke all on function public.delete_operation_v1(uuid) from public, anon;
grant execute on function public.delete_operation_v1(uuid) to authenticated;
grant execute on function public.delete_operation_v1(uuid) to service_role;

create or replace function public.delete_transfer_v1(p_transfer_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.transfers
    where id = p_transfer_id
      and user_id = auth.uid()
  ) then
    raise exception 'Transfer not found';
  end if;

  delete from public.operations
  where transfer_id = p_transfer_id
    and user_id = auth.uid();

  delete from public.transfers
  where id = p_transfer_id
    and user_id = auth.uid();

  return found;
end;
$$;

revoke all on function public.delete_transfer_v1(uuid) from public, anon;
grant execute on function public.delete_transfer_v1(uuid) to authenticated;
grant execute on function public.delete_transfer_v1(uuid) to service_role;

commit;
