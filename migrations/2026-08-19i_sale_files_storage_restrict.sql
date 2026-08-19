-- ============================================================================
-- BSD-CRM — אותה תקלת הרשאות בדיוק (storage_select רחב), הפעם על קבצי
-- תיק המכירה הכלליים (business_sale_files) - לא רק על agreements/
-- תאריך: 19/08/2026 (המשך ל-2026-08-19d/g)
-- ----------------------------------------------------------------------------
-- נתפס בבדיקה: קובץ אנונימי (confidentiality_level=1) נבדק נכון מול
-- sale_files_anon_view_select/business_files_anon_view_select, אבל מדיניות
-- רחבה קיימת (storage_select - "כל משתמש פעיל רואה הכל בבאקט") עדיין נותנת
-- גישה לכל קובץ, כולל קבצים חסויים (confidentiality_level=2) למי שאין לו
-- שום קשר לעסק. מדיניות RESTRICTIVE צרה: כל נתיב שמופיע בטבלת
-- business_sale_files חייב לעבור את ה-RLS האמיתי של אותה טבלה (לא עוקף
-- אותו) - נתיבים אחרים (agreements/, training-forms/ וכו') לא מושפעים.
-- ============================================================================

create or replace function public.is_tracked_sale_file_path(p_path text)
returns boolean
language sql
stable
security definer
as $function$
  select exists (select 1 from business_sale_files where storage_path = p_path);
$function$;

drop policy if exists "business_sale_files_storage_restrict" on storage.objects;
create policy "business_sale_files_storage_restrict" on storage.objects
  as restrictive
  for select
  using (
    bucket_id <> 'business-files'
    or not is_tracked_sale_file_path(name)
    or exists (select 1 from business_sale_files f where f.storage_path = storage.objects.name)
  );
