-- Rolls back 20261113220000_business_alert_address_form.sql.
-- Drops the optional address preference. Subscriber rows stay.

begin;

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_address_form_check;

alter table public.business_alert_subscribers
  drop column if exists address_form;

commit;
