-- The details button stays off until request_details_enabled is turned on.
-- A test subscriber can still use the token link. sending_enabled is not changed.
-- Rollback: supabase/migrations/rollback_20261113280000_business_alert_request_details.sql

begin;

alter table public.business_alert_match_settings
  add column if not exists request_details_enabled boolean not null default false,
  add column if not exists request_details_allowlist uuid[] not null default '{}';

comment on column public.business_alert_match_settings.request_details_enabled is
  'When false, the details link is logged and does not email a file. is_test subscribers are still allowed.';

create table if not exists public.business_alert_detail_requests (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.business_alert_subscribers (id),
  business_number text not null,
  file_id uuid,
  outcome text not null,
  created_at timestamptz not null default now(),
  constraint business_alert_detail_requests_outcome_check
    check (outcome in ('sent_file', 'file_failed', 'gentle', 'disabled'))
);

create index if not exists business_alert_detail_requests_recent_idx
  on public.business_alert_detail_requests (subscriber_id, business_number, created_at desc);

alter table public.business_alert_detail_requests enable row level security;
revoke all on public.business_alert_detail_requests from public, anon, authenticated;
grant select, insert on public.business_alert_detail_requests to service_role;

commit;
