-- The website header «לקוחות VIP» sends signup_channel vip (src=vip).
-- Rollback: supabase/migrations/rollback_20261113240000_business_alert_vip_channel.sql

begin;

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_signup_channel_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_signup_channel_check
  check (signup_channel in ('website', 'our_link', 'vip'));

comment on column public.business_alert_subscribers.signup_channel is
  'website = נרשם דרך האתר. our_link = יזום שלנו. vip = לקוחות VIP. Anything else is stored as website.';

commit;
