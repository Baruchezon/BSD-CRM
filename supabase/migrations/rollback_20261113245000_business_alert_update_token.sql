begin;

update public.business_alert_subscribers
set consent_method = 'form'
where consent_method = 'self_update';

update public.business_alert_subscribers
set consent_email_method = 'form'
where consent_email_method = 'self_update';

update public.business_alert_subscribers
set consent_whatsapp_method = 'form'
where consent_whatsapp_method = 'self_update';

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_consent_method_check;
alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_consent_method_check
  check (consent_method is null or consent_method in ('form', 'verbal_call', 'whatsapp_reply', 'written'));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_email_method_check;
alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_email_method_check
  check (consent_email_method is null or consent_email_method in ('verbal_call', 'whatsapp_reply', 'written', 'form'));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_whatsapp_method_check;
alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_whatsapp_method_check
  check (consent_whatsapp_method is null or consent_whatsapp_method in ('verbal_call', 'whatsapp_reply', 'written', 'form'));

alter table public.business_alert_signup_attempts
  drop constraint if exists business_alert_signup_attempts_kind_check;
alter table public.business_alert_signup_attempts
  add constraint business_alert_signup_attempts_kind_check
  check (kind = any (array['signup', 'unsubscribe', 'visit', 'send']));

alter table public.business_alert_signup_attempts
  drop column if exists subscriber_id;

drop table if exists public.business_alert_subscriber_history;
drop table if exists public.business_alert_update_nonces;

commit;
