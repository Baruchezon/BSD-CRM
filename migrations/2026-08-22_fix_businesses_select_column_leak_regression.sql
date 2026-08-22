-- ============================================================================
-- BSD-CRM — תיקון: רגרסיה שהחזירה את דליפת העמודות המזוהות למשתמשי "אנונימי"
-- תאריך: 22/08/2026
-- ============================================================================
-- שורש התקלה שדווח (סוכן קיבל בפועל גישה מלאה לעסק שהוגדר לו כאנונימי בלבד,
-- וכפילות בין רשימת "העסקים שלי" לרשימת "עסקים אנונימיים"):
--
-- ב-2026-08-15b_anonymous_card_column_leak_fix.sql נקבע במפורש שמדיניות
-- ה-SELECT על הטבלה הבסיסית businesses חייבת להחזיר רק שורות עם גישה מלאה
-- אמיתית (has_full_business_access), ושצפייה אנונימית תתבצע אך ורק דרך
-- ה-VIEW הסגור businesses_anonymous_card (שמחשב הרשאה בעצמו ומחזיר רשימת
-- עמודות מפורשת, לא את השורה כולה).
--
-- ב-2026-08-20b_distribution_and_access_levels.sql, בסעיף 7, מדיניות
-- ה-SELECT על businesses הוחלפה בטעות ל-get_business_access_level(...) <>
-- 'none' — כלומר כל מי שיש לו ולו הרשאה אנונימית בלבד (בין אם כהרשאה
-- מפורשת ובין אם דרך distribution_status='all_authorized') חזר וקיבל את
-- כל עמודות השורה מהטבלה הבסיסית עצמה, כולל internal_name/owner_phone/
-- owner_email/id_number/notes/asking_price וכו' — בדיוק התקלה שכבר תוקנה
-- ב-15.08 וחזרה. loadBusinesses() ב-businesses.html עצמה כבר מתעדת את
-- ההנחה ("ה-RLS כבר מחזיר בדיוק את השורות שמותר לראות") ולכן מציגה את כל
-- מה שחוזר מ-select('*') כטבלה מלאה — כולל, מאז 20.08, גם עסקים
-- שההרשאה בהם הייתה אמורה להיות אנונימית בלבד. אותה בעיה בדיוק חושפת גם
-- כל קריאת API ישירה על הטבלה, לא רק את ה-UI.
--
-- זו גם הסיבה לכפילות בין הרשימות (עסק עם גישה מלאה הופיע גם ברשימת
-- העסקים המלאים ("שלי") וגם ברשימת האנונימיים דרך ה-VIEW, ששם -inclusive-
-- מכוון גם למי שכבר יש לו גישה מלאה).
--
-- התיקון כאן הוא ממוקד וחוזר בדיוק למצב הנכון שכבר הוכח ב-15.08:
--   1) businesses_select חוזרת לדרוש גישה מלאה אמיתית בלבד.
--   2) businesses_anonymous_card מוגבל ל-access_level='anonymous' בדיוק
--      (לא 'anonymous' וגם 'full') כך שמשתמש עם גישה מלאה לא יראה את
--      אותו עסק גם ברשימת האנונימיים.
-- שום דבר אחר לא משתנה: has_full_business_access, get_business_access_level,
-- distribution_status, business_access_grants, security_invoker=false על
-- ה-VIEW (זה כבר תוקן נכון ב-20.08 ונשאר כפי שהוא) - כל אלה נשארים בדיוק
-- כפי שהם.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RLS על businesses - SELECT חוזר לדרוש גישה מלאה אמיתית בלבד. צפייה
--    אנונימית ממשיכה לעבוד אך ורק דרך ה-VIEW למטה (שרץ כ-security_invoker
--    = false, כלומר לא כפוף למדיניות הזו על הטבלה הבסיסית).
-- ----------------------------------------------------------------------------
drop policy if exists "businesses_select" on businesses;
create policy "businesses_select" on businesses for select using (
  has_full_business_access(id, auth.uid())
);

-- ----------------------------------------------------------------------------
-- 2. businesses_anonymous_card - מוגבל בדיוק לרמת גישה 'anonymous'. משתמש עם
--    גישה מלאה כבר רואה את העסק המלא ברשימה שלו - אין סיבה שיופיע גם כאן,
--    וזה בדיוק מה שיצר את הכפילות שדווחה.
-- ----------------------------------------------------------------------------
drop view if exists businesses_anonymous_card;

create view businesses_anonymous_card
with (security_invoker = false) as
select
  b.id,
  coalesce(b.anon_display_name, b.field) as anon_display_name,
  b.field,
  b.category,
  b.subcategory,
  b.city,
  b.years_active,
  b.annual_revenue,
  b.operating_profit,
  b.net_profit,
  b.employees_count,
  b.anon_summary,
  case when b.anon_card_show_price then b.asking_price else null end as asking_price,
  b.handled_by,
  b.anon_card_active,
  b.distribution_status,
  b.anon_summary_generated_at,
  b.created_at,
  b.updated_at
from businesses b
where b.anon_summary is not null
  and get_business_access_level(b.id, auth.uid()) = 'anonymous';

grant select on businesses_anonymous_card to authenticated;

-- ----------------------------------------------------------------------------
-- 3. תיקון משני, אותו מנגנון: ערך ברירת המחדל הישן על access_level (מלפני
--    20.08) נשאר 'full_view', שלא עומד יותר בבדיקת ה-check constraint
--    הנוכחית ('none'/'anonymous'/'full'). לא ידוע על מסלול קוד שמכניס שורה
--    בלי לציין access_level במפורש, אך זה תיקון תשתית זול וממוקד שמונע
--    כשל insert עתידי אם ייכתב כזה.
-- ----------------------------------------------------------------------------
alter table business_access_grants alter column access_level set default 'full';

-- ============================================================================
-- לאחר הרצה: loadBusinesses() ב-businesses.html (select('*') על businesses)
-- תחזיר מעכשיו רק עסקים עם גישה מלאה אמיתית - בדיוק כפי שהיה נכון בין
-- 15.08 ל-20.08. עסקים עם הרשאה אנונימית בלבד ימשיכו להופיע אך ורק בטאב
-- "עסקים אנונימיים" (הנשלף מה-VIEW), ולא גם ברשימה המלאה.
-- ============================================================================
