-- ============================================================================
-- BSD-CRM — מודול "תיק מכירה" (שלבים 2-6): טבלה, הרשאות משתמש, RLS
-- תאריך: 14/08/2026
-- הרצה: Supabase SQL Editor, כמו כל migration קודם בפרויקט.
-- כל השורות "add column/table if not exists" — לא נוגעות בנתונים קיימים.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. טבלת business_sale_files — קבצי תיק המכירה של כל עסק
--    הקובץ עצמו יושב ב-Storage (bucket business-files, קיים), כאן רק המטא-דאטה.
--    category הוא text חופשי (לא enum) כדי לאפשר הוספת קטגוריות בעתיד בלי
--    לשנות סכימה — הרשימה הנוכחית מנוהלת בקוד (js/saleFileCategories.js).
-- ---------------------------------------------------------------------------
create table if not exists business_sale_files (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  category text not null,                      -- 'anon_presentation' | 'exec_summary' | 'economic_analysis' | 'valuation' | 'business_photo' | 'other'
  file_name text not null,                      -- שם הקובץ המקורי לתצוגה
  storage_path text not null,                   -- נתיב מלא ב-bucket business-files
  file_type text,                                -- סיומת/mime
  file_size bigint,
  confidentiality_level smallint not null default 2,  -- 1=אנונימי (זמין לפני הסכם) | 2=חסוי (דורש הסכם חתום)
  uploaded_by uuid references profiles(id),
  status text not null default 'active',        -- 'active' | 'deleted' (שמירה רכה)
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sale_files_business on business_sale_files(business_id) where status = 'active';
create index if not exists idx_sale_files_category on business_sale_files(business_id, category) where status = 'active';

comment on column business_sale_files.confidentiality_level is 'רמת סודיות המסמך: 1=אנונימי (מותר בלי הסכם חתום), 2=חסוי (מותר רק לקונה עם הסכם חתום)';
comment on column business_sale_files.category is 'קטגוריה חופשית - הרשימה הנוכחית מנוהלת בקוד, לא כאן, כדי לאפשר הרחבה בלי migration';

-- ---------------------------------------------------------------------------
-- 2. הרשאות משתמש חדשות ב-profiles (סעיפים 8+11 בהנחיות)
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists can_upload_sale_files boolean not null default false;
alter table profiles add column if not exists document_access_level text not null default 'view_download';
-- ערכים אפשריים ל-document_access_level: 'anonymous_only' | 'view_authorized' | 'view_download' | 'view_download_send' | 'full_access'
-- ברירת המחדל 'view_download' משמרת את ההתנהגות הקיימת (כל משתמש מחובר יכול לצפות/להוריד) - שינוי אמיתי בהרשאות ייעשה רק דרך users.html.

comment on column profiles.can_upload_sale_files is 'הרשאה נקודתית להעלאת קבצים לתיק מכירה, גם למי שאינו admin';
comment on column profiles.document_access_level is 'רמת הגישה של המשתמש למסמכי תיק המכירה - עובד יחד עם confidentiality_level של כל מסמך';

-- ---------------------------------------------------------------------------
-- 3. RLS על business_sale_files — אותו דפוס בדיוק כמו matches/tasks הקיימים
-- ---------------------------------------------------------------------------
alter table business_sale_files enable row level security;

drop policy if exists "sale_files_admin_manager_full" on business_sale_files;
create policy "sale_files_admin_manager_full" on business_sale_files
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  );

drop policy if exists "sale_files_agent_authorized_select_all" on business_sale_files;
create policy "sale_files_agent_authorized_select_all" on business_sale_files
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'agent_authorized')
  );

drop policy if exists "sale_files_agent_own_select" on business_sale_files;
create policy "sale_files_agent_own_select" on business_sale_files
  for select using (
    exists (select 1 from businesses b where b.id = business_sale_files.business_id and b.created_by = auth.uid())
  );

-- הוספה/עדכון/מחיקה: admin/manager תמיד; מעבר לזה רק מי שסומן can_upload_sale_files=true,
-- ורק על עסקים שהוא רשאי לראות (agent_authorized = כל עסק, agent = רק עסקים שלו).
drop policy if exists "sale_files_upload_permitted_insert" on business_sale_files;
create policy "sale_files_upload_permitted_insert" on business_sale_files
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
    and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'agent_authorized')
      or exists (select 1 from businesses b where b.id = business_sale_files.business_id and b.created_by = auth.uid())
    )
  );

drop policy if exists "sale_files_upload_permitted_update" on business_sale_files;
create policy "sale_files_upload_permitted_update" on business_sale_files
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
    and uploaded_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- 4. RLS על storage.objects ל-bucket business-files
--    ⚠️ סוגר את הפער שמצאתי בשלב 1: לא היה RLS מפורש ל-bucket הזה בריפו.
--    הנתיב באחסון הוא תמיד <businessId>/... (כך העלאה קיימת כבר עובדת),
--    כך שאפשר לבדוק שייכות עסק ישירות מהנתיב.
--    ⚠️ לפני ההרצה: ודא שאין היום Policy סותרת שכבר הוגדרה ידנית ב-Dashboard.
-- ---------------------------------------------------------------------------
drop policy if exists "business_files_admin_manager_full" on storage.objects;
create policy "business_files_admin_manager_full" on storage.objects
  for all using (
    bucket_id = 'business-files'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  );

drop policy if exists "business_files_agent_authorized_all" on storage.objects;
create policy "business_files_agent_authorized_all" on storage.objects
  for select using (
    bucket_id = 'business-files'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'agent_authorized')
  );

drop policy if exists "business_files_agent_own" on storage.objects;
create policy "business_files_agent_own" on storage.objects
  for select using (
    bucket_id = 'business-files'
    and exists (
      select 1 from businesses b
      where b.id::text = (storage.foldername(name))[1]
      and b.created_by = auth.uid()
    )
  );

drop policy if exists "business_files_upload_permitted" on storage.objects;
create policy "business_files_upload_permitted" on storage.objects
  for insert with check (
    bucket_id = 'business-files'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
  );

drop policy if exists "business_files_delete_permitted" on storage.objects;
create policy "business_files_delete_permitted" on storage.objects
  for delete using (
    bucket_id = 'business-files'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
  );
