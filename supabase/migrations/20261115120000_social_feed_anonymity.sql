-- 15.11.2026 lead audit stage 5 (Baruch approved 08:28 via Roman).
-- businesses_social_feed is readable with the public key. It exposed 3 active but NOT published
-- businesses and the exact city. No code in the CRM/site/functions reads it (only an audit curl
-- in the logs), so: only published listings (same filter as public_business_listings) and the
-- «city» column now carries the region. Column names/order kept; «region» appended.
-- Rollback: rollback_20261115120000_social_feed_anonymity.sql (exact previous definition).
create or replace view public.businesses_social_feed as
 select id,
    anon_display_name,
    anon_summary,
    field,
    category,
    subcategory,
    region as city,
    case when anon_card_show_price then asking_price else null::numeric end as asking_price,
    business_number,
    region
   from public.businesses
  where anon_card_active = true and anon_summary is not null and anon_display_name is not null
    and not is_archived and crm_stage is null
    and public_listing_active = true and listing_status = 'active';
comment on view public.businesses_social_feed is
  'Public (anon) feed for social posts: published listings only; city column = region (anonymity). 15.11.2026.';
