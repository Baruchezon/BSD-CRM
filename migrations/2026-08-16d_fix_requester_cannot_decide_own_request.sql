-- ============================================================================
-- BSD-CRM — תיקון: מבקש גישה יכל לראות (ובפועל גם לאשר) את הבקשה של עצמו
-- תאריך: 16/08/2026
-- ============================================================================
-- הבעיה: bar_update (מ-2026-08-15) אפשרה למבקש עצמו (requested_by = auth.uid())
-- לעדכן את הבקשה שלו ללא הגבלה על השדה status - הכוונה המקורית הייתה
-- לאפשר לו רק "לבטל" (status='cancelled'), אבל בפועל שום דבר לא מנע ממנו
-- לשנות ישירות ל-status='approved' דרך קריאת API, ובנוסף הממשק הציג לו את
-- כפתורי אשר/דחה על הבקשה של עצמו כי הוא הציג אותם לכל בקשה pending בלי
-- לבדוק מי המחליט המורשה בפועל. בשני המקומות זו אותה טעות: לא הפרדנו בין
-- "המבקש יכול לבטל" לבין "המטפל/אדמין/מנהל יכולים להחליט".
-- ============================================================================

drop policy if exists "bar_update" on business_access_requests;

-- המבקש עצמו יכול אך ורק לבטל (status -> cancelled) את הבקשה שלו - לעולם לא
-- לאשר/לדחות אותה, גם אם באיזשהו תרחיש יש לו הרשאה מלאה לעסק עצמו
create policy "bar_requester_can_cancel" on business_access_requests for update using (
  requested_by = auth.uid()
) with check (
  requested_by = auth.uid() and status = 'cancelled'
);

-- החלטה (אישור/דחייה) - רק אדמין/מנהל, או יוצר/מטפל של העסק הספציפי -
-- ולעולם לא המבקש עצמו, גם אם הוא איכשהו גם בעל גישה מלאה לעסק
create policy "bar_decide_not_requester" on business_access_requests for update using (
  requested_by <> auth.uid()
  and (
    has_full_business_access(business_id, auth.uid())
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  )
);
