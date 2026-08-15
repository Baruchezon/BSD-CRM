-- ============================================================================
-- BSD-CRM — תיקון: מדיניות RLS ישנה על matches עדיין פעילה במקביל לחדשה
-- + הוספת RLS לטבלת tasks (לפי המודל שאישרת: כל אחד רואה את המשימות שלו,
-- אדמין/מנהל רואים הכל)
-- תאריך: 15/08/2026
-- ============================================================================
-- הבעיה שנמצאה: migrations/2026-08-13_stage1_match_process_file.sql יצרה
-- מדיניות RLS בשמות admin_manager_full_access_matches/agent_authorized_
-- view_all_matches/וכו', שנתנו ל-agent_authorized גישה לכל ההתאמות במערכת.
-- migrations/2026-08-15_permissions_and_anonymous_access.sql יצרה מדיניות
-- חדשה בשם matches_select/matches_insert/matches_update - אבל מדיניות RLS
-- מאותו סוג (select/insert/וכו') הן PERMISSIVE כברירת מחדל, כלומר הן
-- מתחברות ב-OR, לא מחליפות אחת את השנייה. המדיניות הישנה (הרחבה) נשארה
-- פעילה במקביל לחדשה (הצרה), כך שבפועל agent_authorized עדיין ראה הכל -
-- למרות שהקוד בצד לקוח (matches.html) כבר עודכן. מוחק את הישנות כאן.
-- ============================================================================

drop policy if exists "admin_manager_full_access_matches" on matches;
drop policy if exists "agent_authorized_view_all_matches" on matches;
drop policy if exists "agent_authorized_edit_own_matches" on matches;
drop policy if exists "agent_authorized_insert_matches" on matches;
drop policy if exists "agent_own_only_matches" on matches;
drop policy if exists "agent_insert_matches" on matches;
-- matches_select/matches_insert/matches_update (מ-2026-08-15) כבר מכסות את כל
-- המקרים הנדרשים: admin/manager, has_full_business_access על העסק, או בעלות/
-- טיפול בקונה - ולכן הן היחידות שנשארות פעילות על matches.

-- ---------------------------------------------------------------------------
-- RLS על tasks - לפי מה שאישרת: "משימות לכל משתמש המשימות שלו, אדמין רואה
-- הכל". מוסיף גם manager לצד admin, ליישור עם אותה קונבנציה שקיימת בכל
-- שאר המערכת (businesses/leads/matches) - אם תרצה שמנהל לא יראה הכל, תגיד
-- ואני אצמצם.
-- ---------------------------------------------------------------------------
alter table tasks enable row level security;

drop policy if exists "tasks_select" on tasks;
create policy "tasks_select" on tasks for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  or assigned_to = auth.uid()
);

drop policy if exists "tasks_insert" on tasks;
create policy "tasks_insert" on tasks for insert with check (auth.uid() is not null);

drop policy if exists "tasks_update" on tasks;
create policy "tasks_update" on tasks for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  or assigned_to = auth.uid()
);

drop policy if exists "tasks_delete" on tasks;
create policy "tasks_delete" on tasks for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  or assigned_to = auth.uid()
);
