-- ============================================================================
-- BSD-CRM — דירוג רצינות לקונים/משקיעים (רמת רצינות)
-- תאריך: 18/08/2026
-- הרצה: Supabase SQL Editor, כמו כל migration קודם.
-- ----------------------------------------------------------------------------
-- מטרה: שדה "רמת רצינות" לכל ליד מסוג buyer, עם 4 רמות ברירת מחדל, בלי
-- לקבע שמות/סדר בקוד - הרמות עצמן יושבות בטבלה נפרדת ועריכות (admin/manager
-- בעתיד מהגדרות) בלי migration נוסף. leads.rating_level_id הוא foreign key
-- לטבלה הזו, לא טקסט חופשי ולא enum.
--
-- הרשאות: לא נוגע ב-RLS הקיים של leads (שכבר מגביל שורה שלמה ל-admin/manager
-- או created_by/handled_by - כך שסוכן שאין לו גישה לקונה מסוים ממילא לא
-- רואה שום עמודה שלו, כולל הדירוג). בנוסף לכך, שני דגלי הרשאה חדשים על
-- profiles (can_view_buyer_rating / can_edit_buyer_rating) בדיוק באותה
-- מוסכמה כמו can_upload_sale_files הקיים - כדי שגם בתוך קונים שסוכן כן רואה,
-- הדירוג המקצועי הפנימי יישאר חסום למי שאין לו הרשאה מפורשת. אלה נאכפים גם
-- בצד השרת (RLS על העדכון) וגם בממשק.
-- ============================================================================

-- 1. טבלת הרמות עצמה - עריכה חופשית של שם/סדר/פעילות/סימון בעתיד
create table if not exists buyer_rating_levels (
  id uuid primary key default gen_random_uuid(),
  level_key text not null unique,   -- מזהה יציב פנימי, לא משתנה גם אם השם מוצג משתנה (למשל 'premium')
  name text not null,               -- השם המוצג בפועל - ניתן לעריכה חופשית
  sort_order integer not null default 0,
  is_active boolean not null default true,
  icon text,                        -- אייקון/סימון קצר לתצוגה ברשימה, למשל '⭐' או 'P'
  color text,                       -- צבע תג לתצוגה, למשל '#b8860b'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into buyer_rating_levels (level_key, name, sort_order, is_active, icon, color)
values
  ('interested',   'מתעניין',      1, true, '🔹', '#8a93ab'),
  ('active_buyer', 'קונה פעיל',    2, true, '🔸', '#3a5cad'),
  ('serious_buyer','קונה רציני',   3, true, '⭐', '#c98a1a'),
  ('premium',      'Premium',      4, true, '👑', '#b3402c')
on conflict (level_key) do nothing;

alter table buyer_rating_levels enable row level security;

drop policy if exists "buyer_rating_levels_select_all" on buyer_rating_levels;
create policy "buyer_rating_levels_select_all" on buyer_rating_levels
  for select using (auth.uid() is not null);

drop policy if exists "buyer_rating_levels_admin_manage" on buyer_rating_levels;
create policy "buyer_rating_levels_admin_manage" on buyer_rating_levels
  for all using (is_admin_or_manager(auth.uid()))
  with check (is_admin_or_manager(auth.uid()));

-- 2. עמודת הדירוג על leads
alter table leads add column if not exists rating_level_id uuid references buyer_rating_levels(id);
create index if not exists idx_leads_rating_level on leads(rating_level_id);

-- כל קונה/משקיע קיים (type buyer או partner) שאין לו דירוג מקבל ברירת מחדל
-- הגיונית ("מתעניין") - חד פעמי, לא נוגע במי שכבר יש לו דירוג. מוכרים
-- (type seller) לא מקבלים דירוג רצינות בכלל - זה לא רלוונטי עבורם.
update leads set rating_level_id = (select id from buyer_rating_levels where level_key = 'interested')
where type in ('buyer','partner') and rating_level_id is null;

-- 3. דגלי הרשאה חדשים על profiles - אותה מוסכמה בדיוק כמו can_upload_sale_files
alter table profiles add column if not exists can_view_buyer_rating boolean;
alter table profiles add column if not exists can_edit_buyer_rating boolean;

-- 4. אכיפה אמיתית בצד השרת על עדכון הדירוג ספציפית: leads_update הקיים
-- (created_by/handled_by/admin/manager) נשאר בדיוק כפי שהוא - לא נוגעים בו,
-- כדי לא לשבור עדכונים רגילים של שאר שדות הליד. RLS לא יכול לבדוק "האם
-- עמודה ספציפית זו השתנתה", ולכן האכיפה הממוקדת על rating_level_id נעשית
-- בטריגר הבא: אם השדה משתנה, נדרשת הרשאה מפורשת - גם אם ל-leads_update עצמו
-- יש הרשאה לעדכן את שאר הליד.
create or replace function can_edit_buyer_rating_ok(uid uuid)
returns boolean language sql stable security definer as $$
  select coalesce((select p.can_edit_buyer_rating from profiles p where p.id = uid), false);
$$;

create or replace function enforce_buyer_rating_edit_permission()
returns trigger language plpgsql security definer as $$
begin
  if new.rating_level_id is distinct from old.rating_level_id then
    if not (is_admin_or_manager(auth.uid()) or can_edit_buyer_rating_ok(auth.uid())) then
      raise exception 'אין הרשאה לשנות רמת רצינות של קונה זה';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_buyer_rating_edit on leads;
create trigger trg_enforce_buyer_rating_edit
  before update on leads
  for each row execute function enforce_buyer_rating_edit_permission();

-- 5. ברירת מחדל אוטומטית ל"מתעניין" ביצירת קונה/משקיע חדש - כדי שגם ליד
-- שנוצר ע"י סוכן שאין לו הרשאת צפייה בדירוג (ולכן השדה כלל לא מוצג לו
-- בטופס) לא יישאר ללא דירוג בפועל. לא רץ על מוכרים (type seller).
create or replace function default_buyer_rating_on_insert()
returns trigger language plpgsql security definer as $$
begin
  if new.type in ('buyer','partner') and new.rating_level_id is null then
    select id into new.rating_level_id from buyer_rating_levels where level_key = 'interested';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_default_buyer_rating_on_insert on leads;
create trigger trg_default_buyer_rating_on_insert
  before insert on leads
  for each row execute function default_buyer_rating_on_insert();

-- ============================================================================
-- לתפקידים קיימים: admin/manager מורשים תמיד (לא צריך דגל). כברירת מחדל
-- מוצע להדליק can_view_buyer_rating + can_edit_buyer_rating גם ל-
-- agent_authorized (כבר מורשה למידע רגיש כמו כרטיסים אנונימיים), ולהשאיר
-- כבוי ל-agent רגיל - ניתן לשנות בכל עת דרך users.html:
-- ============================================================================
update profiles set can_view_buyer_rating = true, can_edit_buyer_rating = true
where role = 'agent_authorized' and can_view_buyer_rating is null;
