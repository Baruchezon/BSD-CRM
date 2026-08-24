-- ============================================================================
-- BSD-CRM — שחרור קונים/משקיעים לצפייה למשתמשים נבחרים (lead_access_grants)
-- תאריך: 23-24/08/2026 — גרסה סופית כפי שהוחלה בפועל בפרודקשן ואומתה
--
-- מודל הרשאות עסקי (מאושר סעיף אחר סעיף, 24.08.2026):
-- 1) רק created_by של buyer/partner, או אדמין (is_admin() בלבד — לא manager,
--    לא handled_by), רואים/יוצרים/מבטלים הרשאת שחרור על אותו כרטיס.
-- 2) leads_select/leads_update/leads_delete מפוצלות לפי type: seller ממשיך
--    בדיוק כמו לפני (admin/manager/created_by/handled_by) — ללא רגרסיה.
--    buyer/partner מקבל את המודל המחמיר: is_admin() בלבד + created_by.
-- 3) granted_by/granted_at/revoked_by נאכפים בשרת בלבד (טריגר דורס כל ערך
--    מהלקוח). lead_id/granted_to/granted_by/granted_at אינם ניתנים לשינוי
--    לאחר יצירה. ביטול (revoked_at) הוא חד-כיווני - אי אפשר לשחזר.
-- 4) משתמש עם grant רואה רק את השורה שלו ב-lead_access_grants, לא רשימת
--    מי עוד שוחרר.
-- 5) manager לא מקבל שום גישה כללית בשום חלק מהמנגנון הזה (is_admin() בכל
--    מקום, לא is_admin_or_manager()).
-- 6) leads_update/leads_delete גם הן מוגבלות ל-created_by/is_admin() עבור
--    buyer/partner (מנהל מאבד עריכה/מחיקה כללית על buyer/partner, שומר על
--    seller ללא שינוי).
-- 7) הרשאות טבלה/EXECUTE מוקשחות: REVOKE מ-PUBLIC/anon בכל מקום, GRANT
--    ממוקד ומינימלי ל-authenticated בלבד. search_path קבוע על כל פונקציית
--    security definer.
--
-- ⚠️ תיקון אבטחה שבוצע בנפרד (24.08.2026, אומת בפרודקשן): גרסה קודמת של
-- has_lead_view_access קיבלה p_uid כפרמטר חיצוני, מה שאיפשר קריאה אנונימית
-- ישירה (RPC, ללא JWT) עם p_uid של משתמש אחר ולקבל מידע אמיתי על שיוך/הרשאה
-- שלו. הוכח בפועל מול production לפני התיקון (anon קיבל תשובה אמיתית).
-- תוקן: הפונקציה מקבלת רק p_lead_id ומשתמשת ב-auth.uid() באופן פנימי בלבד.
-- כמו כן anon קיבל הרשאות טבלה/EXECUTE מלאות על 3 האובייקטים החדשים בירושת
-- ברירת מחדל של הפרויקט, ללא צידוק עסקי - הוסר במלואו (revoke all ... from
-- public, anon), ואומת אחרי: anon מקבל permission denied על כל הפונקציות
-- וכן 0 שורות הרשאה על 3 הטבלאות.
--
-- נבדק ואומת: 8 תרחישים מול replica מקומי (23.08), ואז מול production בפועל
-- (23-24.08) עם משתמשים אמיתיים/JWT אמיתי: יוצר/אדמין ללא שינוי, חסימת
-- משתמש ללא הרשאה (כולל direct-by-id), שחרור מדויק, ביטול מיידי, self-grant
-- לא מורשה חסום ע"י RLS, עריכה חסומה למשתמש עם view_card בלבד, scope לא
-- רשום נדחה. תיקון האבטחה עצמו אומת בנפרד: פונקציה ישנה נמחקה (0 תלויות
-- בקטלוג pg_depend לפני מחיקה), 0 הרשאות anon אחרי, exploit חוזר נכשל
-- (permission denied).
-- ============================================================================

create table if not exists lead_access_scope_types (
  level_key text primary key,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0
);
insert into lead_access_scope_types (level_key, name, sort_order) values
  ('view_card', 'צפייה בכרטיס', 1)
on conflict (level_key) do nothing;

create table if not exists lead_access_grants (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  granted_to uuid not null references profiles(id),
  granted_by uuid not null references profiles(id),
  scopes text[] not null default '{view_card}',
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references profiles(id),
  active boolean generated always as (revoked_at is null) stored
);
create index if not exists idx_lag_lead on lead_access_grants(lead_id);
create index if not exists idx_lag_granted_to on lead_access_grants(granted_to);
create unique index if not exists uq_lag_active_grant on lead_access_grants(lead_id, granted_to) where active;

create table if not exists lead_access_audit (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  target_user uuid references profiles(id),
  change_type text not null,
  scopes_before text[],
  scopes_after text[],
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists idx_laa_lead on lead_access_audit(lead_id);
create index if not exists idx_laa_target_user on lead_access_audit(target_user);

-- החלטה 4: אכיפת זהות בצד שרת + חסינות משינוי + ביטול חד-כיווני.
create or replace function enforce_lead_grant_identity()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.granted_by := auth.uid();
    new.granted_at := now();
    return new;
  elsif tg_op = 'UPDATE' then
    if new.lead_id is distinct from old.lead_id
       or new.granted_to is distinct from old.granted_to
       or new.granted_by is distinct from old.granted_by
       or new.granted_at is distinct from old.granted_at then
      raise exception 'לא ניתן לשנות lead_id/granted_to/granted_by/granted_at לאחר יצירת הרשאה';
    end if;
    if old.revoked_at is not null and new.revoked_at is null then
      raise exception 'לא ניתן לשחזר הרשאה מבוטלת — יש ליצור הרשאה חדשה';
    end if;
    if old.revoked_at is null and new.revoked_at is not null then
      new.revoked_by := auth.uid();
    end if;
    return new;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_enforce_lead_grant_identity on lead_access_grants;
create trigger trg_enforce_lead_grant_identity
  before insert or update on lead_access_grants
  for each row execute function enforce_lead_grant_identity();

create or replace function enforce_lead_access_scopes()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from unnest(new.scopes) s
    where s not in (select level_key from lead_access_scope_types where is_active)
  ) then
    raise exception 'scope לא תקין: %', new.scopes;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_enforce_lead_access_scopes on lead_access_grants;
create trigger trg_enforce_lead_access_scopes
  before insert or update on lead_access_grants
  for each row execute function enforce_lead_access_scopes();

create or replace function bsd_log_lead_grant_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    insert into lead_access_audit(lead_id, target_user, change_type, scopes_before, scopes_after, changed_by)
    values (new.lead_id, new.granted_to, 'grant_created', '{}', new.scopes, new.granted_by);
  elsif (tg_op = 'UPDATE') then
    if (old.scopes is distinct from new.scopes) or (old.revoked_at is distinct from new.revoked_at) then
      insert into lead_access_audit(lead_id, target_user, change_type, scopes_before, scopes_after, changed_by)
      values (
        new.lead_id, new.granted_to,
        case when new.revoked_at is not null and old.revoked_at is null then 'revoked' else 'scopes_changed' end,
        case when old.revoked_at is not null then '{}' else old.scopes end,
        case when new.revoked_at is not null then '{}' else new.scopes end,
        coalesce(new.revoked_by, auth.uid())
      );
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_log_lead_grant_change on lead_access_grants;
create trigger trg_log_lead_grant_change
  after insert or update on lead_access_grants
  for each row execute function bsd_log_lead_grant_change();

-- החלטה 1 + תיקון אבטחה: is_admin() בלבד, created_by בלבד, ללא p_uid חיצוני.
-- אין DROP לגרסה הנוכחית (אותה חתימה) - רק לגרסה הישנה הפגיעה בת-שני-הפרמטרים.
drop function if exists has_lead_view_access(uuid, uuid);
create or replace function has_lead_view_access(p_lead_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select is_admin()
  or exists (select 1 from leads l where l.id = p_lead_id and l.created_by = auth.uid())
  or exists (
    select 1 from lead_access_grants g
    where g.lead_id = p_lead_id and g.granted_to = auth.uid() and g.active
      and 'view_card' = any(g.scopes)
  );
$$;

-- החלטה 2+6: leads_select/update/delete מפוצלות לפי type. seller = ללא שינוי.
drop policy if exists "leads_select" on leads;
create policy "leads_select" on leads for select using (
  is_admin()
  or (
    type = 'seller' and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'manager')
      or created_by = auth.uid()
      or handled_by = auth.uid()
    )
  )
  or (
    type in ('buyer','partner') and has_lead_view_access(id)
  )
);

drop policy if exists "leads_update" on leads;
create policy "leads_update" on leads for update using (
  is_admin()
  or (
    type = 'seller' and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'manager')
      or created_by = auth.uid()
      or handled_by = auth.uid()
    )
  )
  or (
    type in ('buyer','partner') and created_by = auth.uid()
  )
);

drop policy if exists "leads_delete" on leads;
create policy "leads_delete" on leads for delete using (
  is_admin()
  or (
    type = 'seller' and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'manager')
  )
);
-- leads_insert: ללא שינוי כלל, לא מופיעה כאן.

-- החלטה 3: lag_select/insert/update - רק created_by או admin.
alter table lead_access_grants enable row level security;
drop policy if exists "lag_select" on lead_access_grants;
create policy "lag_select" on lead_access_grants for select using (
  granted_to = auth.uid()
  or exists (select 1 from leads l where l.id = lead_id and l.created_by = auth.uid())
  or is_admin()
);
drop policy if exists "lag_insert" on lead_access_grants;
create policy "lag_insert" on lead_access_grants for insert with check (
  exists (select 1 from leads l where l.id = lead_id and l.created_by = auth.uid())
  or is_admin()
);
drop policy if exists "lag_update" on lead_access_grants;
create policy "lag_update" on lead_access_grants for update using (
  exists (select 1 from leads l where l.id = lead_id and l.created_by = auth.uid())
  or is_admin()
);

-- החלטה 5: is_admin() בכל מקום, לא is_admin_or_manager().
alter table lead_access_scope_types enable row level security;
drop policy if exists "lst_select_all" on lead_access_scope_types;
create policy "lst_select_all" on lead_access_scope_types for select using (auth.uid() is not null);
drop policy if exists "lst_admin_manage" on lead_access_scope_types;
create policy "lst_admin_manage" on lead_access_scope_types for all using (is_admin()) with check (is_admin());

alter table lead_access_audit enable row level security;
drop policy if exists "laa_select" on lead_access_audit;
create policy "laa_select" on lead_access_audit for select using (
  target_user = auth.uid()
  or exists (select 1 from leads l where l.id = lead_id and l.created_by = auth.uid())
  or is_admin()
);

-- ============================================================================
-- החלטה 7 + תיקון אבטחה: הקשחת הרשאות - אין שימוש עסקי אנונימי, REVOKE
-- מ-PUBLIC/anon על הכל, GRANT ממוקד ומינימלי בלבד ל-authenticated.
-- ============================================================================
revoke all on lead_access_grants, lead_access_audit, lead_access_scope_types from public, anon;
grant select, insert, update, delete on lead_access_grants to authenticated;
grant select, delete on lead_access_audit to authenticated;
grant select, insert, update, delete on lead_access_scope_types to authenticated;

revoke all on function enforce_lead_access_scopes() from public, anon, authenticated;
revoke all on function bsd_log_lead_grant_change() from public, anon, authenticated;
revoke all on function enforce_lead_grant_identity() from public, anon, authenticated;
revoke all on function has_lead_view_access(uuid) from public, anon;
grant execute on function has_lead_view_access(uuid) to authenticated;

-- ============================================================================
-- הערה: leads תחזיר ב-select בדיוק את אותן שורות כמו לפני עבור seller,
-- ומודל מחמיר עבור buyer/partner (created_by/admin/grant בלבד).
-- ============================================================================
