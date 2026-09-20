begin;

-- MI CARTERA v0.4.1
-- Integridad de operaciones: importe, participaciones y precio/VL deben ser
-- coherentes con tolerancia del 0,1 %. Las operaciones legacy incoherentes
-- pasan a pendiente para evitar rentabilidades personales falsas.

insert into public.app_meta (key, value)
values ('app_version', '0.4.1')
on conflict (key)
do update set value = excluded.value, updated_at = now();

insert into public.app_meta (key, value)
values ('schema_version', '7')
on conflict (key)
do update set value = excluded.value, updated_at = now();

alter table public.operations
  add column if not exists input_consistency_pct numeric,
  add column if not exists execution_confirmed boolean not null default false;

update public.operations
set input_consistency_pct = case
  when amount is not null and amount > 0
   and shares_delta is not null and abs(shares_delta) > 0
   and nav is not null and nav > 0
  then abs(amount / (abs(shares_delta) * nav) - 1) * 100
  else null
end
where transfer_id is null;

-- No borramos ni corregimos importes por nuestra cuenta. Si una operacion
-- completada no cuadra internamente, se deja pendiente para que el usuario
-- decida cual de los tres datos debe corregirse.
update public.operations
set status = 'pending',
    validation_status = 'triplet_mismatch',
    execution_date = null,
    updated_at = now()
where transfer_id is null
  and status = 'completed'
  and operation_type in ('initial','buy','contribution','sale','redemption')
  and input_consistency_pct is not null
  and input_consistency_pct >= 0.1;

commit;
