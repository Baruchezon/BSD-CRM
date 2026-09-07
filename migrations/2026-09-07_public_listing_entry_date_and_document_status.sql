alter table public.businesses
  add column if not exists public_listing_published_at timestamptz;

update public.businesses
set public_listing_published_at = created_at
where public_listing_active = true
  and public_listing_published_at is null;

create or replace function public.set_public_listing_published_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.public_listing_active is true
     and new.public_listing_published_at is null
     and (tg_op = 'INSERT' or old.public_listing_active is distinct from true) then
    new.public_listing_published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_public_listing_published_at on public.businesses;
create trigger trg_set_public_listing_published_at
before insert or update of public_listing_active on public.businesses
for each row
execute function public.set_public_listing_published_at();

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
  (
    nullif(trim(coalesce(b.anon_summary, '')), '') is not null
    or nullif(trim(coalesce(b.internal_business_summary, '')), '') is not null
    or exists (
      select 1 from public.business_sale_files sf
      where sf.business_id = b.id and sf.status = 'active'
    )
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
