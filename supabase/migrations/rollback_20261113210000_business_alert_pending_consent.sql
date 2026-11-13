-- Rollback for 20261113210000_business_alert_pending_consent.sql.
-- Restores the status checks from 20261113120000. Pending rows are marked
-- unsubscribed_all so they stay out of mailings. Subscribers are not deleted.

begin;

update public.business_alert_subscribers
set status = 'unsubscribed_all',
    unsubscribed_at = coalesce(unsubscribed_at, now()),
    email_unsubscribed_at = coalesce(email_unsubscribed_at, now()),
    whatsapp_unsubscribed_at = coalesce(whatsapp_unsubscribed_at, now()),
    unsubscribed_by = coalesce(unsubscribed_by, 'manager')
where status = 'pending_consent';

drop function if exists public.business_alert_add_manual(text, text, text, text, boolean, boolean, text, text, text, text, text[], text[], numeric, numeric, boolean, text);

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_email_method_check,
  drop constraint if exists business_alert_subscribers_whatsapp_method_check;

alter table public.business_alert_subscribers
  drop column if exists consent_email_method,
  drop column if exists consent_whatsapp_method,
  drop column if exists consent_email_note,
  drop column if exists consent_whatsapp_note;

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_status_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_status_check
  check (status = any (array['active','unsubscribed','unsubscribed_email','unsubscribed_whatsapp','unsubscribed_all']));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_unsubscribed_at_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_unsubscribed_at_check
  check (
    (status = 'active' and unsubscribed_at is null and email_unsubscribed_at is null and whatsapp_unsubscribed_at is null)
    or (status = 'unsubscribed_email' and unsubscribed_at is not null and email_unsubscribed_at is not null and whatsapp_unsubscribed_at is null)
    or (status = 'unsubscribed_whatsapp' and unsubscribed_at is not null and whatsapp_unsubscribed_at is not null and email_unsubscribed_at is null)
    or (status in ('unsubscribed', 'unsubscribed_all') and unsubscribed_at is not null and email_unsubscribed_at is not null and whatsapp_unsubscribed_at is not null)
  );

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_unsubscribed_by_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_unsubscribed_by_check
  check (
    (status = 'active' and unsubscribed_by is null)
    or (status <> 'active' and unsubscribed_by = any (array['self_link','manager','admin','whatsapp_stop']))
  );

commit;
