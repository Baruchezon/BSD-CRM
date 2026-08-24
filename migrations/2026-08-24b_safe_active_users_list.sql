-- ============================================================================
-- BSD-CRM — פונקציה בטוחה לרשימת משתמשים פעילים (לכל משתמש מחובר)
-- תאריך: 24/08/2026
-- ============================================================================
-- הבעיה: profiles_select_self_or_admin (מ-16.08) מגביל משתמש רגיל (סוכן/
-- סוכן מורשה) לראות רק את השורה של עצמו בטבלת profiles. תיקון נכון וזהיר -
-- זה גם המכוון המקורי, כי בטבלה יש שדות רגישים (הרשאות, זמני התחברות וכו').
-- אבל תופעת הלוואי היא ש-12 מסכים שונים שמושכים רשימת משתמשים כדי להציג
-- שמות/לאפשר בחירה (הודעה חדשה, שיוך משימה, מי מטפל בעסק וכו') מקבלים
-- בחזרה שורה אחת בלבד למשתמש רגיל - וזה גם גורם לחנן להיראות כ"משתמש
-- שהוסר" בהודעות (הוא לא מופיע ברשימה שהובאה, אז הקוד מניח בטעות שהוסר).
--
-- הפתרון: פונקציה SECURITY DEFINER שמחזירה אך ורק id, full_name, email, role
-- לכל משתמש עם status='active' - בלי אף שדה רגיש אחר - לכל משתמש מחובר,
-- ללא תלות בהרשאות RLS על profiles עצמה. אותו דפוס בדיוק כמו
-- has_full_business_access/is_admin_or_manager שכבר עובד היטב במערכת.
-- ============================================================================

create or replace function get_active_users_basic()
returns table (id uuid, full_name text, email text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role
  from profiles p
  where p.status = 'active';
$$;

revoke all on function get_active_users_basic() from public, anon;
grant execute on function get_active_users_basic() to authenticated;
