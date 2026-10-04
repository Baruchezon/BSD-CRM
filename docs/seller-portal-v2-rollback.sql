-- ROLLBACK for seller portal v2 (04.10.2026). Removes EXACTLY what
-- 20261004032704_seller_portal_v2_extra_files.sql adds. Existing CRM tables and
-- the v1 portal objects are untouched.
-- ORDER:
--  1. Frontend: git revert the v2 commit on main (CRM pages go back to v1 screens).
--  2. Function: redeploy seller-portal-api from function-v1/ (verify_jwt=false).
--     v1 code ignores the new table/column.
--  3. Storage: list extra objects BEFORE dropping the table:
--       select storage_path from public.seller_portal_files where status<>'deleted';
--     and remove them (Supabase dashboard > Storage > business-files, or Storage API).
--     They all live under "<business_id>/seller-portal-extra/".
--  4. Run this script.
begin;
drop index if exists public.seller_portal_events_type_time;
alter table public.seller_portal_events drop column if exists extra_file_id;
drop table if exists public.seller_portal_files;
commit;
-- 5. Remove the migration row:
-- delete from supabase_migrations.schema_migrations where version='20261004032704' and name='seller_portal_v2_extra_files';
-- Verify: schema fingerprint (portal-v2/sql/fingerprint-agg.sql) returns
--   n=118, agg=99efb32e7cda8260e9cb03087bbcbead  (value captured before v2, 04.10.2026 06:25 IL)
-- Note: since v2 the business card "open account" creates PBKDF2 passwords.
-- Those accounts keep working with v1 code (same hash format), so no data change is needed.
