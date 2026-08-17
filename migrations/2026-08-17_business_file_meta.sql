-- ============================================================================
-- BSD-CRM — טבלת מטא-דאטה לקבצים הכלליים בכרטיס עסק (שדרוג Drag & Drop)
-- תאריך: 17/08/2026
-- הרצה: Supabase SQL Editor, כמו כל migration קודם.
-- ----------------------------------------------------------------------------
-- הבעיה: אזור "קבצים מצורפים" הכללי (בשונה מ-business_sale_files של תיק
-- המכירה) עד היום לא היה לו שום שורת DB - קבצים נטענו ישירות מרשימת
-- Storage, בלי קטגוריה/שם תצוגה/מי העלה. הטבלה הזו מוסיפה בדיוק את זה,
-- בלי לשנות שום דבר בקובץ עצמו ב-Storage.
--
-- חשוב: זו טבלת מטא-דאטה *נוספת* בלבד. קובץ יכול להתקיים ב-Storage גם בלי
-- שורה כאן (קבצים שהועלו לפני המיגרציה הזו) - הקוד בצד הלקוח מתייחס
-- לרשימת ה-Storage כמקור האמת לאילו קבצים קיימים בפועל, והטבלה הזו רק
-- מעשירה אותם בפרטים נוספים כשיש שורה תואמת.
--
-- RLS: זהה בכוונה למדיניות הקיימת על bucket business-files (ראו
-- 2026-08-15c_files_access_alignment.sql) - אותו can_upload_sale_files
-- ואותו has_full_business_access, כדי לא ליצור מודל הרשאות שלישי נפרד.
-- ============================================================================

create table if not exists business_file_meta (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  storage_path text not null unique,      -- הנתיב המלא בבאקט, כפי שנשמר ע"י bsdUploadFile
  original_filename text not null,        -- שם הקובץ המקורי כפי שהועלה
  display_name text,                      -- שם תצוגה, ניתן לעריכה ידנית (שינוי שם)
  category text,                          -- 'תקציר' | 'מצגת' | 'מצגת אנונימית' | 'תיק מכירה' | 'דוח כספי' | 'הסכם' | 'תמונה' | 'מסמך כללי' (טקסט חופשי, לא enum - אותו טעם כמו business_sale_files.category)
  file_size bigint,
  file_type text,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_business_file_meta_business on business_file_meta(business_id);

comment on column business_file_meta.category is 'קטגוריה חופשית - מוצעת אוטומטית לפי שם הקובץ בזמן ההעלאה, תמיד ניתנת לשינוי ידני';

alter table business_file_meta enable row level security;

drop policy if exists "business_file_meta_admin_manager_full" on business_file_meta;
create policy "business_file_meta_admin_manager_full" on business_file_meta
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  );

drop policy if exists "business_file_meta_select" on business_file_meta;
create policy "business_file_meta_select" on business_file_meta
  for select using (
    has_full_business_access(business_id, auth.uid())
  );

drop policy if exists "business_file_meta_insert" on business_file_meta;
create policy "business_file_meta_insert" on business_file_meta
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
    and has_full_business_access(business_id, auth.uid())
  );

-- עדכון (שינוי שם/קטגוריה) ומחיקה: אותו תנאי בדיוק כמו storage.objects
-- (business_files_upload_permitted / business_files_delete_permitted) -
-- לא מוגבל ל"מי שהעלה בעצמו", כי מי שיכול למחוק את הקובץ עצמו מה-Storage
-- חייב להיות מסוגל למחוק גם את שורת המטא-דאטה שלו, אחרת נשארות שורות יתומות.
drop policy if exists "business_file_meta_update" on business_file_meta;
create policy "business_file_meta_update" on business_file_meta
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
    and has_full_business_access(business_id, auth.uid())
  );

drop policy if exists "business_file_meta_delete" on business_file_meta;
create policy "business_file_meta_delete" on business_file_meta
  for delete using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
    and has_full_business_access(business_id, auth.uid())
  );
