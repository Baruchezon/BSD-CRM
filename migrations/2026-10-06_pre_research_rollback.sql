-- Rollback for migrations/2026-10-06_pre_research.sql
-- WARNING: drops any «🔎 חקר מקדים» text already saved. Export it first if needed:
--   select id, pre_research from public.leads      where pre_research is not null;
--   select id, pre_research from public.businesses where pre_research is not null;
-- The front end only sends pre_research when the box was edited, so pages from this
-- build keep saving other fields after a rollback; editing the box itself would fail.

ALTER TABLE public.leads      DROP COLUMN IF EXISTS pre_research;
ALTER TABLE public.businesses DROP COLUMN IF EXISTS pre_research;
