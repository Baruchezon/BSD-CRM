-- Rolls back the disabled VIP-send switch. No messages are stored here.

begin;

drop table if exists public.business_alert_vip_sends;
drop function if exists public.business_alert_vip_recipients();

alter table public.business_alert_match_settings
  drop column if exists vip_send_allowlist,
  drop column if exists vip_send_enabled;

commit;
