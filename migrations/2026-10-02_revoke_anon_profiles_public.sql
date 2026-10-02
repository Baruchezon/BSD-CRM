-- Security fix 02.10.2026 (approved by Baruch Ezon) - applied to production via migration
-- "revoke_anon_profiles_public_20261002".
-- profiles_public (SELECT id, full_name, email, role FROM profiles; definer semantics, auto-updatable)
-- was readable AND writable by anon. Not used by any frontend page.
-- Rollback: GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles_public TO anon;
REVOKE ALL ON public.profiles_public FROM anon;
