-- Rollback for supabase/migrations/20261004115126_lead_type_change_assigns_client_number.sql
-- Removes only the new trigger and its function. Client numbers that were
-- already assigned while it was active stay on their records (they are valid,
-- unique numbers from the same sequence; trg_leads_protect_client_number keeps
-- them unchanged). After rollback a seller -> buyer conversion fails again with
-- client_number_required_if_active, exactly as before the migration.
DROP TRIGGER IF EXISTS trg_leads_client_number_on_type_change ON public.leads;
DROP FUNCTION IF EXISTS public.trg_assign_client_number_on_type_change();
