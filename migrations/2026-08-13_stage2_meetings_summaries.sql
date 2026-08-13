-- ============================================================================
-- BSD-CRM — שלב 2: פגישות, משתתפים, סיכומים (Migration בטוח)
-- תאריך: 13/08/2026
-- הרצה: Supabase SQL Editor, בדיוק כמו migration שלב 1.
-- כל השורות "create table if not exists" / "add column if not exists" —
-- לא נוגעות בטבלאות/נתונים קיימים.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. match_meetings — שיחה/פגישה בודדת בתוך התאמה
-- ---------------------------------------------------------------------------
create table if not exists match_meetings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id),
  business_id uuid references businesses(id),
  buyer_id uuid references leads(id),
  meeting_type text,                    -- שיחת טלפון / שיחת וידאו / פגישה / פגישת נתונים / פגישת המשך / פגישת מו"מ / שיחה פנימית / אחר
  meeting_date date,
  start_time time,
  end_time time,
  location text,
  agent_id uuid references profiles(id),
  summary_text text,
  decisions text,
  open_questions text,
  requested_documents text,
  next_action text,
  suggested_status text,
  status text default 'טיוטה',          -- טיוטה / סופי
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id)
);
create index if not exists idx_match_meetings_match on match_meetings(match_id);

-- ---------------------------------------------------------------------------
-- 2. meeting_participants — מי נכח בפגישה (מבנה מסודר, לא טקסט חופשי)
-- ---------------------------------------------------------------------------
create table if not exists meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references match_meetings(id) on delete cascade,
  participant_type text not null,       -- קונה / בעל עסק / סוכן / עורך דין / רואה חשבון / אחר
  linked_record_type text,              -- 'lead' | 'profile' | null (כשאין שיוך)
  linked_record_id uuid,
  free_text_name text                   -- כשאין רשומה קיימת לקשר אליה
);
create index if not exists idx_meeting_participants_meeting on meeting_participants(meeting_id);

-- ---------------------------------------------------------------------------
-- 3. meeting_summary_versions — היסטוריית גרסאות לעריכת סיכום (סעיף 13)
-- ---------------------------------------------------------------------------
create table if not exists meeting_summary_versions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references match_meetings(id) on delete cascade,
  version_number int not null,
  snapshot jsonb not null,              -- תמונת מצב מלאה של שדות הסיכום בזמן השמירה
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists idx_meeting_summary_versions_meeting on meeting_summary_versions(meeting_id);

-- ---------------------------------------------------------------------------
-- 4. עמודה חדשה בטבלת profiles — "שלח לי עותק של סיכומי פגישות למייל" (סעיף 18)
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists send_me_meeting_summaries boolean default false;

-- ---------------------------------------------------------------------------
-- 5. RLS — match_meetings, meeting_participants, meeting_summary_versions
--    אותו דפוס הרשאות כמו matches: admin/manager הכול, agent_authorized הכול
--    (עריכה רק בשלו), agent רק מה ששייך לעסק/קונה שהוא יצר.
-- ---------------------------------------------------------------------------
alter table match_meetings enable row level security;

drop policy if exists "admin_manager_full_access_meetings" on match_meetings;
create policy "admin_manager_full_access_meetings" on match_meetings
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  );

drop policy if exists "agent_authorized_view_all_meetings" on match_meetings;
create policy "agent_authorized_view_all_meetings" on match_meetings
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'agent_authorized')
  );

drop policy if exists "agent_authorized_edit_own_meetings" on match_meetings;
create policy "agent_authorized_edit_own_meetings" on match_meetings
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'agent_authorized')
  );
drop policy if exists "agent_authorized_update_own_meetings" on match_meetings;
create policy "agent_authorized_update_own_meetings" on match_meetings
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'agent_authorized')
    and created_by = auth.uid()
  );

drop policy if exists "agent_own_only_meetings" on match_meetings;
create policy "agent_own_only_meetings" on match_meetings
  for all using (
    exists (select 1 from businesses b where b.id = match_meetings.business_id and b.created_by = auth.uid())
    or exists (select 1 from leads l where l.id = match_meetings.buyer_id and l.created_by = auth.uid())
  );

alter table meeting_participants enable row level security;
drop policy if exists "follow_parent_meeting_participants" on meeting_participants;
create policy "follow_parent_meeting_participants" on meeting_participants
  for all using (
    exists (
      select 1 from match_meetings mm
      join profiles p on p.id = auth.uid()
      where mm.id = meeting_participants.meeting_id
      and (
        p.role in ('admin','manager','agent_authorized')
        or exists (select 1 from businesses b where b.id = mm.business_id and b.created_by = auth.uid())
        or exists (select 1 from leads l where l.id = mm.buyer_id and l.created_by = auth.uid())
      )
    )
  );

alter table meeting_summary_versions enable row level security;
drop policy if exists "follow_parent_summary_versions" on meeting_summary_versions;
create policy "follow_parent_summary_versions" on meeting_summary_versions
  for all using (
    exists (
      select 1 from match_meetings mm
      join profiles p on p.id = auth.uid()
      where mm.id = meeting_summary_versions.meeting_id
      and (
        p.role in ('admin','manager','agent_authorized')
        or exists (select 1 from businesses b where b.id = mm.business_id and b.created_by = auth.uid())
        or exists (select 1 from leads l where l.id = mm.buyer_id and l.created_by = auth.uid())
      )
    )
  );
