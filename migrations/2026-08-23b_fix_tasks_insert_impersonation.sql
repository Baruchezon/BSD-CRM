-- ============================================================================
-- BSD-CRM — FIX: tasks_insert allowed assigning a task to ANY other user
-- תאריך: 23/08/2026
-- ============================================================================
-- לפני התיקון: tasks_insert with_check היה רק auth.uid() IS NOT NULL - כל
-- משתמש מחובר (כולל משתמש רגיל) יכול היה להכניס משימה עם assigned_to של
-- משתמש אחר לגמרי. זה לא נתפס מיד כי עם Prefer: return=representation
-- (הבחירה הנפוצה יותר בקוד קיים) הבקשה נכשלת - לא כי ה-INSERT עצמו נחסם,
-- אלא כי PostgREST לא מצליח להחזיר שורה שהמכניס לא רשאי לקרוא לפי
-- tasks_select. עם Prefer: return=minimal (גם היא אופציה לגיטימית ונפוצה)
-- ה-INSERT הצליח ונשמר בשקט - אומת ישירות מול פרודקשן.
--
-- אחרי התיקון: משתמש רגיל יכול להכניס משימה רק עם assigned_to = עצמו.
-- admin/manager יכולים להכניס משימה עם assigned_to של כל משתמש (כולל
-- הקצאה למשתמש אחר) - בדיוק כמו ביתר הפעולות על tasks.
-- ============================================================================

drop policy if exists "tasks_insert" on tasks;
create policy "tasks_insert" on tasks for insert with check (
  assigned_to = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);
