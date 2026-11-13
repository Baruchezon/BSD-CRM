begin;

alter table public.business_alert_sends
  drop column if exists resend_id;

alter table public.business_alert_match_settings
  drop column if exists alert_send_allowlist;

commit;
