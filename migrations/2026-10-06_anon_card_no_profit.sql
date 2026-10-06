-- 06.10.2026: ALREADY APPLIED LIVE at ~15:35 (Israel time) by the admin agent; this file records it in the repo.
-- Rollback: /workspace/agent-leak-fix/rollback_selfcontained.sql (re-adds operating_profit, net_profit in the original column order).
-- agent-leak-fix: licensed agents' anonymous-card data source no longer sends profit.
-- Approved by Baruch 06.10.2026 15:22 (city stays). Same filter, same grants, same owner.
BEGIN;
DROP VIEW public.businesses_anonymous_card;
CREATE VIEW public.businesses_anonymous_card AS
 SELECT id,
    COALESCE(anon_display_name, field) AS anon_display_name,
    field,
    category,
    subcategory,
    city,
    years_active,
    annual_revenue,
    employees_count,
    anon_summary,
        CASE
            WHEN anon_card_show_price THEN asking_price
            ELSE NULL::numeric
        END AS asking_price,
    handled_by,
    anon_card_active,
    distribution_status,
    anon_summary_generated_at,
    created_at,
    updated_at,
    business_number,
    agreement_status
   FROM businesses b
  WHERE anon_summary IS NOT NULL AND NOT is_archived AND get_business_access_level(id, auth.uid()) = 'anonymous'::text;
ALTER VIEW public.businesses_anonymous_card OWNER TO postgres;
GRANT ALL ON public.businesses_anonymous_card TO anon, authenticated, service_role;
COMMIT;
