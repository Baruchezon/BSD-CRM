-- Rolls back the dry-run log. Match rows and the sending_enabled flag stay.

begin;

drop table if exists public.business_alert_dry_run_log;

alter table public.business_alert_match_settings
  drop column if exists dry_run;

commit;
