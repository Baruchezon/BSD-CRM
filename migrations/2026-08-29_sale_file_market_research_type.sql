-- Adds 'market_research' as an allowed document_type on business_sale_files,
-- so files generated as "חקר שוק" by the BSD Sale File Builder can be
-- distinguished from generic uploads (category='other') instead of being
-- indistinguishable from them - this is the root gap that made market
-- research land under "קבצים נוספים" instead of its own tile. Purely
-- additive: widens the existing CHECK constraint, touches no existing rows,
-- adds no new column.
alter table public.business_sale_files
  drop constraint business_sale_files_document_type_check;

alter table public.business_sale_files
  add constraint business_sale_files_document_type_check
  check (document_type is null or document_type = any (array[
    'short_summary'::text, 'internal_full_summary'::text,
    'anonymous_summary'::text, 'activity_report'::text, 'client_report'::text,
    'market_research'::text
  ]));
