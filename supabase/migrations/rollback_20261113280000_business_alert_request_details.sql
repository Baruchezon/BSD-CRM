begin;

drop table if exists public.business_alert_detail_requests;

alter table public.business_alert_match_settings
  drop column if exists request_details_allowlist,
  drop column if exists request_details_enabled;

commit;
