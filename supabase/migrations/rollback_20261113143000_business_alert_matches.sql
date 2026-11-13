-- Rollback for 20261113143000_business_alert_matches.sql.
-- Drops stored matches and the scoring settings. Does not delete subscribers.

begin;

drop table if exists public.business_alert_matches;
drop table if exists public.business_alert_match_settings;
alter table public.business_alert_subscribers drop column if exists looking_for;

commit;
