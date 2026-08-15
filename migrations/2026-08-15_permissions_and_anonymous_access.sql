-- ============================================================================
-- BSD-CRM — שדרוג הרשאות, עסקים אנונימיים, בקשת/שחרור מידע, RLS מרכזי
-- תאריך: 15/08/2026
-- הרצה: Supabase SQL Editor, בדיוק כמו migrations קודמים.
-- ============================================================================
-- ⚠️ לפני הרצה: ודא שיש גיבוי עדכני (Supabase Dashboard → Database → Backups,
-- או ייצוא ידני של הטבלאות businesses/leads/matches/profiles/activity_log
-- דרך Table Editor → Export CSV). המיגרציה הזו לא מוחקת נתונים קיימים,
-- אבל היא מוסיפה RLS על טבלאות שהיום פתוחות לגמרי — כדאי גיבוי לפני שינוי
-- כזה מהותי, כמדיניות קבועה.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. הרשאות פר-משתמש על profiles (מרחיב את הדפוס הקיים של can_record וכו')
--    ברירות המחדל למטה נבחרו כך שאף משתמש קיים לא "ננעל בחוץ" מיד אחרי
--    ההרצה: אדמין/מנהל ממשיכים לראות הכל; agent_authorized/agent קיימים
--    מקבלים ברירת מחדל שתתעדכן בפועל ידנית לפי הרמה (שלב 2 למטה).
-- ----------------------------------------------------------------------------
alter table profiles add column if not exists can_view_anonymous_businesses boolean not null default false;
alter table profiles add column if not exists can_create_businesses        boolean not null default false;
alter table profiles add column if not exists can_create_buyers            boolean not null default false;
alter table profiles add column if not exists can_use_survey               boolean not null default false;
alter table profiles add column if not exists can_use_sale_file            boolean not null default false;
-- can_record, can_send_agreement, can_send_presentations כבר קיימים.

-- ----------------------------------------------------------------------------
-- 2. עדכון ברירות מחדל למשתמשים קיימים לפי הרמה שלהם היום, כך שההתנהגות
--    בפועל לא תשתנה באופן מפתיע ברגע ההרצה (admin/manager לא מושפעים,
--    כי הם תמיד עוברים דרך full-access ב-RLS/permissions.js ולא דרך
--    הדגלים האלה בכלל).
-- ----------------------------------------------------------------------------
update profiles set
  can_view_anonymous_businesses = true,
  can_create_businesses = true,
  can_create_buyers = true
where role = 'agent_authorized';
-- role = 'agent' נשאר עם ברירת המחדל השמרנית (false/false) — אדמין יכול
-- להדליק ידנית לכל סוכן ספציפי דרך מסך users.html המעודכן.

-- ----------------------------------------------------------------------------
-- 3. שדות "כרטיס אנונימי" על businesses — נפרד מהמצגת האנונימית הקיימת
--    (anon_presentation_path/name, קובץ PDF מלא). זהו כרטיס מבוסס-שדות,
--    לא קובץ, שמוצג ברשימת "עסקים אנונימיים" ומוגדר במפורש מה מותר בו.
-- ----------------------------------------------------------------------------
alter table businesses add column if not exists anon_card_active         boolean not null default false;
alter table businesses add column if not exists anon_card_generated_by   uuid references profiles(id);
alter table businesses add column if not exists anon_card_generated_at   timestamptz;
alter table businesses add column if not exists anon_card_show_price     boolean not null default false;
alter table businesses add column if not exists anon_card_show_reason    boolean not null default false;

-- ----------------------------------------------------------------------------
-- 4. בקשות שחרור מידע ("בקש פרטים" בכרטיס האנונימי)
-- ----------------------------------------------------------------------------
create table if not exists business_access_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  requested_by uuid not null references profiles(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_reason text,
  requested_at timestamptz not null default now()
);
create index if not exists idx_bar_business on business_access_requests(business_id);
create index if not exists idx_bar_requested_by on business_access_requests(requested_by);

-- ----------------------------------------------------------------------------
-- 5. שחרור גישה בפועל (גם כתוצאה מאישור בקשה, וגם שחרור יזום ע"י מטפל/אדמין)
--    access_level: full_view = צפייה בכרטיס המלא בלבד; files = גם קבצים.
--    שחרור לא כולל עריכה כברירת מחדל (סעיף 7 באפיון שלך).
-- ----------------------------------------------------------------------------
create table if not exists business_access_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  granted_to uuid not null references profiles(id),
  granted_by uuid not null references profiles(id),
  access_level text not null default 'full_view' check (access_level in ('full_view','files')),
  source_request_id uuid references business_access_requests(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references profiles(id),
  active boolean generated always as (revoked_at is null) stored
);
create index if not exists idx_bag_business on business_access_grants(business_id);
create index if not exists idx_bag_granted_to on business_access_grants(granted_to);
create unique index if not exists uq_bag_active_grant on business_access_grants(business_id, granted_to) where active;

-- ----------------------------------------------------------------------------
-- 6. פונקציית עזר מרכזית ל-RLS: "האם למשתמש יש גישה מלאה לעסק הזה?"
--    admin/manager = תמיד. יוצר/מטפל = תמיד. גישה שוחררה במפורש = כן.
--    זו הפונקציה היחידה שקובעת ראייה מלאה — לא כפול לוגיקה בכל policy.
-- ----------------------------------------------------------------------------
create or replace function has_full_business_access(biz_id uuid, uid uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from profiles p where p.id = uid and p.role in ('admin','manager')
  )
  or exists (
    select 1 from businesses b where b.id = biz_id and (b.created_by = uid or b.handled_by = uid)
  )
  or exists (
    select 1 from business_access_grants g
    where g.business_id = biz_id and g.granted_to = uid and g.active
  );
$$;

-- ----------------------------------------------------------------------------
-- 7. RLS על businesses. שים לב: SELECT מחזיר עכשיו רק שורות שמותר לראות —
--    דף שיציג "רשימת עסקים אנונימיים" צריך select על עמודות הכרטיס
--    האנונימי בלבד (זה נאכף גם באפליקציה, ה-RLS כאן מגן על השורה כולה
--    ברמת ה-DB; הפרדת עמודות מזהות מתבצעת בשכבת האפליקציה + view נפרד
--    בשלב הבא אם תרצה חיזוק נוסף ברמת ה-DB).
-- ----------------------------------------------------------------------------
alter table businesses enable row level security;

drop policy if exists "businesses_select" on businesses;
create policy "businesses_select" on businesses for select using (
  has_full_business_access(id, auth.uid())
  or (
    anon_card_active
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
  )
);

drop policy if exists "businesses_insert" on businesses;
create policy "businesses_insert" on businesses for insert with check (
  exists (select 1 from profiles p where p.id = auth.uid() and (p.role in ('admin','manager') or p.can_create_businesses))
);

drop policy if exists "businesses_update" on businesses;
create policy "businesses_update" on businesses for update using (
  has_full_business_access(id, auth.uid())
);

drop policy if exists "businesses_delete" on businesses;
create policy "businesses_delete" on businesses for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);

-- ----------------------------------------------------------------------------
-- 8. RLS על leads (קונים/מוכרים/שותפים). "שלי" = created_by או handled_by.
-- ----------------------------------------------------------------------------
alter table leads enable row level security;

drop policy if exists "leads_select" on leads;
create policy "leads_select" on leads for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  or created_by = auth.uid() or handled_by = auth.uid()
);

drop policy if exists "leads_insert" on leads;
create policy "leads_insert" on leads for insert with check (
  exists (select 1 from profiles p where p.id = auth.uid() and (p.role in ('admin','manager') or p.can_create_buyers))
);

drop policy if exists "leads_update" on leads;
create policy "leads_update" on leads for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  or created_by = auth.uid() or handled_by = auth.uid()
);

drop policy if exists "leads_delete" on leads;
create policy "leads_delete" on leads for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);

-- ----------------------------------------------------------------------------
-- 9. RLS על matches — "שלי" = יוצר/מטפל של העסק או של הקונה בהתאמה.
-- ----------------------------------------------------------------------------
alter table matches enable row level security;

drop policy if exists "matches_select" on matches;
create policy "matches_select" on matches for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  or has_full_business_access(business_id, auth.uid())
  or exists (select 1 from leads l where l.id = buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
);

drop policy if exists "matches_insert" on matches;
create policy "matches_insert" on matches for insert with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  or has_full_business_access(business_id, auth.uid())
  or exists (select 1 from leads l where l.id = buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
);

drop policy if exists "matches_update" on matches;
create policy "matches_update" on matches for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  or has_full_business_access(business_id, auth.uid())
  or exists (select 1 from leads l where l.id = buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
);

-- ----------------------------------------------------------------------------
-- 10. RLS על profiles עצמו — משתמש רואה את עצמו תמיד; אדמין/מנהל רואים הכל;
--     כולם צריכים לראות שמות בסיסיים (id, full_name, role) של כולם לצורך
--     תפריטי "הוקצה ל-" בכל המערכת — לכן select פתוח על שדות זהות בלבד
--     דרך view נפרד (profiles_public) ולא על הטבלה המלאה.
-- ----------------------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists "profiles_select_self_or_admin" on profiles;
create policy "profiles_select_self_or_admin" on profiles for select using (
  id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);

drop policy if exists "profiles_update_self_or_admin" on profiles;
create policy "profiles_update_self_or_admin" on profiles for update using (
  id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);

create or replace view profiles_public as
  select id, full_name, email, role from profiles;
grant select on profiles_public to authenticated;

-- ----------------------------------------------------------------------------
-- 11. RLS על business_access_requests / business_access_grants
-- ----------------------------------------------------------------------------
alter table business_access_requests enable row level security;

drop policy if exists "bar_select" on business_access_requests;
create policy "bar_select" on business_access_requests for select using (
  requested_by = auth.uid()
  or has_full_business_access(business_id, auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);

drop policy if exists "bar_insert" on business_access_requests;
create policy "bar_insert" on business_access_requests for insert with check (requested_by = auth.uid());

drop policy if exists "bar_update" on business_access_requests;
create policy "bar_update" on business_access_requests for update using (
  requested_by = auth.uid() -- לאפשר "ביטול" ע"י המבקש עצמו
  or has_full_business_access(business_id, auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);

alter table business_access_grants enable row level security;

drop policy if exists "bag_select" on business_access_grants;
create policy "bag_select" on business_access_grants for select using (
  granted_to = auth.uid()
  or has_full_business_access(business_id, auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);

drop policy if exists "bag_insert" on business_access_grants;
create policy "bag_insert" on business_access_grants for insert with check (
  has_full_business_access(business_id, auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);

drop policy if exists "bag_update" on business_access_grants;
create policy "bag_update" on business_access_grants for update using (
  has_full_business_access(business_id, auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);

-- ============================================================================
-- הערה חשובה: לאחר הרצת המיגרציה הזו, businesses/leads/matches/profiles
-- יחזירו ב-select רק את מה שמותר לפי הכללים למעלה — גם אם קוד ה-JS הישן
-- עדיין מבקש select('*') בלי סינון צד-לקוח. זה בדיוק הרעיון (הגנה כפולה),
-- אבל זה גם אומר שמסכים שטרם עודכנו לעבוד עם permissions.js עלולים
-- להיראות "ריקים" לתפקידים לא-אדמין עד שהשלב הבא (עדכון הממשקים) יושלם.
-- מומלץ להריץ קודם על סביבת בדיקה / להריץ ואז מיד להמשיך לשלב הבא באותו
-- יום, לא להשאיר את המערכת במצב ביניים הזה לאורך זמן.
-- ============================================================================
