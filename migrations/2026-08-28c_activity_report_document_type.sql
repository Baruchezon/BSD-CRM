-- Stage 4 of the matches-module upgrade: allow the new "activity_report"
-- document type on business_sale_files, needed for the per-business PDF
-- activity report (section ו of the spec). Purely additive - widens an
-- existing CHECK constraint, touches no rows, no other document_type
-- values are affected.

alter table public.business_sale_files
  drop constraint business_sale_files_document_type_check;

alter table public.business_sale_files
  add constraint business_sale_files_document_type_check
  check (document_type is null or document_type = any (array[
    'short_summary'::text, 'internal_full_summary'::text,
    'anonymous_summary'::text, 'activity_report'::text
  ]));
