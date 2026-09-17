-- Align existing anonymous documents with the VIP publication safety level.
-- Only rows already explicitly classified as anonymous are changed.

update public.business_sale_files
set document_type = 'anonymous_summary',
    confidentiality_level = 1
where status = 'active'
  and category = 'anon_presentation'
  and document_type is null;

update public.business_sale_files
set confidentiality_level = 1
where status = 'active'
  and document_type = 'anonymous_summary'
  and confidentiality_level <> 1;
