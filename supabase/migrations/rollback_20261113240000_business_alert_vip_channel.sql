-- Rolls back 20261113240000. VIP rows are stored as website so the older check can return.
-- Subscriber rows stay.

begin;

update public.business_alert_subscribers
set signup_channel = 'website'
where signup_channel = 'vip';

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_signup_channel_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_signup_channel_check
  check (signup_channel in ('website', 'our_link'));

commit;
