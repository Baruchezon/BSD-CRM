-- ============================================================================
-- BSD-CRM — הגבלה אמיתית: הסכם חתום נגיש רק למי שמשויך לעסק/ליד עצמו
-- תאריך: 19/08/2026 (המשך ל-2026-08-19_agreement_pdf_storage.sql)
-- ----------------------------------------------------------------------------
-- נתפס בבדיקה: מדיניות רחבה וקיימת בבאקט (storage_select - "כל משתמש פעיל
-- רואה הכל בבאקט") נותנת בפועל גישה לכל קובץ, כולל הסכמים חתומים של
-- עסקים/לידים שאינם שייכים למשתמש בכלל - עוקפת את has_agreement_record_access
-- שכבר קיים בדיוק בשביל למנוע את זה. לא ניתן פשוט לצמצם את storage_select
-- כי כנראה משמש תכונות אחרות בבאקט בכוונה.
--
-- הפתרון: מדיניות RESTRICTIVE (ולא permissive) - ב-Postgres, AS RESTRICTIVE
-- חייבת להתקיים בנוסף לכל permissive policy, לא במקומה. כך אפשר לצמצם בדיוק
-- לתיקיית agreements/ בלי לגעת בשום דבר אחר בבאקט.
-- ============================================================================

drop policy if exists "business_files_agreements_restrict_select" on storage.objects;
create policy "business_files_agreements_restrict_select" on storage.objects
  as restrictive
  for select
  using (
    bucket_id <> 'business-files'
    or (storage.foldername(name))[1] <> 'agreements'
    or has_agreement_record_access(
         (storage.foldername(name))[2],
         safe_uuid((storage.foldername(name))[3]),
         auth.uid()
       )
  );
