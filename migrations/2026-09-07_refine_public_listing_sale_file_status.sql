create or replace view public.public_business_listings as
select
  b.id,
  b.field,
  b.category,
  b.subcategory,
  b.region,
  b.years_active,
  b.annual_revenue,
  b.employees_count,
  b.anon_display_name,
  b.anon_summary as short_description,
  case when b.anon_card_show_price then b.asking_price else null::numeric end as asking_price,
  b.created_at,
  b.business_number,
  b.public_listing_published_at as published_at,
  exists (
    select 1 from public.business_sale_files sf
    where sf.business_id = b.id
      and sf.status = 'active'
      and sf.category <> 'business_photo'
  ) as has_sale_file,
  (
    nullif(trim(coalesce(b.internal_business_summary, '')), '') is not null
    or exists (
      select 1 from public.business_sale_files sf
      where sf.business_id = b.id
        and sf.status = 'active'
        and sf.category = 'exec_summary'
        and coalesce(sf.document_type, '') <> 'anonymous_summary'
    )
  ) as has_full_summary,
  (
    nullif(trim(coalesce(b.anon_summary, '')), '') is not null
    or exists (
      select 1 from public.business_sale_files sf
      where sf.business_id = b.id
        and sf.status = 'active'
        and (
          sf.category = 'anon_presentation'
          or (sf.category = 'exec_summary' and sf.document_type = 'anonymous_summary')
        )
    )
  ) as has_anonymous_summary,
  exists (
    select 1 from public.business_sale_files sf
    where sf.business_id = b.id
      and sf.status = 'active'
      and (
        sf.category = 'economic_analysis'
        or sf.document_type = 'economic_analysis'
        or sf.file_name ilike '%ניתוח כלכלי%'
        or sf.file_name ilike '%economic analysis%'
      )
  ) as has_economic_analysis,
  exists (
    select 1 from public.business_sale_files sf
    where sf.business_id = b.id
      and sf.status = 'active'
      and (
        sf.category = 'valuation'
        or sf.document_type = 'valuation'
        or sf.file_name ilike '%הערכת שווי%'
        or sf.file_name ilike '%valuation%'
      )
  ) as has_valuation
from public.businesses b
where b.public_listing_active = true
  and b.anon_card_active = true
  and b.listing_status = 'active'::text
  and not b.is_archived;
