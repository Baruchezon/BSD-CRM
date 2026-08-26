-- BSD CRM — מודול "תקצירים ומסמכי BSD" בכרטיס העסק
-- שלושה סוגי תוכן: short_description (קיים, מקבל אפשרות יצירה אוטומטית),
-- anon_summary (קיים, לא נוגעים בו כלל), internal_business_summary (חדש, מלא, עם מידע מזהה).
-- כל השורות add column/table if not exists — לא נוגעות בנתונים קיימים.

-- 1) תקציר עסקי מלא (internal_business_summary) — שדה חדש בביזנס, נפרד לגמרי מ-anon_summary
alter table businesses add column if not exists internal_business_summary text;
alter table businesses add column if not exists internal_business_summary_generated_at timestamptz;
alter table businesses add column if not exists internal_business_summary_generated_by uuid references profiles(id);

comment on column businesses.internal_business_summary is 'תקציר עסקי פנימי מלא - מותר לכלול מידע מזהה (שם/בעלים/טלפון/כתובת). נפרד לחלוטין מ-anon_summary, לעולם לא מוצג לגורם שאין לו הרשאת צפייה מלאה בעסק.';

-- 2) business_sale_files — 4 עמודות חדשות למקור/סוג/גרסה, בלי קטגוריה חדשה ובלי טבלה מקבילה
alter table business_sale_files add column if not exists source text not null default 'manual_upload';
alter table business_sale_files add column if not exists document_type text;
alter table business_sale_files add column if not exists version_number integer not null default 1;
alter table business_sale_files add column if not exists version_group_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'business_sale_files_source_check') then
    alter table business_sale_files add constraint business_sale_files_source_check
      check (source in ('manual_upload','auto_generated'));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'business_sale_files_document_type_check') then
    alter table business_sale_files add constraint business_sale_files_document_type_check
      check (document_type is null or document_type in ('short_summary','internal_full_summary'));
  end if;
end $$;

comment on column business_sale_files.source is 'מקור הקובץ: manual_upload (הועלה ידנית) | auto_generated (נוצר אוטומטית ע"י מודול התקצירים)';
comment on column business_sale_files.document_type is 'סוג התקציר האוטומטי: short_summary | internal_full_summary. NULL עבור קבצים שהועלו ידנית.';
comment on column business_sale_files.version_group_id is 'מקשר בין כל הגרסאות של אותו מסמך שנוצר אוטומטית (business_id + document_type קבועים). NULL עבור קבצים שהועלו ידנית (אין להם קבוצת גרסאות).';

-- מונע מצב של שני קבצים עם אותו מספר גרסה באותה קבוצה (בטיחות קשיחה ברמת ה-DB,
-- בנוסף לפונקציית ההקצאה האטומית למטה - allocate_sale_file_version).
create unique index if not exists business_sale_files_version_unique
  on business_sale_files(version_group_id, version_number)
  where version_group_id is not null;

-- 3) הקצאת מספר גרסה אטומית — מונעת מצב מרוץ בין שתי פעולות שמנסות ליצור
-- גרסה חדשה לאותה קבוצת מסמכים בו-זמנית. UPSERT יחיד הוא אטומי ב-Postgres.
create table if not exists sale_file_version_counters (
  version_group_id uuid primary key,
  next_version integer not null default 2
);

comment on table sale_file_version_counters is 'מונה גרסאות פר-קבוצת-מסמך למודול התקצירים. לא נצפה ישירות ע"י המשתמש - נגיש רק דרך allocate_sale_file_version().';

create or replace function allocate_sale_file_version(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
begin
  insert into sale_file_version_counters(version_group_id, next_version)
    values (p_group_id, 2)
  on conflict (version_group_id) do update
    set next_version = sale_file_version_counters.next_version + 1
  returning next_version - 1 into v_version;
  return v_version;
end;
$$;

revoke all on function allocate_sale_file_version(uuid) from public;
grant execute on function allocate_sale_file_version(uuid) to authenticated;
