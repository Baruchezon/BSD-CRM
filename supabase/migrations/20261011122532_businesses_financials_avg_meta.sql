-- 11.10.2026 (approved by Baruch): persist the «ממוצע 3 שנים (2023–2025)» label that
-- the «מלא מהניתוח הכלכלי האחרון» checkbox (js/econAnalysisFill.js) shows next to
-- מחזור שנתי / רווח תפעולי / רווח נקי, so it stays on the business card after a reload.
--
-- ADDITIVE ONLY: one new nullable column. No existing column, row, policy, grant,
-- view or trigger is changed. Rollback: docs/financials-avg-meta-rollback.sql
--
-- Shape (years and source file only - never the numbers themselves):
--   { "annual_revenue":   { "label": "ממוצע 3 שנים (2023–2025)", "years": [2023,2024,2025],
--                           "source_file_id": "<business_sale_files.id>", "filled_at": "<iso>" },
--     "operating_profit": { ... }, "net_profit": { ... } }
-- A key is removed when that field is edited by hand afterwards.
--
-- Visibility: the column lives on public.businesses, so it is covered by the same RLS
-- as net_profit (businesses_select: creator / handler / has_full_business_access, plus
-- viewer_monitor_select). The agent/anonymous/public views (businesses_anonymous_card,
-- businesses_social_feed, public_business_listings, whatsapp_conversation_list) have
-- frozen column lists and do NOT gain this column.
alter table public.businesses
  add column if not exists financials_avg_meta jsonb;

alter table public.businesses
  drop constraint if exists businesses_financials_avg_meta_is_object;
alter table public.businesses
  add constraint businesses_financials_avg_meta_is_object
  check (financials_avg_meta is null or jsonb_typeof(financials_avg_meta) = 'object');

comment on column public.businesses.financials_avg_meta is
  'Per-field years label of the econ-analysis average fill (annual_revenue / operating_profit / net_profit): {label, years, source_file_id, filled_at}. Years only, no amounts. Written by businesses.html on save; a field key is dropped when that field is edited manually.';
