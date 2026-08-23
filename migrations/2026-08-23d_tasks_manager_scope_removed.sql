-- ============================================================================
-- BSD-CRM — tasks_select/update/delete: remove manager's full-visibility
-- override, admin only
-- תאריך: 23/08/2026
-- ============================================================================
-- אומת בפועל עם JWT אמיתי לפני השינוי: manager יכול היה לקרוא, לערוך
-- ולמחוק משימות של משתמשים אחרים (בדיוק כמו admin) - כי tasks_select/
-- update/delete כללו role IN ('admin','manager'). זה נסתר מאחורי השם
-- "tasks_select" וכו' - לכן הוצג כאן במפורש התנאי המלא לפני כל שינוי,
-- כפי שנדרש, ולא הונח דבר על סמך שם המדיניות.
--
-- לפי הדרישה המפורשת: רק admin רואה/מנהל את כל המשימות של כולם. manager,
-- בדיוק כמו משתמש רגיל, רואה/מנהל רק משימות שהוא assigned_to שלהן.
-- (tasks_insert כבר תוקן לאותו עיקרון קודם לכן, ב-2026-08-23c.)
-- ============================================================================

drop policy if exists "tasks_select" on tasks;
create policy "tasks_select" on tasks for select using (
  assigned_to = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "tasks_update" on tasks;
create policy "tasks_update" on tasks for update using (
  assigned_to = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "tasks_delete" on tasks;
create policy "tasks_delete" on tasks for delete using (
  assigned_to = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- כל 4 המדיניות על tasks (select/insert/update/delete) עכשיו עקביות:
-- assigned_to = auth.uid() OR role = 'admin' בלבד.
