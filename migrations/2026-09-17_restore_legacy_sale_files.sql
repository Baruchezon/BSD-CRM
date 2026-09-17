-- Restore the latest legacy business document of each type into the sale file index.
-- The underlying storage objects are not copied or modified.

with classified as (
  select
    fm.*,
    case
      when coalesce(fm.category, '') ilike '%אנונימ%'
        or coalesce(fm.display_name, fm.original_filename, '') ilike '%אנונימ%'
        then 'anonymous_summary'
      when coalesce(fm.display_name, fm.original_filename, '') ilike '%חקר%שוק%'
        then 'market_research'
      when coalesce(fm.category, '') ilike '%תקציר%'
        or coalesce(fm.display_name, fm.original_filename, '') ilike '%תקציר%'
        then 'full_summary'
      when coalesce(fm.display_name, fm.original_filename, '') ilike '%ניתוח%'
        or coalesce(fm.display_name, fm.original_filename, '') ilike '%שווי%'
        then 'economic_analysis'
      else null
    end as inferred_type
  from public.business_file_meta fm
), ranked as (
  select
    classified.*,
    row_number() over (
      partition by business_id, inferred_type
      order by created_at desc, id desc
    ) as version_rank
  from classified
  where inferred_type is not null
), eligible as (
  select ranked.*
  from ranked
  where version_rank = 1
    and exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'business-files'
        and object.name = ranked.storage_path
    )
    and not exists (
      select 1
      from public.business_sale_files sale_file
      where sale_file.business_id = ranked.business_id
        and sale_file.status = 'active'
        and (
          (ranked.inferred_type = 'anonymous_summary'
            and (sale_file.document_type = 'anonymous_summary' or sale_file.category = 'anon_presentation'))
          or (ranked.inferred_type = 'full_summary'
            and sale_file.category = 'exec_summary'
            and coalesce(sale_file.document_type, '') <> 'anonymous_summary')
          or (ranked.inferred_type = 'market_research'
            and sale_file.document_type = 'market_research')
          or (ranked.inferred_type = 'economic_analysis'
            and sale_file.category in ('economic_analysis', 'valuation'))
        )
    )
)
insert into public.business_sale_files (
  business_id,
  category,
  file_name,
  storage_path,
  file_type,
  file_size,
  confidentiality_level,
  uploaded_by,
  status,
  created_at,
  updated_at,
  source,
  document_type,
  version_number
)
select
  business_id,
  case
    when inferred_type in ('anonymous_summary', 'full_summary') then 'exec_summary'
    when inferred_type = 'market_research' then 'other'
    else 'economic_analysis'
  end,
  coalesce(display_name, original_filename, 'מסמך משוחזר'),
  storage_path,
  file_type,
  file_size,
  case when inferred_type = 'anonymous_summary' then 1 else 2 end,
  uploaded_by,
  'active',
  created_at,
  now(),
  'auto_generated',
  case
    when inferred_type = 'anonymous_summary' then 'anonymous_summary'
    when inferred_type = 'full_summary' then 'internal_full_summary'
    when inferred_type = 'market_research' then 'market_research'
    else null
  end,
  1
from eligible;
