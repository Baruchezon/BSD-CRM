-- 04.10.2026 - lead card "שמור והעבר" -> קונים fails for leads that entered as sellers.
--
-- Root cause: client numbers (BSD-C-YYMM-N) are assigned only BEFORE INSERT
-- (trg_leads_client_number -> trg_assign_client_number). A lead that was stored
-- as type 'seller' (e.g. a website lead the intake classified as seller) has no
-- client number. Converting it to buyer/partner is an UPDATE of the same row,
-- so no number is assigned and the UPDATE violates
--   CHECK client_number_required_if_active
--   ((type NOT IN ('buyer','partner')) OR is_archived OR client_number IS NOT NULL)
-- The transfer is rolled back and the lead stays in the leads inbox. The same
-- error hits the buyers form when its type switch turns a seller into a buyer.
--
-- Fix: one extra BEFORE UPDATE OF type trigger that assigns a client number in
-- exactly the same format/sequence as the insert trigger, and only when the
-- row becomes an active buyer/partner that has no number yet.
--   * no change to the insert trigger, the CHECK constraint, RLS or any data
--   * existing numbers are never changed (trg_leads_protect_client_number still
--     runs after this trigger and keeps protecting them)
--   * no backfill: rows get a number only when they are actually converted
--
-- Applied to production 04.10.2026 14:51 IDT (recorded version 20261004115126).
-- Rollback: db/rollback_20261004115126_lead_type_change_assigns_client_number.sql

CREATE OR REPLACE FUNCTION public.trg_assign_client_number_on_type_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  il_ts timestamptz;
  yy text; mm text;
BEGIN
  -- Same guard as the trigger WHEN clause (kept here too so the function is
  -- safe if it is ever attached elsewhere).
  IF NEW.type NOT IN ('buyer','partner') OR OLD.client_number IS NOT NULL OR NEW.is_archived THEN
    RETURN NEW;
  END IF;
  -- Same numbering rule as trg_assign_client_number (insert): the month is the
  -- record's creation month, the running number comes from client_number_seq.
  il_ts := COALESCE(NEW.created_at, now());
  yy := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'YY');
  mm := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'MM');
  NEW.client_number_running := nextval('public.client_number_seq');
  NEW.client_number := 'BSD-C-' || yy || mm || '-' || NEW.client_number_running;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_assign_client_number_on_type_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_assign_client_number_on_type_change() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_leads_client_number_on_type_change ON public.leads;
CREATE TRIGGER trg_leads_client_number_on_type_change
  BEFORE UPDATE OF type ON public.leads
  FOR EACH ROW
  WHEN (NEW.type IN ('buyer','partner') AND OLD.client_number IS NULL AND NOT NEW.is_archived)
  EXECUTE FUNCTION public.trg_assign_client_number_on_type_change();

COMMENT ON FUNCTION public.trg_assign_client_number_on_type_change() IS
  'Assigns a BSD-C client number when an existing lead becomes an active buyer/partner without one (lead -> buyer transfer). 04.10.2026';
