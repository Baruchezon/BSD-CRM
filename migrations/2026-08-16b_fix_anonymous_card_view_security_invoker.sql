-- ============================================================================
-- BSD-CRM — תיקון: כרטיס אנונימי שסומן "הפץ" לא הופיע לסוכן מורשה
-- תאריך: 16/08/2026
-- ============================================================================
-- הבעיה: ה-VIEW businesses_anonymous_card (מ-2026-08-15b) נוצר עם
-- security_invoker = true. המשמעות: ה-VIEW רץ עם ההרשאות של המשתמש
-- שמריץ את השאילתה - כולל ה-RLS של הטבלה הבסיסית businesses. באותה
-- מיגרציה בדיוק הידקתי את RLS של businesses כך שהיא מחזירה רק גישה
-- מלאה (has_full_business_access). התוצאה: גם אם עסק מסומן anon_card_
-- active=true, ה-RLS של הטבלה הבסיסית חוסם אותו לפני שהתנאי של ה-VIEW
-- עצמו בכלל נבדק - כי security_invoker גורם ל-VIEW "לרשת" את ההגבלה
-- של הטבלה שמתחתיו, במקום לפעול כשכבת גישה עצמאית. זה בדיוק ההפך
-- מהכוונה המקורית.
-- התיקון: security_invoker = false (ברירת המחדל של VIEW ב-Postgres) -
-- כך שה-VIEW רץ בהרשאות הבעלים שלו (עוקף את ה-RLS של businesses),
-- וה-WHERE שבתוך ה-VIEW עצמו הוא שכבת האבטחה היחידה - בדיוק כמו שתוכנן.
-- ============================================================================

drop view if exists businesses_anonymous_card;

create view businesses_anonymous_card
with (security_invoker = false) as
select
  b.id,
  b.field,
  b.category,
  b.subcategory,
  b.region,
  b.years_active,
  b.annual_revenue,
  b.operating_profit,
  b.net_profit,
  b.employees_count,
  b.short_description,
  case when b.anon_card_show_reason then b.sale_reason else null end as sale_reason,
  case when b.anon_card_show_price then b.asking_price else null end as asking_price,
  b.handled_by,
  b.anon_card_active,
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
