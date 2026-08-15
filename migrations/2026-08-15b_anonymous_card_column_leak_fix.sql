-- ============================================================================
-- BSD-CRM — תיקון: מניעת דליפת עמודות מזהות למשתמשי "צפייה אנונימית"
-- תאריך: 15/08/2026 (המשך אותו יום, לפני בניית ממשק העסקים האנונימיים)
-- ============================================================================
-- הבעיה: המדיניות המקורית (businesses_select) החזירה את השורה המלאה גם
-- למשתמש שמורשה לראות רק כרטיס אנונימי (RLS מסנן שורות, לא עמודות) —
-- כלומר שם הבעלים/טלפון/מייל היו מגיעים לדפדפן ורק מוסתרים בממשק.
-- התיקון: businesses_select מחזיר מעכשיו רק גישה מלאה אמיתית; לצפייה
-- אנונימית יש VIEW נפרד עם רשימת עמודות מפורשת וסגורה, שמחשב בעצמו את
-- ההרשאה (במקום להסתמך על RLS של הטבלה הבסיסית).
-- ============================================================================

drop policy if exists "businesses_select" on businesses;
create policy "businesses_select" on businesses for select using (
  has_full_business_access(id, auth.uid())
);

create or replace view businesses_anonymous_card
with (security_invoker = true) as
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

-- ============================================================================
-- הערה: לוודא בממשק (businesses.html וכו') שרשימת "עסקים אנונימיים" נשלפת
-- מ-businesses_anonymous_card ולא מהטבלה businesses עצמה. שליפה מהטבלה
-- businesses תחזיר מעכשיו אך ורק עסקים שיש למשתמש גישה מלאה אליהם -
-- כלומר אם קוד ישן עדיין מצפה לראות עסקים אנונימיים דרך שאילתה על
-- businesses הוא פשוט לא יראה אותם יותר (לא שגיאה, רשימה חסרה).
-- ============================================================================
