-- One email per action, and short BSD links (Baruch, 13.11.2026 12:43).
-- 1. Signup: welcome_sent_at / welcome_back_sent_at are claimed atomically before a
--    thank-you is sent. One thank-you per subscriber ever; one "welcome back" per return
--    after an unsubscribe.
-- 2. Business alerts: business_alert_sends already has UNIQUE (subscriber_id, business_number).
--    Rows are now reserved BEFORE the email goes out (status reserved -> sent / failed),
--    so a double click cannot send twice. VIP sends get the same status column.
-- 3. Anonymous-summary requests: at most one email per subscriber + business per Israel day.
-- 4. Short links: www.bsd-bbi.co.il/s/<code>, resolved by business-alert-go.
--    short_links_live stays false until the site route is live.
-- Additive only. Rollback: supabase/migrations/rollback_20261113320000_business_alert_dedupe_links.sql

begin;

-- 1. signup welcome guards
alter table public.business_alert_subscribers
  add column if not exists welcome_sent_at timestamptz,
  add column if not exists welcome_back_sent_at timestamptz;

update public.business_alert_subscribers
   set welcome_sent_at = coalesce(welcome_sent_at, created_at)
 where welcome_sent_at is null;

update public.business_alert_subscribers
   set welcome_back_sent_at = resubscribed_at
 where welcome_back_sent_at is null and resubscribed_at is not null;

comment on column public.business_alert_subscribers.welcome_sent_at is
  'When the one and only signup thank-you was sent (claimed before sending).';
comment on column public.business_alert_subscribers.welcome_back_sent_at is
  'When the last welcome-back email was sent after an unsubscribe (claimed before sending).';

-- 2. business alert sends: reserve before sending
alter table public.business_alert_sends
  add column if not exists status text not null default 'sent';
alter table public.business_alert_sends
  drop constraint if exists business_alert_sends_status_check;
alter table public.business_alert_sends
  add constraint business_alert_sends_status_check check (status in ('reserved', 'sent', 'failed'));
grant update (status, resend_id, sent_at, created_by, match_pct) on public.business_alert_sends to service_role;

alter table public.business_alert_vip_sends
  add column if not exists status text not null default 'sent';
alter table public.business_alert_vip_sends
  drop constraint if exists business_alert_vip_sends_status_check;
alter table public.business_alert_vip_sends
  add constraint business_alert_vip_sends_status_check check (status in ('reserved', 'sent', 'failed'));

-- 3. anonymous-summary requests: one email per subscriber + business per Israel day
alter table public.business_alert_detail_requests
  add column if not exists request_day date not null default ((now() at time zone 'Asia/Jerusalem')::date);
update public.business_alert_detail_requests
   set request_day = (created_at at time zone 'Asia/Jerusalem')::date;
alter table public.business_alert_detail_requests
  drop constraint if exists business_alert_detail_requests_outcome_check;
alter table public.business_alert_detail_requests
  add constraint business_alert_detail_requests_outcome_check
  check (outcome in ('pending', 'sent_file', 'file_failed', 'gentle', 'disabled'));
create unique index if not exists business_alert_detail_requests_one_per_day
  on public.business_alert_detail_requests (subscriber_id, business_number, request_day)
  where outcome in ('pending', 'sent_file', 'gentle');

-- 4. short links
create table if not exists public.business_alert_short_links (
  code text primary key,
  kind text not null,
  subscriber_id uuid not null references public.business_alert_subscribers (id),
  business_number text not null default '',
  channel text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count integer not null default 0,
  constraint business_alert_short_links_code_check check (code ~ '^[A-Za-z0-9]{6,10}$'),
  constraint business_alert_short_links_kind_check check (kind in ('details', 'unsubscribe', 'page')),
  constraint business_alert_short_links_target_key unique (kind, subscriber_id, business_number, channel)
);
alter table public.business_alert_short_links enable row level security;
revoke all on public.business_alert_short_links from public, anon, authenticated;
grant select, insert, update on public.business_alert_short_links to service_role;

alter table public.business_alert_match_settings
  add column if not exists short_links_live boolean not null default false;
comment on column public.business_alert_match_settings.short_links_live is
  'true once www.bsd-bbi.co.il/s/<code> is routed to business-alert-go. Until then emails use the working long BSD links behind the buttons.';

commit;
