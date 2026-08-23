-- BSD CRM — "לידים 2026" גרסה 2: רשימת בדיקה עצמאית לחלוטין (leads_2026_review)
--
-- רקע: גרסה 1 (leads_2026_hidden) הייתה תצוגה מסוננת על leads עצמה, וכפתור
-- המחיקה הכללי הקיים במסך מחק בטעות ליד אמיתי מהמערכת (אירוע 23.08.2026,
-- שוחזר במלואו). הדרישה המחייבת עכשיו: הרשימה חייבת להיות טבלה נפרדת
-- לגמרי, בלי שום FK לטבלה פעילה - כדי שמבנית לא יהיה אפשרי שפעולה עליה
-- תשפיע על leads/businesses/training_leads בשום צורה, בכל כיוון.
--
-- מקור הנתונים: לא רק leads קיימות - גם הודעות SITE123 גולמיות מהמייל
-- שמעולם לא נקלטו למערכת (זו בדיוק המטרה - לאתר גם אותן). הייבוא בפועל
-- (חיבור למייל) נעשה בסקריפט/Edge Function נפרד; המיגרציה הזו רק את הטבלה
-- והפונקציה.

create table if not exists leads_2026_review (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text unique,        -- מפתח מניעת ייבוא כפול למיילים; null מותר לרשומות שלא ממייל
  full_name text,
  phone text,
  email text,
  message_content text,                -- תוכן הפנייה המלא כפי שחולץ מהמייל
  received_at timestamptz,             -- מתי התקבלה הפנייה במקור (לא מתי יובאה לרשימה)
  source text default 'SITE123 email scan',
  raw_purpose text,                    -- טקסט "מטרת הפנייה" הגולמי מהטופס - לביקורת/שינוי סיווג ידני
  classification text not null default 'אחר - דורש בדיקה',
  classification_overridden_by uuid references profiles(id),
  classification_overridden_at timestamptz,
  review_status text not null default 'ממתין לבדיקה',  -- ממתין לבדיקה / הועבר / לא רלוונטי
  is_hidden boolean not null default false,
  hidden_by uuid references profiles(id),
  hidden_at timestamptz,
  -- שדות מעקב העברה - uuid/text רגילים בכוונה, בלי foreign key בשום כיוון,
  -- כך שמחיקה/שינוי ברשומה הפעילה שאליה הועבר, או להפך, לא יכולים "לגלוש" הנה
  transferred_to_table text,
  transferred_to_id uuid,
  transferred_at timestamptz,
  transferred_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_2026_review_status on leads_2026_review(review_status) where not is_hidden;
create index if not exists idx_leads_2026_review_hidden on leads_2026_review(is_hidden);

alter table leads_2026_review enable row level security;

drop policy if exists "leads_2026_review_admin_only" on leads_2026_review;
create policy "leads_2026_review_admin_only" on leads_2026_review
  for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- אין insert/update/delete מהצד של הדפדפן חוץ מדרך RLS admin-only למעלה. אין
-- טריגר מכל סוג שמפעיל DELETE/UPDATE על leads/businesses/training_leads/
-- buyers/sellers/partners - הטבלה הזו לא נוגעת בהן בשום מנגנון אוטומטי.

-- תיעוד ל-audit_log הקיים, כמו ב-leads_2026_hidden - hide/restore/transfer
create or replace function bsd_log_leads_2026_review_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (TG_OP = 'UPDATE') then
    if (old.is_hidden = false and new.is_hidden = true) then
      insert into audit_log(table_name, record_id, action, actor_id, details)
      values ('leads_2026_review', new.id, 'hide_from_2026_review', new.hidden_by, jsonb_build_object());
    elsif (old.is_hidden = true and new.is_hidden = false) then
      insert into audit_log(table_name, record_id, action, actor_id, details)
      values ('leads_2026_review', new.id, 'restore_to_2026_review', auth.uid(), jsonb_build_object());
    end if;
    if (old.review_status is distinct from new.review_status and new.review_status = 'הועבר') then
      insert into audit_log(table_name, record_id, action, actor_id, details)
      values ('leads_2026_review', new.id, 'transferred_from_2026_review', new.transferred_by,
        jsonb_build_object('to_table', new.transferred_to_table, 'to_id', new.transferred_to_id));
    end if;
    return new;
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_leads_2026_review_audit on leads_2026_review;
create trigger trg_leads_2026_review_audit
  after update on leads_2026_review
  for each row execute function bsd_log_leads_2026_review_change();

-- פונקציית התאמה חיה - לא שומרת snapshot, מחושבת בזמן אמת בכל טעינה כדי
-- שלא תהיה בעיית staleness אם רשומה במערכת השתנתה מאז הייבוא. security
-- definer + בדיקת admin פנימית משלה (הגנה כפולה מעבר ל-RLS של הטבלה הקוראת).
create or replace function find_2026_review_matches(p_phone text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  result jsonb := '[]'::jsonb;
  last9 text;
  email_norm text;
  r record;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') then
    return '[]'::jsonb;
  end if;

  last9 := nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9), '');
  email_norm := nullif(lower(trim(coalesce(p_email, ''))), '');

  if last9 is null and email_norm is null then
    return result;
  end if;

  for r in
    select id, type::text as subtype, coalesce(full_name, trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) as label, agreement_status
    from leads
    where (last9 is not null and (right(regexp_replace(coalesce(phone,''),'\D','','g'),9) = last9 or right(regexp_replace(coalesce(phone2,''),'\D','','g'),9) = last9))
       or (email_norm is not null and lower(trim(coalesce(email,''))) = email_norm)
  loop
    result := result || jsonb_build_object('table','leads','id',r.id,'label',r.label,'subtype',r.subtype,'agreement_status',r.agreement_status);
  end loop;

  for r in
    select id, null::text as subtype, coalesce(internal_name, owner_name) as label, agreement_status
    from businesses
    where (last9 is not null and right(regexp_replace(coalesce(owner_phone,''),'\D','','g'),9) = last9)
       or (email_norm is not null and lower(trim(coalesce(owner_email,''))) = email_norm)
  loop
    result := result || jsonb_build_object('table','businesses','id',r.id,'label',r.label,'subtype',r.subtype,'agreement_status',r.agreement_status);
  end loop;

  for r in
    select id, null::text as subtype, trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) as label, null::text as agreement_status
    from training_leads
    where (last9 is not null and right(regexp_replace(coalesce(phone,''),'\D','','g'),9) = last9)
       or (email_norm is not null and lower(trim(coalesce(email,''))) = email_norm)
  loop
    result := result || jsonb_build_object('table','training_leads','id',r.id,'label',r.label,'subtype',r.subtype,'agreement_status',r.agreement_status);
  end loop;

  return result;
end;
$function$;
