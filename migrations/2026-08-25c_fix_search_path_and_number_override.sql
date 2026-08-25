BEGIN;

CREATE OR REPLACE FUNCTION trg_assign_business_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  il_ts timestamptz;
  yy text; mm text;
BEGIN
  -- Always assign from the system sequence; a client-supplied value is
  -- never honored, so the number can never be chosen or predicted by a caller.
  NEW.business_number := NULL;
  NEW.business_number_running := NULL;
  il_ts := COALESCE(NEW.created_at, now());
  yy := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'YY');
  mm := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'MM');
  NEW.business_number_running := nextval('business_number_seq');
  NEW.business_number := 'BSD-B-' || yy || mm || '-' || NEW.business_number_running;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_protect_business_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.business_number IS NOT NULL AND NEW.business_number IS DISTINCT FROM OLD.business_number THEN
    NEW.business_number := OLD.business_number;
  END IF;
  IF OLD.business_number_running IS NOT NULL AND NEW.business_number_running IS DISTINCT FROM OLD.business_number_running THEN
    NEW.business_number_running := OLD.business_number_running;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_assign_client_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  il_ts timestamptz;
  yy text; mm text;
BEGIN
  IF NEW.type NOT IN ('buyer','partner') THEN
    RETURN NEW;
  END IF;
  NEW.client_number := NULL;
  NEW.client_number_running := NULL;
  il_ts := COALESCE(NEW.created_at, now());
  yy := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'YY');
  mm := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'MM');
  NEW.client_number_running := nextval('client_number_seq');
  NEW.client_number := 'BSD-C-' || yy || mm || '-' || NEW.client_number_running;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_protect_client_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.client_number IS NOT NULL AND NEW.client_number IS DISTINCT FROM OLD.client_number THEN
    NEW.client_number := OLD.client_number;
  END IF;
  IF OLD.client_number_running IS NOT NULL AND NEW.client_number_running IS DISTINCT FROM OLD.client_number_running THEN
    NEW.client_number_running := OLD.client_number_running;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
