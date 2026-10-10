-- Rollback for 20261011090000_marketing_reports_additive.sql. Removes only what that migration added.
-- Report files and business_sale_files rows created by the publish action are NOT deleted (portal history is kept);
-- to hide them from owners without deleting: update public.business_sale_files set portal_visible=false
--   where portal_kind='advertising' and category='דוחות פעילות שיווקית';   (needs Baruch's approval, manager/service role)
begin;
drop table if exists public.marketing_report_runs;
drop trigger if exists trg_protect_marketing_publish_flag on public.profiles;
drop function if exists public.protect_marketing_publish_flag();
drop index if exists public.bsf_marketing_report_uniq;
alter table public.profiles drop column if exists can_publish_marketing_reports;
alter table public.businesses drop column if exists marketing_service_since, drop column if exists marketing_service_active;
commit;
