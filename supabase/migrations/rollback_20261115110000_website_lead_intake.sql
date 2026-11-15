-- Rollback for 20261115110000_website_lead_intake.sql. Redeploy website-lead stage 1 first.
-- Keeps data: export website_lead_submissions before dropping it if it has rows.
drop function if exists public.website_lead_find_by_phone9(text, boolean);
drop table if exists public.website_lead_submissions;
drop index if exists public.leads_business_id_idx;
alter table public.leads drop constraint if exists leads_website_inquiry_kind_chk;
alter table public.leads
  drop column if exists business_id,
  drop column if exists source_page,
  drop column if exists source_src,
  drop column if exists website_inquiry_kind;
