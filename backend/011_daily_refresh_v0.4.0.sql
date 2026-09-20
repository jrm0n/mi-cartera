-- MI CARTERA v0.4.0
-- Programa una actualización diaria de precios/históricos a las 06:30 UTC.
-- Ejecutar DESPUÉS de desplegar la Edge Function refresh-market-data con
-- "Verify JWT with legacy secret" desactivado.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'mi-cartera-daily-market-refresh' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'mi-cartera-daily-market-refresh',
  '30 6 * * *',
  $job$
  select net.http_post(
    url := 'https://ailvraoibudmusdalfsm.supabase.co/functions/v1/refresh-market-data',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $job$
);
