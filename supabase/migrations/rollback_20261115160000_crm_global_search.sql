-- Rollback for 20261115160000_crm_global_search.sql (new functions only; no data touched).
drop function if exists public.crm_global_search(text, integer);
drop function if exists public.crm_global_search_subscribers(text, integer);
drop function if exists public.crm_search_digits(text);
