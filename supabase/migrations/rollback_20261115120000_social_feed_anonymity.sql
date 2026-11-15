-- Rollback for 20261115120000_social_feed_anonymity.sql: the definition live before 15.11.2026.
-- (Postgres cannot drop the appended «region» column with CREATE OR REPLACE, so drop and recreate.)
begin;
drop view public.businesses_social_feed;
create view public.businesses_social_feed as
 SELECT id, anon_display_name, anon_summary, field, category, subcategory, city,
    CASE WHEN anon_card_show_price THEN asking_price ELSE NULL::numeric END AS asking_price,
    business_number
   FROM businesses
  WHERE anon_card_active = true AND anon_summary IS NOT NULL AND anon_display_name IS NOT NULL AND NOT is_archived AND crm_stage IS NULL;
grant all on public.businesses_social_feed to anon, authenticated, service_role;
commit;
