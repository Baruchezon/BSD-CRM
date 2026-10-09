-- Rollback for migrations/2026-10-09_lead_handling_status.sql (applied as 20261009051452_lead_handling_status)
-- WARNING: drops the «מצב טיפול» values already chosen. Export them first if needed:
--   select id, handling_status from public.leads where handling_status <> 'לא טופל';
-- The lead card sends handling_status only when the select was changed, so pages from
-- this build keep saving other fields after a rollback; changing «מצב טיפול» itself would fail.
alter table public.leads drop constraint if exists leads_handling_status_check;
alter table public.leads drop column if exists handling_status;
