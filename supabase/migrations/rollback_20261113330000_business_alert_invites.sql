begin;

alter table public.business_alert_signup_attempts
  drop constraint if exists business_alert_signup_attempts_kind_check;
alter table public.business_alert_signup_attempts
  add constraint business_alert_signup_attempts_kind_check
  check (kind = any (array['signup', 'unsubscribe', 'visit', 'send', 'update']));

drop table if exists public.business_alert_invites;

alter table public.business_alert_match_settings
  drop column if exists invite_short_links,
  drop column if exists invite_email_template,
  drop column if exists invite_whatsapp_template;

alter table public.business_alert_subscribers
  drop column if exists buyer_id,
  drop column if exists lead_id;

commit;
