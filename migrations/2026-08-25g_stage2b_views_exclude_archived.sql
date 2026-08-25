BEGIN;

CREATE OR REPLACE VIEW businesses_anonymous_card AS
SELECT id, COALESCE(anon_display_name, field) AS anon_display_name,
    field, category, subcategory, city, years_active, annual_revenue, operating_profit,
    net_profit, employees_count, anon_summary,
    CASE WHEN anon_card_show_price THEN asking_price ELSE NULL::numeric END AS asking_price,
    handled_by, anon_card_active, distribution_status, anon_summary_generated_at, created_at, updated_at,
    business_number
FROM businesses b
WHERE anon_summary IS NOT NULL AND NOT is_archived AND get_business_access_level(id, auth.uid()) = 'anonymous'::text;

CREATE OR REPLACE VIEW businesses_social_feed AS
SELECT id, anon_display_name, anon_summary, field, category, subcategory, city,
    CASE WHEN anon_card_show_price THEN asking_price ELSE NULL::numeric END AS asking_price,
    business_number
FROM businesses
WHERE anon_card_active = true AND anon_summary IS NOT NULL AND anon_display_name IS NOT NULL AND NOT is_archived;

CREATE OR REPLACE VIEW public_business_listings AS
SELECT id, field, category, subcategory, region, years_active, annual_revenue,
    employees_count, anon_display_name, anon_summary AS short_description,
    CASE WHEN anon_card_show_price THEN asking_price ELSE NULL::numeric END AS asking_price,
    created_at,
    business_number
FROM businesses b
WHERE public_listing_active = true AND anon_card_active = true AND listing_status = 'active'::text AND NOT is_archived;

COMMIT;
