-- סימולטור עמלות BSD — טבלת הגדרות אחוזים משותפת (2026-09-01)
-- מטרה: האחוזים היום יושבים רק בזיכרון הדפדפן (localStorage) בגרסה
-- העצמאית של הסימולטור. כשהוא מוטמע בתוך ה-CRM, כל הסוכנים צריכים לראות
-- בדיוק אותם אחוזים מכל מכשיר — לכן עוברים לטבלה משותפת אחת ב-Supabase,
-- עם הגנה אמיתית ברמת השרת (RLS), לא רק הסתרת כפתור בממשק.
--
-- עיצוב הטבלה: שורה יחידה (id קבוע = 1) עם עמודת JSONB אחת שמכילה את כל
-- מבנה ההגדרות (בדיוק כמו DEFAULT_COMMISSION_RULES בגרסה העצמאית). זה
-- מאפשר להוסיף רכיב חלוקה חדש בעתיד (מסלול נוסף, שדה נוסף) בלי migration
-- נוספת — בדיוק הדרישה שהועלתה במפרט המקורי ("להוסיף רכיב חלוקה חדש
-- אם בעתיד יהיה צורך").
--
-- הרשאות (לפי החלטתו המפורשת של ברוך): כל משתמש מחובר רשאי לקרוא
-- (כדי להריץ את הסימולטור), אך רק role='admin' המלא רשאי לערוך ולשמור —
-- לא manager, בניגוד לרוב שאר המסכים הניהוליים במערכת. זו החרגה מכוונת
-- ומאושרת, לא שגיאה.

BEGIN;

CREATE TABLE IF NOT EXISTS public.commission_rules (
  id integer PRIMARY KEY DEFAULT 1,
  rules_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),
  CONSTRAINT commission_rules_singleton CHECK (id = 1)
);

COMMENT ON TABLE public.commission_rules IS 'הגדרות אחוזי עמלה משותפות לכל הארגון עבור סימולטור העמלות — שורה יחידה (id=1), עריכה מותרת ל-admin בלבד.';

-- זריעת ברירת המחדל — רק אם הטבלה ריקה (לא דורס שינויים קיימים בהרצה חוזרת)
INSERT INTO public.commission_rules (id, rules_json)
VALUES (1, '{
  "version": "1.0.0",
  "lastUpdated": "2026-09-01",
  "global": {
    "sellerCommissionRate": 0.05,
    "buyerCommissionRate": 0.05,
    "referralRate": 0.20
  },
  "authorizedAgent": {
    "enabled": true,
    "label": "סוכן מורשה",
    "soloRate": 0.70,
    "bsdSoloRate": 0.30,
    "withReferralAgentRate": 0.50,
    "withReferralBsdRate": 0.30
  },
  "office": {
    "enabled": true,
    "label": "משרד מייצג BSD",
    "agentRateNoReferral": 0.50,
    "agentRateWithReferral": 0.40,
    "officeShareOfRemainder": 0.50,
    "bsdShareOfRemainder": 0.50
  },
  "regional": {
    "enabled": true,
    "label": "נציגות BSD",
    "ownerLabel": "בעל הנציגות",
    "agentLabel": "מתווך תחת הנציגות",
    "agentRateNoReferral": 0.50,
    "agentRateWithReferral": 0.40,
    "regionalShareOfRemainder": 0.70,
    "bsdShareOfRemainder": 0.30,
    "developmentManager": { "enabled": false, "rate": 0.10 }
  },
  "franchise": {
    "enabled": false,
    "label": "זכיין BSD",
    "ownerLabel": "בעל הזיכיון",
    "agentLabel": "מתווך תחת הזכיין",
    "agentRateNoReferral": null,
    "agentRateWithReferral": null,
    "franchiseShareOfRemainder": null,
    "bsdShareOfRemainder": null,
    "note": "ממתין לאחוזים מדויקים מברוך איזון — אל תפעיל מסלול זה עד לעדכון.",
    "developmentManager": { "enabled": false, "rate": 0.10 }
  }
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- טריגר עדכון updated_at/updated_by, באותה תבנית אבטחה כמו שאר המערכת
-- (SECURITY DEFINER + search_path נעול, כדי למנוע החדרת search_path)
CREATE OR REPLACE FUNCTION public.trg_commission_rules_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commission_rules_touch ON public.commission_rules;
CREATE TRIGGER trg_commission_rules_touch
  BEFORE UPDATE ON public.commission_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_commission_rules_touch();

-- RLS: קריאה לכל משתמש מחובר (כולל agent רגיל — הוא צריך לקרוא את
-- האחוזים כדי להריץ את הסימולטור, גם אם אינו רשאי לערוך אותם).
-- כתיבה: admin בלבד, לפי החלטתו המפורשת של ברוך.
ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY commission_rules_select ON public.commission_rules
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY commission_rules_update ON public.commission_rules
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- אין INSERT/DELETE לאף אחד דרך ה-API — השורה היחידה נזרעת פעם אחת
-- למעלה, ונשארת קבועה (id=1). אם ירצה בעתיד רכיב היסטוריית שינויים
-- (מי שינה מה ומתי), זו הרחבה נפרדת שלא נוגעת בשורה הזו.
REVOKE INSERT, DELETE ON public.commission_rules FROM authenticated, anon;

COMMIT;
