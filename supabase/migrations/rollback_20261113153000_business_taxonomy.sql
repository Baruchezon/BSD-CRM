-- Rollback for 20261113153000_business_taxonomy.sql.

begin;

drop function if exists public.business_taxonomy_classify(text, text, text, text);
alter table public.businesses drop column if exists taxonomy;
alter table public.business_alert_subscribers
  drop column if exists categories,
  drop column if exists subcategories,
  drop column if exists regions;

commit;
