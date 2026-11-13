-- Optional form of address from the website signup (male or female).
-- Null when the person skipped the question. Not consent.
-- Rollback: supabase/migrations/rollback_20261113220000_business_alert_address_form.sql

begin;

alter table public.business_alert_subscribers
  add column if not exists address_form text;

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_address_form_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_address_form_check
  check (address_form is null or address_form in ('male', 'female'));

comment on column public.business_alert_subscribers.address_form is
  'Website preference only: male = אליך כגבר, female = אליך כאישה. Null when skipped.';

commit;
