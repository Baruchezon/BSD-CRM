-- ============================================================================
-- BSD-CRM — הקלטות כלליות (ללא עסק/קונה/התאמה) תחת "כלים"
-- תאריך: 13/08/2026
-- ============================================================================

-- כאשר match_id, business_id ו-buyer_id כולם ריקים (הקלטה כללית מ"כלים"),
-- מדיניות ה-RLS הקיימת על match_meetings (שמסתמכת על business_id/buyer_id)
-- לא הייתה מכסה אותה עבור agent רגיל. מוסיפים מדיניות נוספת: כל משתמש
-- (מכל תפקיד) תמיד יכול לראות/לערוך הקלטות שהוא עצמו יצר.
alter table match_meetings add column if not exists title text;

drop policy if exists "own_created_meetings" on match_meetings;
create policy "own_created_meetings" on match_meetings
  for all using (created_by = auth.uid());
