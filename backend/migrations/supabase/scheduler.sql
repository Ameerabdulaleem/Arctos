-- Supabase only (pg_cron and pg_net). Apply it after 0001_arctos_schema.sql,
-- from the Supabase SQL editor. It is safe to run again.
--
-- The database calls the trade keeper on the live site every minute while any
-- snipe is open, and once an hour otherwise. The hourly call also counts as
-- activity, which keeps a free project from being paused for inactivity.
-- To point it at another address, change `site` below and run this file again.

create extension if not exists pg_cron;
-- pg_net goes in the "extensions" schema, not "public" (Supabase's security check asks for this).
create extension if not exists pg_net with schema extensions;

create or replace function arctos.call_keeper()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
    site   text := 'https://arctos-fi.vercel.app';
    secret text;
begin
    if not exists (select 1 from arctos.keeper_positions where open)
       and extract(minute from now()) <> 0 then
        return null;
    end if;
    -- Optional. When CRON_SECRET is set on the site, store the same value in
    -- Supabase Vault under the name "arctos_cron_secret" and it is sent along.
    select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'arctos_cron_secret';
    return net.http_post(
        url                  := site || '/api/sniper/keeper/tick',
        headers              := jsonb_strip_nulls(jsonb_build_object(
                                    'Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || secret)),
        body                 := '{}'::jsonb,
        timeout_milliseconds := 55000
    );
end;
$$;

revoke all on function arctos.call_keeper() from public;

-- Scheduling under an existing name replaces that job.
select cron.schedule('arctos-keeper', '* * * * *', 'select arctos.call_keeper()');

-- The scheduler logs every run. Keep a week of it.
select cron.schedule(
    'arctos-tidy-cron-log',
    '17 3 * * *',
    $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
