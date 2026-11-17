-- Rollback for 20261117070000_nexus_seller_portfolio_fixes.sql: restores seller_portfolio() as live before 17.11.2026.
-- The column businesses.agreement_signed_date is kept (dates entered meanwhile are not deleted); to drop it only
-- after confirming it is empty: alter table public.businesses drop column agreement_signed_date;

begin;

CREATE OR REPLACE FUNCTION nexus_metrics.seller_portfolio()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
WITH portfolio AS (
 SELECT b.id, b.business_number, b.internal_name, b.created_at, b.id_number AS billing_tax_id,
        b.status AS crm_status, b.agreement_status, b.public_listing_active,
        coalesce(
          (SELECT sa.signed_at::date FROM public.signed_agreements sa
           WHERE sa.record_id IN (b.id,b.seller_id) ORDER BY sa.signed_at DESC LIMIT 1),
          CASE WHEN l.agreement_signed IS TRUE THEN l.agreement_signed_date END
        ) AS signed_date,
        coalesce(l.agreement_signed,FALSE) OR b.agreement_status='יש הסכם חתום' AS signed_flag,
        coalesce((SELECT count(*) FROM public.business_sale_files f WHERE f.business_id=b.id AND f.deleted_at IS NULL),0)::integer AS files_total,
        coalesce((SELECT count(*) FROM public.business_sale_files f WHERE f.business_id=b.id AND f.deleted_at IS NULL AND (f.document_type IN ('anonymous_summary','internal_full_summary') OR f.category='exec_summary')),0)::integer AS summaries,
        coalesce((SELECT count(*) FROM public.business_sale_files f WHERE f.business_id=b.id AND f.deleted_at IS NULL AND f.category='economic_analysis'),0)::integer AS economics,
        coalesce((SELECT count(*) FROM public.business_sale_files f WHERE f.business_id=b.id AND f.deleted_at IS NULL AND f.document_type='market_research'),0)::integer AS research,
        coalesce((SELECT count(*) FROM public.business_sale_files f WHERE f.business_id=b.id AND f.deleted_at IS NULL AND f.document_type='activity_report'),0)::integer AS activity_reports,
        coalesce((SELECT count(*) FROM public.business_sale_files f WHERE f.business_id=b.id AND f.deleted_at IS NULL AND f.portal_visible IS TRUE),0)::integer AS portal_files,
        coalesce((SELECT jsonb_agg(to_jsonb(z) ORDER BY z.created_at DESC) FROM (
             SELECT f.document_type,f.category,f.status,f.created_at,f.portal_visible
             FROM public.business_sale_files f WHERE f.business_id=b.id AND f.deleted_at IS NULL
             ORDER BY f.created_at DESC LIMIT 12
        ) z),'[]'::jsonb) AS latest_files,
        coalesce((SELECT count(*) FROM public.matches m WHERE m.business_id=b.id),0)::integer AS matches_total,
        coalesce((SELECT count(*) FROM public.anon_distributions ad WHERE ad.business_id=b.id
                  AND ad.delivery_status IN ('sent','delivered','read')),0)::integer AS buyer_distributions,
        coalesce((SELECT jsonb_agg(jsonb_build_object('channel',d.channel,'status',d.status,'enabled_at',d.enabled_at))
                  FROM public.business_distribution_channels d WHERE d.business_id=b.id AND d.enabled IS TRUE),'[]'::jsonb) AS channels,
        coalesce((SELECT count(DISTINCT p.group_name) FROM public.business_facebook_posts p
                  WHERE (p.business_id=b.id OR p.business_number=b.business_number)
                  AND p.status='active' AND nullif(p.group_name,'') IS NOT NULL),0)::integer AS facebook_active_groups,
        coalesce((SELECT count(*) FROM public.business_facebook_posts p
                  WHERE (p.business_id=b.id OR p.business_number=b.business_number)
                  AND p.status ILIKE 'pending%'),0)::integer AS facebook_pending_posts,
        coalesce((SELECT count(*) FROM public.business_facebook_posts p
                  WHERE p.business_id=b.id OR p.business_number=b.business_number),0)::integer AS facebook_logged_posts,
        (SELECT sum(x.members)::bigint FROM (
           SELECT p.group_name,max(p.member_count) AS members
           FROM public.business_facebook_posts p
           WHERE (p.business_id=b.id OR p.business_number=b.business_number)
             AND p.status='active' AND p.member_count IS NOT NULL
           GROUP BY p.group_name
        ) x) AS facebook_group_members_potential,
        (SELECT sum(p.impressions)::bigint FROM public.business_facebook_posts p
         WHERE (p.business_id=b.id OR p.business_number=b.business_number) AND p.impressions IS NOT NULL
           AND p.status='active') AS facebook_measured_impressions,
        coalesce((SELECT count(*) FROM public.site_analytics_events e
                  WHERE e.business_id=b.id AND e.event_name='page_view'),0)::integer AS site_direct_views_all_time,
        coalesce((SELECT count(DISTINCT e.visitor_id) FROM public.site_analytics_events e
                  WHERE e.business_id=b.id AND e.event_name='page_view'),0)::integer AS site_direct_visitors_all_time,
        (SELECT jsonb_build_object(
          'from',s.window_start,'to',s.window_end,
          'business_views',s.business_views,'business_visitors',s.business_visitors,
          'for_sale_views',s.for_sale_views,'for_sale_visitors',s.for_sale_visitors,
          'computed_at',s.computed_at)
         FROM public.seller_portal_weekly_stats s
         WHERE s.business_id=b.id ORDER BY s.window_end DESC LIMIT 1) AS weekly_site_stats
 FROM public.businesses b
 LEFT JOIN public.leads l ON l.id=b.seller_id
 WHERE b.is_archived IS DISTINCT FROM TRUE AND
  (coalesce(l.agreement_signed,FALSE) OR b.agreement_status='יש הסכם חתום')
)
SELECT jsonb_build_object('ok',TRUE,'count',count(*),'businesses',
 coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'business_number',business_number,'name',internal_name,
    'signed_date',signed_date,'signed_flag',signed_flag,
    'crm_status',crm_status,'public_listing_active',public_listing_active,
    'billing_tax_id',nullif(regexp_replace(coalesce(billing_tax_id,''),'[^0-9]','','g'),''),
    'files_total',files_total,'summaries',summaries,'economics',economics,'research',research,
    'activity_reports',activity_reports,'portal_files',portal_files,'latest_files',latest_files,
    'matches_total',matches_total,'buyer_distributions',buyer_distributions,'channels',channels,
    'facebook_active_groups',facebook_active_groups,'facebook_pending_posts',facebook_pending_posts,
    'facebook_logged_posts',facebook_logged_posts,
    'facebook_group_members_potential',facebook_group_members_potential,
    'facebook_measured_impressions',facebook_measured_impressions,
    'site_direct_views_all_time',site_direct_views_all_time,
    'site_direct_visitors_all_time',site_direct_visitors_all_time,
    'weekly_site_stats',weekly_site_stats
 ) ORDER BY signed_date DESC NULLS LAST, created_at DESC),'[]'::jsonb))
FROM portfolio;
$function$
;

commit;
