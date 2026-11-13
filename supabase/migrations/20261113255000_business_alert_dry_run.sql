-- Alert delivery stays off. dry_run defaults to true and only logs candidates.
-- sending_enabled stays false. Both must be changed before a real alert email.
-- Does not change signup confirmation mail.
-- Rollback: supabase/migrations/rollback_20261113255000_business_alert_dry_run.sql

begin;

alter table public.business_alert_match_settings
  add column if not exists dry_run boolean not null default true;

comment on column public.business_alert_match_settings.dry_run is
  'When true, an alert that would have been sent is written to business_alert_dry_run_log and not delivered.';

create table if not exists public.business_alert_dry_run_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  subscriber_id uuid,
  business_id uuid,
  channel text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.business_alert_dry_run_log enable row level security;
revoke all on public.business_alert_dry_run_log from public, anon, authenticated;
grant select, insert on public.business_alert_dry_run_log to service_role;

commit;
