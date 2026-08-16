-- ============================================================================
-- BSD-CRM — תיקון קריטי דחוף: לולאה אינסופית ב-RLS של profiles חוסמת התחברות
-- תאריך: 16/08/2026
-- ============================================================================
-- הבעיה: profiles_select_self_or_admin ו-profiles_update_self_or_admin (מ-
-- 2026-08-15_permissions_and_anonymous_access.sql) בדקו "האם admin/manager"
-- באמצעות שאילתה ישירה על profiles מתוך מדיניות RLS שחלה על profiles עצמה.
-- Postgres מזהה את זה כלולאה ("infinite recursion detected in policy for
-- relation profiles") וזורק שגיאה בכל שאילתה על הטבלה - כולל בדיקת הפרופיל
-- שמתבצעת מיד אחרי כל התחברות, ולכן אף משתמש (כולל admin אמיתי) לא הצליח
-- להתחבר. שאר המדיניות במערכת (businesses/leads/matches וכו') תקינות כי הן
-- לא בודקות את עצמן - רק profiles נפגעה, כי שם הבדיקה "האם admin" נעשית
-- מתוך הטבלה שעליה המדיניות חלה.
--
-- התיקון: פונקציה is_admin_or_manager() עם SECURITY DEFINER - רצה בהרשאות
-- הבעלים של הפונקציה ולכן עוקפת RLS לגמרי בזמן הבדיקה הפנימית שלה, בדיוק
-- כמו has_full_business_access() שכבר עובדת נכון בכל שאר הטבלאות.
-- ============================================================================

create or replace function is_admin_or_manager(uid uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles p where p.id = uid and p.role in ('admin','manager'));
$$;

drop policy if exists "profiles_select_self_or_admin" on profiles;
create policy "profiles_select_self_or_admin" on profiles for select using (
  id = auth.uid()
  or is_admin_or_manager(auth.uid())
);

drop policy if exists "profiles_update_self_or_admin" on profiles;
create policy "profiles_update_self_or_admin" on profiles for update using (
  id = auth.uid()
  or is_admin_or_manager(auth.uid())
);

-- ============================================================================
-- הערה: אחרי הרצת זו, ההתחברות אמורה לעבוד מיד לכל המשתמשים, כולל
-- baruch.ezon@gmail.com ו-baruch@bsd-bbi.co.il. אם baruch@bsd-bbi.co.il אמור
-- להיות ה-admin הראשי ואינו כרגע - תריץ בנפרד:
-- update profiles set role = 'admin' where email = 'baruch@bsd-bbi.co.il';
-- ============================================================================
