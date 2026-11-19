-- BSD buyer opportunity digest, idempotent disaster recovery migration.
-- The dispatcher uses a private per-project bearer token and does not expose it in cron logs.
create table if not exists public.bsd_alert_dispatch_auth (
  id boolean primary key default true check (id),
  token text not null,
  created_at timestamptz not null default now()
);
alter table public.bsd_alert_dispatch_auth add column if not exists enabled boolean not null default false;
alter table public.bsd_alert_dispatch_auth enable row level security;
revoke all on public.bsd_alert_dispatch_auth from public, anon, authenticated;
grant select on public.bsd_alert_dispatch_auth to service_role;
insert into public.bsd_alert_dispatch_auth(id, token)
values (true, encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;
-- The sending flag is turned on deliberately after dry runs, never by a migration.
select cron.schedule(
  'bsd-buyer-alert-hourly',
  '7 * * * *',
  $job$
  select net.http_post(
    url := 'https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/bsd-alert-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bsd-dispatch-token',
      (select token from public.bsd_alert_dispatch_auth where id = true)
    ),
    body := '{"send":true}'::jsonb,
    timeout_milliseconds := 90000
  );
  $job$
);
