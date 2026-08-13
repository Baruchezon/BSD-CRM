-- ============================================================================
-- BSD-CRM — שלב 1: תיק תהליך התאמה (Migration בטוח)
-- תאריך: 13/08/2026
-- הרצה: Supabase SQL Editor, כמו כל migration קודם בפרויקט.
-- כל השורות "add column if not exists" — לא נוגעות בעמודות/נתונים קיימים.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. עמודות חדשות בטבלת matches (הכול NULLABLE, לא שובר כלום קיים)
-- ---------------------------------------------------------------------------
alter table matches add column if not exists disclosure_level smallint default 1;
alter table matches add column if not exists last_action text;
alter table matches add column if not exists last_action_at timestamptz;
alter table matches add column if not exists next_action text;
alter table matches add column if not exists next_action_at timestamptz;
alter table matches add column if not exists next_action_owner uuid references profiles(id);
alter table matches add column if not exists drop_reason_category text;

comment on column matches.disclosure_level is 'רמת חשיפה: 1=אנונימי, 2=מורחב, 3=מלא';

-- ---------------------------------------------------------------------------
-- 2. עמודות חדשות בטבלת tasks (קישור ישיר להתאמה/עסק/קונה, בנוסף ל-related_type/related_id הקיימים שנשארים כמות שהם לשימושים אחרים כמו training_leads)
-- ---------------------------------------------------------------------------
alter table tasks add column if not exists match_id uuid references matches(id);
alter table tasks add column if not exists business_id uuid references businesses(id);
alter table tasks add column if not exists buyer_id uuid references leads(id);
alter table tasks add column if not exists source text default 'manual';

-- ---------------------------------------------------------------------------
-- 3. טבלת audit_log (חדשה) — מי שינה מה, מתי
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null,           -- 'status_change' | 'delete' | 'edit_summary' | 'send_material' | 'change_handler' | 'sensitive_override' | ...
  actor_id uuid references profiles(id),
  occurred_at timestamptz not null default now(),
  details jsonb
);
create index if not exists idx_audit_log_record on audit_log(table_name, record_id);
create index if not exists idx_audit_log_actor on audit_log(actor_id);

-- ---------------------------------------------------------------------------
-- 4. RLS — matches
-- ⚠️ לפני הרצת הבלוק הזה: יש לוודא שהאפליקציה כרגע לא סומכת על אף שאילתה
--    שתישבר ע"י RLS (בדקתי בקוד את התרחישים הקיימים, אך מומלץ לגבות/לבדוק
--    בסביבת בדיקה קודם אם אפשרי).
-- ---------------------------------------------------------------------------
alter table matches enable row level security;

drop policy if exists "admin_manager_full_access_matches" on matches;
create policy "admin_manager_full_access_matches" on matches
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  );

drop policy if exists "agent_authorized_view_all_matches" on matches;
create policy "agent_authorized_view_all_matches" on matches
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'agent_authorized')
  );

drop policy if exists "agent_authorized_edit_own_matches" on matches;
create policy "agent_authorized_edit_own_matches" on matches
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'agent_authorized')
    and created_by = auth.uid()
  );

drop policy if exists "agent_authorized_insert_matches" on matches;
create policy "agent_authorized_insert_matches" on matches
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'agent_authorized')
  );

drop policy if exists "agent_own_only_matches" on matches;
create policy "agent_own_only_matches" on matches
  for select using (
    exists (select 1 from businesses b where b.id = matches.business_id and b.created_by = auth.uid())
    or exists (select 1 from leads l where l.id = matches.buyer_id and l.created_by = auth.uid())
  );

drop policy if exists "agent_insert_matches" on matches;
create policy "agent_insert_matches" on matches
  for insert with check (
    exists (select 1 from businesses b where b.id = matches.business_id and b.created_by = auth.uid())
    or exists (select 1 from leads l where l.id = matches.buyer_id and l.created_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 5. RLS — audit_log (כולם יכולים להוסיף רשומת ביקורת; רק admin/manager קוראים)
-- ---------------------------------------------------------------------------
alter table audit_log enable row level security;

drop policy if exists "anyone_can_insert_audit" on audit_log;
create policy "anyone_can_insert_audit" on audit_log
  for insert with check (auth.uid() is not null);

drop policy if exists "admin_manager_read_audit" on audit_log;
create policy "admin_manager_read_audit" on audit_log
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  );

-- ---------------------------------------------------------------------------
-- 6. RLS — match_status_history, match_participants (קיימות, כרגע ללא RLS)
--    מיישרים לאותו דפוס הרשאות כמו matches, כדי שהתיק לא "יזלוג" מידע
--    דרך טבלאות עזר גם אם matches עצמה מוגנת.
-- ---------------------------------------------------------------------------
alter table match_status_history enable row level security;

drop policy if exists "follow_parent_match_history" on match_status_history;
create policy "follow_parent_match_history" on match_status_history
  for all using (
    exists (
      select 1 from matches m
      join profiles p on p.id = auth.uid()
      where m.id = match_status_history.match_id
      and (
        p.role in ('admin','manager','agent_authorized')
        or exists (select 1 from businesses b where b.id = m.business_id and b.created_by = auth.uid())
        or exists (select 1 from leads l where l.id = m.buyer_id and l.created_by = auth.uid())
      )
    )
  );

alter table match_participants enable row level security;

drop policy if exists "follow_parent_match_participants" on match_participants;
create policy "follow_parent_match_participants" on match_participants
  for all using (
    exists (
      select 1 from matches m
      join profiles p on p.id = auth.uid()
      where m.id = match_participants.match_id
      and (
        p.role in ('admin','manager','agent_authorized')
        or exists (select 1 from businesses b where b.id = m.business_id and b.created_by = auth.uid())
        or exists (select 1 from leads l where l.id = m.buyer_id and l.created_by = auth.uid())
      )
    )
  );

-- ============================================================================
-- הערה חשובה: RLS על tasks/businesses/leads/record_notes לא נכלל כאן —
-- אלה טבלאות בשימוש פעיל רחב שהאפליקציה כבר מסננת ב-JS. הפעלת RLS עליהן
-- דורשת בדיקה נפרדת וזהירה יותר (לא רוצים לשבור מסך קיים). מומלץ כצעד
-- הבא, לאחר שנוודא ש-matches עצמה עובדת נכון בפרודקשן.
-- ============================================================================
