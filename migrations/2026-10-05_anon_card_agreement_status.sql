-- Restore businesses.agreement_status on the anonymous card view.
--
-- 2026-08-19 added agreement_status (status text only, not the PDF) so a
-- licensed agent could see whether an anonymous business has a signed
-- agreement. Later view rebuilds (2026-08-22 column-leak fix, 2026-08-25
-- numbering, 2026-08-25g archived filter) recreated the view without that
-- column. Anonymous viewers cannot read businesses directly: RLS
-- businesses_select requires has_full_business_access. The view is the
-- only channel, and it still returns no owner name, phone, email, or PDF.
--
-- Signed = agreement_status «יש הסכם חתום». The client maps every other
-- value, including «נשלח הסכם לחתימה», to «אין הסכם».
-- The new column is appended so CREATE OR REPLACE keeps the existing order.

CREATE OR REPLACE VIEW public.businesses_anonymous_card AS
SELECT id,
    COALESCE(anon_display_name, field) AS anon_display_name,
    field,
    category,
    subcategory,
    city,
    years_active,
    annual_revenue,
    operating_profit,
    net_profit,
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
WHERE anon_summary IS NOT NULL
  AND NOT is_archived
  AND get_business_access_level(id, auth.uid()) = 'anonymous'::text;

GRANT SELECT ON public.businesses_anonymous_card TO authenticated;
