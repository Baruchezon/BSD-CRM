-- Rollback for supabase/migrations/20261011122532_businesses_financials_avg_meta.sql
-- (migration name: businesses_financials_avg_meta). Removes only what it added.
-- Data loss: only the saved «ממוצע N שנים (...)» labels. The amounts in
-- annual_revenue / operating_profit / net_profit are untouched.
-- Deploy the previous front-end build (202610111700) first, or the card save will
-- send a column that no longer exists.
alter table public.businesses drop constraint if exists businesses_financials_avg_meta_is_object;
alter table public.businesses drop column if exists financials_avg_meta;
