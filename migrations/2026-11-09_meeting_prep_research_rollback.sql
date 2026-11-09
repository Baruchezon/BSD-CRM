-- Rollback for migrations/2026-11-09_meeting_prep_research.sql
-- Drops only the two meeting-prep columns. pre_research is not touched.

ALTER TABLE public.businesses DROP COLUMN IF EXISTS market_research_brief;
ALTER TABLE public.businesses DROP COLUMN IF EXISTS market_reviews;
