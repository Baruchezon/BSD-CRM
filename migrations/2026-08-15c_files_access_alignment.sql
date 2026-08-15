-- ============================================================================
-- BSD-CRM — יישור הרשאות קבצים (business-files bucket + business_sale_files)
-- עם מודל ההרשאות החדש (has_full_business_access) - סעיף 11 באפיון
-- תאריך: 15/08/2026
-- ============================================================================
-- הבעיה: migrations/2026-08-14_sale_file_module.sql נתן לכל agent_authorized
-- גישה גורפת לכל הקבצים של כל העסקים (SELECT ללא תלות בבעלות/שחרור) - זה
-- בדיוק ההגדרה הישנה והרחבה של agent_authorized, לא ההגדרה הצרה החדשה
-- שסוכם עליה. מיישר את שתי המדיניות (storage.objects + business_sale_files)
-- כך שגישה לקבצים = בדיוק אותה גישה לעסק עצמו (has_full_business_access),
-- לא יותר.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. storage.objects, bucket business-files
-- ---------------------------------------------------------------------------
drop policy if exists "business_files_agent_authorized_all" on storage.objects;
drop policy if exists "business_files_agent_own" on storage.objects;

create policy "business_files_full_access_only" on storage.objects
  for select using (
    bucket_id = 'business-files'
    and has_full_business_access((storage.foldername(name))[1]::uuid, auth.uid())
  );

drop policy if exists "business_files_upload_permitted" on storage.objects;
create policy "business_files_upload_permitted" on storage.objects
  for insert with check (
    bucket_id = 'business-files'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
    and has_full_business_access((storage.foldername(name))[1]::uuid, auth.uid())
  );

drop policy if exists "business_files_delete_permitted" on storage.objects;
create policy "business_files_delete_permitted" on storage.objects
  for delete using (
    bucket_id = 'business-files'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
    and has_full_business_access((storage.foldername(name))[1]::uuid, auth.uid())
  );
-- business_files_admin_manager_full (מ-14.08) נשארת כמו שהיא - עדיין תקינה.

-- ---------------------------------------------------------------------------
-- 2. business_sale_files (מטא-דאטה)
-- ---------------------------------------------------------------------------
drop policy if exists "sale_files_agent_authorized_select_all" on business_sale_files;
drop policy if exists "sale_files_agent_own_select" on business_sale_files;

create policy "sale_files_full_access_only" on business_sale_files
  for select using (
    has_full_business_access(business_id, auth.uid())
  );

drop policy if exists "sale_files_upload_permitted_insert" on business_sale_files;
create policy "sale_files_upload_permitted_insert" on business_sale_files
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
    and has_full_business_access(business_id, auth.uid())
  );
-- sale_files_admin_manager_full ו-sale_files_upload_permitted_update (מ-14.08) נשארות כמו שהן.

-- ============================================================================
-- הערה: לאחר המיגרציה הזו, גישה לקבצים = בדיוק אותה גישה לעסק עצמו:
-- יוצר/מטפל/אדמין/מנהל/מי שקיבל שחרור גישה (business_access_grants). זה
-- כולל את המקרה בו שחרור הגישה הוא access_level='files' - כרגע ההבחנה
-- בין 'full_view' ל-'files' לא נאכפת ברמת ה-RLS (שתיהן נותנות has_full_
-- business_access = true, ולכן גם גישה לקבצים); אם תרצה להבחין ביניהן -
-- לדוגמה 'full_view' בלי גישה לקבצים בפועל - זה שינוי נפרד, לא כלול כאן.
-- ============================================================================
