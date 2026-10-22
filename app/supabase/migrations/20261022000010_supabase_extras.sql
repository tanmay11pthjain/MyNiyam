-- Supabase only: the private photo bucket and the daily cleanup job. Each part runs only where it can,
-- so the local Docker database (no storage schema, no pg_cron) simply skips it.

-- Photo storage: one PRIVATE bucket for logos and profile photos. Children's photos must never be
-- public; the app reads them with the service-role key and serves them only to the right people.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'no Supabase storage here: skipped the photo bucket';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('myniyam', 'myniyam', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
end $$;

-- Daily cleanup at 3:00 am India time (21:30 UTC): old OTP codes and counters, removed families and
-- people after 30 days, old admin sessions, and activity older than a year (see private.sweep()).
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here: skipped the daily cleanup job';
    return;
  end if;
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'myniyam-sweep') then
    perform cron.unschedule('myniyam-sweep');
  end if;
  perform cron.schedule('myniyam-sweep', '30 21 * * *', 'select private.sweep()');
exception when others then
  -- pg_cron can only be created in the database named in cron.database_name; never block the update.
  raise notice 'could not set up the daily cleanup job: %', sqlerrm;
end $$;
