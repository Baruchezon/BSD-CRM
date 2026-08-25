-- בדיקות רגרסיה למנגנון השמירה הקריטי (businesses/leads)
-- ==========================================================
-- נכתב 25.08.2026 בעקבות תקלה חוזרת: עסק/ליד חדש ללא הסכם נשמר תקין
-- במסד הנתונים אך נעלם מהתצוגה. הכלל העסקי המחייב מאז: קיום ותצוגה של
-- רשומה לעולם אינם מותנים בסטטוס הסכם.
--
-- איך מריצים: להדביק את כל הקובץ (או קטע-קטע) ב-SQL Editor של Supabase,
-- או להריץ דרך ה-Management API (database/query). כל קטע עוטף את עצמו
-- ב-BEGIN/ROLLBACK או מנקה אחרי עצמו במפורש - שום קטע לא משאיר לכלוך
-- אמיתי במסד הנתונים. יש להריץ שוב אחרי כל שינוי עתידי בקוד ה-RLS/
-- triggers/constraints של businesses או leads, לפני שדוחפים לפרודקשן.
--
-- מזהה משתמש הבדיקה (סוכן אמיתי, פעיל, לא אדמין) - עדכן אם המשתמש הזה
-- הוסר בעתיד:
--   ahimezon@gmail.com / role=agent / can_create_businesses=true / can_create_buyers=true
--   id: 2cbef00b-050e-44ec-8404-664df7d87ae7
--
-- מזהה סוכן שני, לא קשור, לבדיקת בידוד הרשאות (should NOT see the record):
--   iyogev7@gmail.com / role=agent
--   id: 856f051b-b75b-4f84-9174-2ecc8fd985dc

-- ------------------------------------------------------------------
-- טסט 1: עסק חדש ללא הסכם - חייב להישמר ולהיות גלוי ליוצר
-- ------------------------------------------------------------------
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = '2cbef00b-050e-44ec-8404-664df7d87ae7';
INSERT INTO businesses (internal_name, agreement_status, created_by)
VALUES ('BSD-REGRESSION-TEST-BIZ', 'אין הסכם', '2cbef00b-050e-44ec-8404-664df7d87ae7')
RETURNING id, business_number, agreement_status, is_archived;
-- ציפייה: שורה אחת חוזרת, business_number לא NULL, agreement_status='אין הסכם', is_archived=false
ROLLBACK; -- לא משאיר לכלוך

-- ------------------------------------------------------------------
-- טסט 2: ליד קונה/שותף/מוכר חדש ללא הסכם - חייב להישמר
-- ------------------------------------------------------------------
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = '2cbef00b-050e-44ec-8404-664df7d87ae7';
INSERT INTO leads (type, first_name, last_name, full_name, agreement_status, created_by) VALUES
  ('buyer',   'בדיקה', 'קונה',  'בדיקה קונה',  'אין הסכם', '2cbef00b-050e-44ec-8404-664df7d87ae7'),
  ('partner', 'בדיקה', 'שותף',  'בדיקה שותף',  'אין הסכם', '2cbef00b-050e-44ec-8404-664df7d87ae7'),
  ('seller',  'בדיקה', 'מוכר',  'בדיקה מוכר',  'אין הסכם', '2cbef00b-050e-44ec-8404-664df7d87ae7')
RETURNING id, type, client_number, agreement_status;
-- ציפייה: 3 שורות. buyer/partner מקבלים client_number לא NULL, seller מקבל NULL (וזה תקין - הטריגר לא מקצה מספר למוכרים)
ROLLBACK;

-- ------------------------------------------------------------------
-- טסט 3: בידוד הרשאות - סוכן אחר שלא יצר את הרשומה לא רואה אותה
-- ------------------------------------------------------------------
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = '2cbef00b-050e-44ec-8404-664df7d87ae7';
INSERT INTO businesses (internal_name, agreement_status, created_by)
VALUES ('BSD-REGRESSION-TEST-ISOLATION', 'אין הסכם', '2cbef00b-050e-44ec-8404-664df7d87ae7');
SET LOCAL request.jwt.claim.sub = '856f051b-b75b-4f84-9174-2ecc8fd985dc'; -- סוכן אחר, לא קשור
SELECT count(*) AS should_be_zero FROM businesses WHERE internal_name = 'BSD-REGRESSION-TEST-ISOLATION';
-- ציפייה: should_be_zero = 0
ROLLBACK;

-- ------------------------------------------------------------------
-- טסט 4: אין שום RLS policy שמזכירה agreement_status (אסימפטומטי,
-- מוודא שאף אחד לא הוסיף בעתיד תלות דומה בטעות)
-- ------------------------------------------------------------------
SELECT tablename, policyname
FROM pg_policies
WHERE qual ILIKE '%agreement_status%' OR with_check ILIKE '%agreement_status%';
-- ציפייה: 0 שורות. אם מופיעה שורה - זו רגרסיה של אותה תקלה בדיוק, לתקן מיד.

-- ------------------------------------------------------------------
-- טסט 5: אין drift בין המיגרציות (constraints צפויים) לבין המצב החי
-- ------------------------------------------------------------------
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('business_number_required_if_active', 'client_number_required_if_active');
-- ציפייה: שתי שורות, בדיוק כמו ב-migrations/2026-08-25h_stage3_number_required_if_active.sql
