-- Found in production verification (03.10.2026): the approval gate runs as the
-- calling CRM user, and its lookup of public.profiles triggers the existing
-- profiles RLS policy, whose helper is_admin_or_manager() refers to an
-- unqualified "profiles". With search_path='' that helper failed with
-- 'relation "profiles" does not exist', so an admin publishing an ad report to
-- the portal from the CRM was rejected. A fixed, non-mutable search_path that
-- includes public lets the existing helper resolve. The function body is
-- unchanged and still fully qualified.
alter function public.seller_portal_file_approval_gate() set search_path = public, pg_temp;
