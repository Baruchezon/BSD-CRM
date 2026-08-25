BEGIN;

-- תיקון 25.08.2026: פונקציית בדיקת היסטוריה לעסק לפני מחיקה/ארכוב.
-- לא ניתן לבצע את הספירה הזו מהדפדפן (RLS): tasks_select חושף שורות רק
-- ל-admin ולמשתמש שהמשימה שויכה אליו (לא ל-manager!), ו-
-- business_number_correction_log מופעל עם RLS אך ללא אף policy (כלומר
-- חסום לחלוטין דרך הלקוח). ספירה מהלקוח הייתה מחזירה 0 באופן שגוי במקרים
-- האלה, ועלולה הייתה לגרום למחיקה פיזית של עסק שיש לו בפועל היסטוריה -
-- בניגוד למדיניות המפורשת שאסור לאבד היסטוריה. הפונקציה הזו SECURITY
-- DEFINER (כמו has_full_business_access הקיימת כבר) ורצה עם הרשאות
-- הבעלים, כך שהיא רואה את המצב האמיתי במסד ולא את מה שה-RLS חושף
-- למשתמש הנוכחי. מוגבלת ל-admin/manager בלבד (אותה קבוצה שרואה את
-- כפתור המחיקה בממשק ממילא).
CREATE OR REPLACE FUNCTION public.get_business_history_summary(biz_id uuid)
RETURNS TABLE(table_name text, row_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','manager')
  ) THEN
    RAISE EXCEPTION 'permission denied: admin/manager only';
  END IF;

  RETURN QUERY
  SELECT 'matches', count(*) FROM matches WHERE business_id = biz_id
  UNION ALL
  SELECT 'tasks', count(*) FROM tasks WHERE business_id = biz_id
  UNION ALL
  SELECT 'match_meetings', count(*) FROM match_meetings WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_number_correction_log', count(*) FROM business_number_correction_log WHERE business_id = biz_id
  UNION ALL
  SELECT 'anon_distributions', count(*) FROM anon_distributions WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_sale_files', count(*) FROM business_sale_files WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_file_meta', count(*) FROM business_file_meta WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_access_requests', count(*) FROM business_access_requests WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_access_grants', count(*) FROM business_access_grants WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_access_audit', count(*) FROM business_access_audit WHERE business_id = biz_id
  UNION ALL
  SELECT 'files_meta', count(*) FROM files_meta WHERE business_id = biz_id
  UNION ALL
  SELECT 'public_inquiries', count(*) FROM public_inquiries WHERE business_id = biz_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_business_history_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_business_history_summary(uuid) TO authenticated;

COMMIT;
