-- Rollback for supabase/migrations/20261011155351_leads_lead_side.sql
-- (migration name: leads_lead_side). Removes only what it added.
--
-- Order:
--  1. Pin the website-lead edge function back to version 16 (source kept in
--     docs/edge-backups/website-lead-v16.ts): redeploy that file as website-lead.
--     v17 writes lead_side and would fail inserts once the column is gone.
--  2. Deploy the previous front-end build (202610111800); build 202610111900 reads and
--     writes lead_side.
--  3. Run ONE of the blocks below.

-- (a) Undo only the backfill, keep the columns (values set later by people stay):
-- update public.leads l set lead_side = null, lead_side_source = null
--   from public.lead_side_backfill_log g
--  where l.id = g.lead_id and l.lead_side_source = 'backfill:' || g.signal;

-- (b) Full rollback. Data loss: only the seller/buyer choices stored in lead_side
--     (leads.type is untouched). Export first if needed:
--     select id, lead_side, lead_side_source from public.leads where lead_side is not null;
drop table if exists public.lead_side_backfill_log;
alter table public.leads drop constraint if exists leads_lead_side_check;
alter table public.leads drop column if exists lead_side_source;
alter table public.leads drop column if exists lead_side;
