-- ============================================================================
-- BSD-CRM — כרטיס אנונימי מבוסס AI: שדות חדשים לתקציר מתומצת ולא-מועתק
-- תאריך: 16/08/2026
-- ============================================================================
-- עד עכשיו הכרטיס האנונימי הציג את short_description/sale_reason כמו שהם
-- (עם בדיקת substring שמונעת רק הופעת שם מפורש). האפיון החדש דורש שהתיאור
-- לא יהיה העתקה של הטקסט המקורי אלא תקציר חדש שנכתב מחדש ע"י AI ועובר
-- בדיקת אנונימיות משלו. השדות האלה מחליפים את מקור התצוגה בכרטיס האנונימי.
-- ============================================================================

alter table businesses add column if not exists anon_display_name         text;
alter table businesses add column if not exists anon_summary              text;
alter table businesses add column if not exists anon_summary_generated_at timestamptz;
alter table businesses add column if not exists anon_summary_generated_by uuid references profiles(id);
-- hash של תוכן המקור (תיאור+הערות+סיבת מכירה+שם) בזמן היצירה - כדי לזהות
-- אם התוכן השתנה מאז ולהציע רענון (סעיף 8 באפיון), בלי לשמור את התוכן עצמו פעמיים
alter table businesses add column if not exists anon_summary_source_hash  text;

-- מעדכן את ה-VIEW: מציג את התקציר שנוצר ע"י AI (anon_summary/anon_display_name)
-- במקום את short_description הגולמי, ומחליף region (אזור רחב) ב-city
-- (רמת עיר בלבד, בדיוק כפי שביקש בסעיף 1). אם עדיין לא נוצר תקציר AI
-- לעסק מסוים (anon_summary is null), לא מוצג תיאור בכלל - לא ממציאים
-- וגם לא חוזרים לטקסט הגולמי הלא-בטוח (סעיף 4: עדיף פחות מידע מניחוש).
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
  b.anon_summary_generated_at,
  b.created_at,
  b.updated_at
from businesses b
where b.anon_card_active = true
  and (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
    or exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
    or has_full_business_access(b.id, auth.uid())
  );

grant select on businesses_anonymous_card to authenticated;

-- ============================================================================
-- הערה: sale_reason הגולמי כבר לא נחשף כעמודה נפרדת בכרטיס - אם anon_card_
-- show_reason מסומן, סיבת המכירה נכנסת כקלט ל-AI ומשולבת (באופן מתומצת
-- ובטוח) בתוך anon_summary עצמו במקום להיחשף כטקסט גולמי בנפרד - עקבי עם
-- הכלל "לא להעתיק, לתמצת מחדש" (סעיף 5).
-- ============================================================================
