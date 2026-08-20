-- ============================================================================
-- BSD-CRM — מנגנון הפצה והרשאות מלא לעסקים (none/anonymous/full per user)
-- תאריך: 20/08/2026
-- ============================================================================
-- לפני הרצה: בוצע גיבוי לוגי (pg_dump) של businesses ו-business_access_grants
-- לפני שינוי ה-RLS, כמדיניות קבועה. הבדיקה שלפני המיגרציה (context, לא לוגיקה)
-- הראתה: 29 עסקים (15 עם anon_card_active=true), 4 שורות business_access_grants
-- (כולן access_level='full_view'), 3 סוכנים מורשים, 2 סוכנים רגילים, 1 אדמין.
--
-- המודל החדש (מוחלף במקום anon_card_active + can_view_anonymous_businesses
-- כמנגנון ההרשאה, לא כשדות תוכן):
--   businesses.distribution_status:
--     'not_distributed' (ברירת מחדל) — לא רואה אף אחד חוץ מיוצר/מטפל/אדמין.
--     'all_authorized'  — כל סוכן מורשה (role='agent_authorized') מקבל
--                          אוטומטית גישה ברמת 'anonymous'. גישה מלאה עדיין
--                          דורשת הרשאה מפורשת (access_level='full').
--     'selective'        — רק משתמשים עם הרשאה מפורשת פעילה רואים משהו בכלל.
--   business_access_grants.access_level: 'none' | 'anonymous' | 'full'
--     (מחליף את 'full_view'/'files' הישנים - שתיהן מופו ל-'full', כי בפועל
--     ההבחנה ביניהן מעולם לא נאכפה, ראו הערה ב-2026-08-15c).
--     שורת הרשאה מפורשת - כולל 'none' - **גוברת תמיד** על ברירת המחדל
--     האוטומטית של all_authorized. זה מה שמאפשר לחסום סוכן מורשה ספציפי
--     גם כשההפצה במצב ברירת מחדל (סעיף "ביטול הרשאות" באפיון).
--
-- חשוב: has_full_business_access() נשארת עם אותה חתימה בדיוק (biz_id, uid)
-- ואותה משמעות ("יש למשתמש הזה גישה מלאה") - כל שאר המערכת (קבצים, leads,
-- matches, business_file_meta, storage.objects) כבר תלויה בה ולא מתעדכנת
-- כאן בכלל. רק המימוש הפנימי שלה משתנה מ"יש הרשאה פעילה כלשהי" ל"יש הרשאה
-- פעילה ברמת full". זה מצמצם את שטח השינוי לטבלה אחת + view אחד + policy אחד.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. עמודת מצב הפצה על businesses
-- ----------------------------------------------------------------------------
alter table businesses add column if not exists distribution_status text
  not null default 'not_distributed'
  check (distribution_status in ('not_distributed','all_authorized','selective'));

-- ----------------------------------------------------------------------------
-- 2. גיבוי היסטוריה + מיפוי נתונים קיימים כך שהתנהגות בפועל לא תשתנה
--    באופן מפתיע ברגע ההרצה: עסק שהיה anon_card_active=true נחשב כאילו
--    כבר "מופץ לכל הסוכנים המורשים" (זו הייתה בדיוק המשמעות בפועל של הדגל
--    הישן, יחד עם can_view_anonymous_businesses שהיה true כברירת מחדל
--    לכל agent_authorized). עסק בלי anon_card_active נשאר 'not_distributed'.
-- ----------------------------------------------------------------------------
update businesses set distribution_status = 'all_authorized'
where anon_card_active = true and distribution_status = 'not_distributed';

-- ----------------------------------------------------------------------------
-- 3. עדכון access_level על שורות קיימות + שינוי ה-check constraint
-- ----------------------------------------------------------------------------
alter table business_access_grants drop constraint if exists business_access_grants_access_level_check;

update business_access_grants set access_level = 'full'
where access_level in ('full_view','files');

alter table business_access_grants add constraint business_access_grants_access_level_check
  check (access_level in ('none','anonymous','full'));

-- ----------------------------------------------------------------------------
-- 4. יומן שינויי הרשאה ייעודי (בנוסף ל-audit_log הכללי שהאפליקציה כותבת
--    אליו) - טבלה נפרדת כדי שאפשר יהיה לשלוף "כל היסטוריית ההרשאות של עסק X"
--    או "כל היסטוריית ההרשאות שקיבל משתמש Y" בלי לסנן מתוך audit_log כללי.
--    נכתבת גם ע"י טריגר ברמת ה-DB (לא רק ע"י קוד האפליקציה) כדי שהיא תישאר
--    נכונה גם אם מישהו יעדכן את הטבלה ישירות דרך ה-API בעתיד.
-- ----------------------------------------------------------------------------
create table if not exists business_access_audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  target_user uuid references profiles(id),
  change_type text not null, -- 'distribution_status' | 'grant_level'
  level_before text,
  level_after text,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists idx_baa_business on business_access_audit(business_id);
create index if not exists idx_baa_target_user on business_access_audit(target_user);

alter table business_access_audit enable row level security;
drop policy if exists "baa_select" on business_access_audit;
create policy "baa_select" on business_access_audit for select using (
  target_user = auth.uid()
  or has_full_business_access(business_id, auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
);
-- insert רק דרך הטריגרים למטה (security definer) - לא ישירות מהאפליקציה,
-- כדי שהיומן לא יהיה ניתן לזיוף/דילוג מצד הלקוח.

create or replace function bsd_log_distribution_change()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'UPDATE' and old.distribution_status is distinct from new.distribution_status) then
    insert into business_access_audit(business_id, target_user, change_type, level_before, level_after, changed_by)
    values (new.id, null, 'distribution_status', old.distribution_status, new.distribution_status, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_log_distribution_change on businesses;
create trigger trg_log_distribution_change after update on businesses
  for each row execute function bsd_log_distribution_change();

create or replace function bsd_log_grant_change()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    insert into business_access_audit(business_id, target_user, change_type, level_before, level_after, changed_by)
    values (new.business_id, new.granted_to, 'grant_level', 'none', new.access_level, coalesce(new.granted_by, auth.uid()));
  elsif (tg_op = 'UPDATE') then
    if (old.access_level is distinct from new.access_level) or (old.revoked_at is distinct from new.revoked_at) then
      insert into business_access_audit(business_id, target_user, change_type, level_before, level_after, changed_by)
      values (
        new.business_id, new.granted_to, 'grant_level',
        case when old.revoked_at is not null then 'none' else old.access_level end,
        case when new.revoked_at is not null then 'none' else new.access_level end,
        coalesce(new.revoked_by, auth.uid())
      );
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_log_grant_change on business_access_grants;
create trigger trg_log_grant_change after insert or update on business_access_grants
  for each row execute function bsd_log_grant_change();

-- ----------------------------------------------------------------------------
-- 5. has_full_business_access - אותה חתימה, פנימית עודכנה ל-access_level='full'
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
    where g.business_id = biz_id and g.granted_to = uid and g.active and g.access_level = 'full'
  );
$$;

-- ----------------------------------------------------------------------------
-- 6. get_business_access_level - הפונקציה החדשה שמחזירה none/anonymous/full
--    סדר העדיפויות: אדמין/מנהל/יוצר/מטפל -> full; הרשאה מפורשת פעילה (כולל
--    'none' - חסימה מפורשת) -> הערך שלה; אחרת אם distribution_status=
--    'all_authorized' וה-role הוא agent_authorized -> anonymous; אחרת none.
-- ----------------------------------------------------------------------------
create or replace function get_business_access_level(biz_id uuid, uid uuid)
returns text language sql stable security definer as $$
  select case
    when exists (select 1 from profiles p where p.id = uid and p.role in ('admin','manager')) then 'full'
    when exists (select 1 from businesses b where b.id = biz_id and (b.created_by = uid or b.handled_by = uid)) then 'full'
    when exists (
      select 1 from business_access_grants g
      where g.business_id = biz_id and g.granted_to = uid and g.active
    ) then (
      select g.access_level from business_access_grants g
      where g.business_id = biz_id and g.granted_to = uid and g.active
      limit 1
    )
    when exists (
      select 1 from businesses b, profiles p
      where b.id = biz_id and p.id = uid
        and b.distribution_status = 'all_authorized' and p.role = 'agent_authorized'
    ) then 'anonymous'
    else 'none'
  end;
$$;

-- ----------------------------------------------------------------------------
-- 7. RLS על businesses - SELECT מתעדכן להשתמש ב-get_business_access_level
--    במקום has_full_business_access + anon_card_active ישירות. INSERT/UPDATE/
--    DELETE נשארות בדיוק כפי שהן (עדיין תלויות ב-has_full_business_access,
--    שעדיין אומרת "full" בדיוק).
-- ----------------------------------------------------------------------------
drop policy if exists "businesses_select" on businesses;
create policy "businesses_select" on businesses for select using (
  get_business_access_level(id, auth.uid()) <> 'none'
);

-- ----------------------------------------------------------------------------
-- 8. business_access_grants - RLS insert/update מתעדכן: מי שיכול לנהל הרשאות
--    לעסק (has_full_business_access) יכול גם ליצור/לעדכן שורת 'none' חוסמת,
--    לא רק full_view כמו קודם. הבחירה כבר הייתה כללית (כל access_level),
--    אז אין צורך לשנות את ה-policies עצמם - רק ה-check constraint (סעיף 3).
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 9. עדכון businesses_anonymous_card - הגישה נקבעת עכשיו לפי
--    get_business_access_level במקום anon_card_active + can_view_anonymous_
--    businesses. anon_card_active נשאר כשדה תוכן ("יש כרטיס אנונימי מוכן
--    להצגה") אך לא כמנגנון הרשאה - נדרש גם anon_summary לא ריק (כמו קודם).
-- ----------------------------------------------------------------------------
drop view if exists businesses_anonymous_card;

create view businesses_anonymous_card
with (security_invoker = false) as
select
  b.id,
  coalesce(b.anon_display_name, b.field) as anon_display_name,
  b.field,
  b.category,
  b.subcategory,
  b.city,
  b.years_active,
  b.annual_revenue,
  b.operating_profit,
  b.net_profit,
  b.employees_count,
  b.anon_summary,
  case when b.anon_card_show_price then b.asking_price else null end as asking_price,
  b.handled_by,
  b.anon_card_active,
  b.distribution_status,
  b.anon_summary_generated_at,
  b.created_at,
  b.updated_at
from businesses b
where b.anon_summary is not null
  and get_business_access_level(b.id, auth.uid()) in ('anonymous','full');

grant select on businesses_anonymous_card to authenticated;

-- ============================================================================
-- הערה: כמו במיגרציית 15.08 המקורית - businesses תחזיר ב-select רק שורות
-- שמותרות לפי get_business_access_level, כולל למשתמשים שהיום (לפני המיגרציה)
-- לא היו רואים כלום. anon_card_active של עסק ישן עם distribution_status
-- שהוגדר אוטומטית ל-all_authorized בסעיף 2 - אם תרצה עסק ספציפי "לא מופץ"
-- אחרי ההרצה, יש לשנות ידנית ב-UI (או בשאילתה חד-פעמית).
-- ============================================================================
