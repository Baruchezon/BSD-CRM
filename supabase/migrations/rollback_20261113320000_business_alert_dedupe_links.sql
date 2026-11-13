-- Rollback for 20261113320000_business_alert_dedupe_links.sql.
-- Redeploy the previous function versions first (see ROLLBACK.md step 16).
-- Drops only what that migration added. Short-link rows are lost with the table;
-- export them first if any were sent: copy (select * from business_alert_short_links) ...
begin;
alter table public.business_alert_match_settings drop column if exists short_links_live;
drop table if exists public.business_alert_short_links;
drop index if exists public.business_alert_detail_requests_one_per_day;
update public.business_alert_detail_requests set outcome = 'file_failed' where outcome = 'pending';
alter table public.business_alert_detail_requests drop constraint if exists business_alert_detail_requests_outcome_check;
alter table public.business_alert_detail_requests add constraint business_alert_detail_requests_outcome_check
  check (outcome in ('sent_file', 'file_failed', 'gentle', 'disabled'));
alter table public.business_alert_detail_requests drop column if exists request_day;
revoke update (status, resend_id, sent_at, created_by, match_pct) on public.business_alert_sends from service_role;
alter table public.business_alert_sends drop constraint if exists business_alert_sends_status_check;
alter table public.business_alert_sends drop column if exists status;
alter table public.business_alert_vip_sends drop constraint if exists business_alert_vip_sends_status_check;
alter table public.business_alert_vip_sends drop column if exists status;
alter table public.business_alert_subscribers drop column if exists welcome_back_sent_at;
alter table public.business_alert_subscribers drop column if exists welcome_sent_at;
commit;
