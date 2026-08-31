BEGIN;

-- ============================================================
-- מנגנון מניעת כפילויות - עסקים וקונים (31.08.2026)
-- הוספה בלבד: עמודה חדשה נלווה (dedupe_override_reason), 2 פונקציות בדיקה
-- (RPC, לשימוש הצד-לקוח בזמן הקלדה ולפני שמירה), ו-2 טריגרים BEFORE INSERT
-- לאכיפה אמיתית בצד השרת. אין מחיקה/שינוי של נתונים קיימים, אין השפעה על
-- UPDATE. Edge Functions הפועלים עם service_role מוחרגים במפורש כדי לא
-- לשבור התנהגות קיימת ומכוונת (process-site123-leads).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS dedupe_override_reason text;
ALTER TABLE public.leads      ADD COLUMN IF NOT EXISTS dedupe_override_reason text;

-- ------------------------------------------------------------
-- בדיקת כפילות עסקים (RPC) - לשימוש businesses.html/intake-form.html
-- SECURITY DEFINER כדי לראות את כל העסקים במערכת ללא תלות ב-RLS של
-- הסוכן המבצע (אחרת לא ניתן לזהות כפילות מול עסק ששייך לסוכן אחר) -
-- אותו עיקרון בדיוק כמו find_2026_review_matches הקיים. מוחזרים רק
-- שדות מזהים בסיסיים, לא כל העמודות החסויות.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bsd_check_business_duplicate(
  p_internal_name text,
  p_owner_name text,
  p_owner_phone text,
  p_exclude_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_phone9 text := nullif(right(regexp_replace(coalesce(p_owner_phone,''), '\D','','g'), 9), '');
  v_name   text := nullif(regexp_replace(lower(trim(coalesce(p_internal_name,''))), '\s+',' ','g'), '');
  v_owner  text := nullif(regexp_replace(lower(trim(coalesce(p_owner_name,''))), '\s+',' ','g'), '');
  result jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF v_phone9 IS NULL AND v_name IS NULL THEN
    RETURN result;
  END IF;

  FOR r IN
    SELECT b.id, b.internal_name, b.owner_name, b.owner_phone, b.business_number, b.status, b.is_archived,
      CASE
        WHEN v_phone9 IS NOT NULL AND right(regexp_replace(coalesce(b.owner_phone,''),'\D','','g'),9) = v_phone9 THEN 'phone'
        WHEN v_name IS NOT NULL AND v_owner IS NOT NULL
             AND regexp_replace(lower(trim(coalesce(b.internal_name,''))), '\s+',' ','g') = v_name
             AND regexp_replace(lower(trim(coalesce(b.owner_name,''))), '\s+',' ','g') = v_owner THEN 'name_owner'
        ELSE 'name_similar'
      END AS match_level,
      (CASE
        WHEN v_phone9 IS NOT NULL AND right(regexp_replace(coalesce(b.owner_phone,''),'\D','','g'),9) = v_phone9 THEN 0
        WHEN v_name IS NOT NULL AND v_owner IS NOT NULL
             AND regexp_replace(lower(trim(coalesce(b.internal_name,''))), '\s+',' ','g') = v_name
             AND regexp_replace(lower(trim(coalesce(b.owner_name,''))), '\s+',' ','g') = v_owner THEN 1
        ELSE 2
      END) AS rank_order
    FROM public.businesses b
    WHERE (p_exclude_id IS NULL OR b.id <> p_exclude_id)
      AND (
        (v_phone9 IS NOT NULL AND right(regexp_replace(coalesce(b.owner_phone,''),'\D','','g'),9) = v_phone9)
        OR (v_name IS NOT NULL AND v_owner IS NOT NULL
            AND regexp_replace(lower(trim(coalesce(b.internal_name,''))), '\s+',' ','g') = v_name
            AND regexp_replace(lower(trim(coalesce(b.owner_name,''))), '\s+',' ','g') = v_owner)
        OR (v_name IS NOT NULL AND b.internal_name IS NOT NULL
            AND public.similarity(regexp_replace(lower(trim(b.internal_name)), '\s+',' ','g'), v_name) > 0.45)
      )
    ORDER BY rank_order
    LIMIT 8
  LOOP
    result := result || jsonb_build_object(
      'id', r.id, 'internal_name', r.internal_name, 'owner_name', r.owner_name,
      'owner_phone', r.owner_phone, 'business_number', r.business_number,
      'status', r.status, 'is_archived', r.is_archived, 'match_level', r.match_level
    );
  END LOOP;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bsd_check_business_duplicate(text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bsd_check_business_duplicate(text,text,text,uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- בדיקת כפילות קונים/לידים (RPC) - לשימוש leads.html/buyer-form.html
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bsd_check_lead_duplicate(
  p_full_name text,
  p_phone text,
  p_id_number text DEFAULT NULL,
  p_exclude_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_phone9 text := nullif(right(regexp_replace(coalesce(p_phone,''), '\D','','g'), 9), '');
  v_name   text := nullif(regexp_replace(lower(trim(coalesce(p_full_name,''))), '\s+',' ','g'), '');
  v_idnum  text := nullif(trim(coalesce(p_id_number,'')), '');
  result jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF v_phone9 IS NULL AND v_name IS NULL AND v_idnum IS NULL THEN
    RETURN result;
  END IF;

  FOR r IN
    SELECT l.id,
      coalesce(l.full_name, trim(coalesce(l.first_name,'')||' '||coalesce(l.last_name,''))) AS full_name,
      l.phone, l.client_number, l.status, l.is_archived,
      CASE
        WHEN v_phone9 IS NOT NULL AND (
             right(regexp_replace(coalesce(l.phone,''),'\D','','g'),9) = v_phone9
             OR right(regexp_replace(coalesce(l.phone2,''),'\D','','g'),9) = v_phone9) THEN 'phone'
        WHEN v_idnum IS NOT NULL AND trim(coalesce(l.id_number,'')) = v_idnum THEN 'id_number'
        ELSE 'name_similar'
      END AS match_level,
      (CASE
        WHEN v_phone9 IS NOT NULL AND (
             right(regexp_replace(coalesce(l.phone,''),'\D','','g'),9) = v_phone9
             OR right(regexp_replace(coalesce(l.phone2,''),'\D','','g'),9) = v_phone9) THEN 0
        WHEN v_idnum IS NOT NULL AND trim(coalesce(l.id_number,'')) = v_idnum THEN 0
        ELSE 2
      END) AS rank_order
    FROM public.leads l
    WHERE (p_exclude_id IS NULL OR l.id <> p_exclude_id)
      AND (
        (v_phone9 IS NOT NULL AND (
            right(regexp_replace(coalesce(l.phone,''),'\D','','g'),9) = v_phone9
            OR right(regexp_replace(coalesce(l.phone2,''),'\D','','g'),9) = v_phone9))
        OR (v_idnum IS NOT NULL AND trim(coalesce(l.id_number,'')) = v_idnum)
        OR (v_name IS NOT NULL
            AND public.similarity(
                  regexp_replace(lower(trim(coalesce(l.full_name, trim(coalesce(l.first_name,'')||' '||coalesce(l.last_name,''))))), '\s+',' ','g'),
                  v_name) > 0.45)
      )
    ORDER BY rank_order
    LIMIT 8
  LOOP
    result := result || jsonb_build_object(
      'id', r.id, 'full_name', r.full_name, 'phone', r.phone,
      'client_number', r.client_number, 'status', r.status, 'is_archived', r.is_archived,
      'match_level', r.match_level
    );
  END LOOP;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bsd_check_lead_duplicate(text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bsd_check_lead_duplicate(text,text,text,uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- אכיפה בצד השרת (BEFORE INSERT) - עסקים
-- חוסם רק התאמה "חזקה" (טלפון זהה, או שם עסק+שם בעלים זהים) מול עסקים
-- שאינם בארכיון. לא חוסם על סמך דמיון שם בלבד. service_role (Edge
-- Functions אוטומטיים) מוחרג לגמרי - אין להם היום מנגנון חריגה מבוקרת,
-- ואסור לשבור התנהגות אוטומטית קיימת.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bsd_enforce_business_dedupe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_phone9 text := nullif(right(regexp_replace(coalesce(NEW.owner_phone,''), '\D','','g'), 9), '');
  v_name   text := nullif(regexp_replace(lower(trim(coalesce(NEW.internal_name,''))), '\s+',' ','g'), '');
  v_owner  text := nullif(regexp_replace(lower(trim(coalesce(NEW.owner_name,''))), '\s+',' ','g'), '');
  v_match record;
  v_authorized boolean;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF v_phone9 IS NULL AND (v_name IS NULL OR v_owner IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT b.id, b.internal_name, b.owner_name, b.owner_phone, b.business_number, b.status
    INTO v_match
  FROM public.businesses b
  WHERE b.is_archived = false
    AND (
      (v_phone9 IS NOT NULL AND right(regexp_replace(coalesce(b.owner_phone,''),'\D','','g'),9) = v_phone9)
      OR (v_name IS NOT NULL AND v_owner IS NOT NULL
          AND regexp_replace(lower(trim(coalesce(b.internal_name,''))), '\s+',' ','g') = v_name
          AND regexp_replace(lower(trim(coalesce(b.owner_name,''))), '\s+',' ','g') = v_owner)
    )
  LIMIT 1;

  IF v_match.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.dedupe_override_reason IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','manager')
    ) INTO v_authorized;

    IF v_authorized THEN
      INSERT INTO public.audit_log(table_name, record_id, action, actor_id, details)
      VALUES ('businesses', NEW.id, 'duplicate_override_create', auth.uid(),
        jsonb_build_object('reason', NEW.dedupe_override_reason, 'matched_existing', to_jsonb(v_match)));
      RETURN NEW;
    END IF;
    -- ניסיון חריגה בלי הרשאה מתאימה - הדגל מתעלם ונופל לחסימה הרגילה למטה
  END IF;

  RAISE EXCEPTION 'קיים כבר במערכת עסק שעשוי להתאים לפרטים שהוזנו'
    USING ERRCODE = 'BSD01',
          DETAIL = to_jsonb(v_match)::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bsd_enforce_business_dedupe() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_businesses_dedupe_check ON public.businesses;
CREATE TRIGGER trg_businesses_dedupe_check
  BEFORE INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.bsd_enforce_business_dedupe();

-- ------------------------------------------------------------
-- אכיפה בצד השרת (BEFORE INSERT) - קונים/לידים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bsd_enforce_lead_dedupe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_phone9 text := nullif(right(regexp_replace(coalesce(NEW.phone,''), '\D','','g'), 9), '');
  v_idnum  text := nullif(trim(coalesce(NEW.id_number,'')), '');
  v_match record;
  v_authorized boolean;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF v_phone9 IS NULL AND v_idnum IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.id, coalesce(l.full_name, trim(coalesce(l.first_name,'')||' '||coalesce(l.last_name,''))) AS full_name,
         l.phone, l.client_number, l.status
    INTO v_match
  FROM public.leads l
  WHERE l.is_archived = false
    AND (
      (v_phone9 IS NOT NULL AND (
          right(regexp_replace(coalesce(l.phone,''),'\D','','g'),9) = v_phone9
          OR right(regexp_replace(coalesce(l.phone2,''),'\D','','g'),9) = v_phone9))
      OR (v_idnum IS NOT NULL AND trim(coalesce(l.id_number,'')) = v_idnum)
    )
  LIMIT 1;

  IF v_match.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.dedupe_override_reason IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','manager')
    ) INTO v_authorized;

    IF v_authorized THEN
      INSERT INTO public.audit_log(table_name, record_id, action, actor_id, details)
      VALUES ('leads', NEW.id, 'duplicate_override_create', auth.uid(),
        jsonb_build_object('reason', NEW.dedupe_override_reason, 'matched_existing', to_jsonb(v_match)));
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'קיים כבר במערכת קונה/ליד שעשוי להתאים לפרטים שהוזנו'
    USING ERRCODE = 'BSD01',
          DETAIL = to_jsonb(v_match)::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bsd_enforce_lead_dedupe() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_leads_dedupe_check ON public.leads;
CREATE TRIGGER trg_leads_dedupe_check
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.bsd_enforce_lead_dedupe();

COMMIT;
