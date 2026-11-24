-- Rollback for 20261124193000_valuation_requests.sql.
-- Safe first step (no data loss): stop the public write path and hide the screen's data.
revoke execute on function public.submit_valuation_request(jsonb) from anon, authenticated;
revoke execute on function public.attach_valuation_request_contact(uuid, jsonb) from anon, authenticated;
-- The table keeps every stored request (no hard delete). To fully remove the objects later,
-- only with Baruch's approval and after exporting the rows:
--   drop function if exists public.submit_valuation_request(jsonb);
--   drop function if exists public.attach_valuation_request_contact(uuid, jsonb);
--   drop function if exists public.set_valuation_request_archived(uuid, boolean);
--   drop function if exists public.valuation_calc(text, numeric, jsonb);
--   alter table public.valuation_requests rename to valuation_requests_retired_20261124;
