-- ============================================================================
-- BSD-CRM — הרשאת UPDATE חסרה עבור upsert על קבצי הסכם
-- תאריך: 19/08/2026 (המשך ל-2026-08-19_agreement_pdf_storage.sql)
-- ----------------------------------------------------------------------------
-- נתפס בבדיקת קצה-לקצה אמיתית: storage.upload(..., {upsert:true}) שולח
-- x-upsert:true שגורם ל-Storage API לבצע INSERT ... ON CONFLICT DO UPDATE
-- תמיד (גם עבור קובץ חדש שמעולם לא היה קיים) - Postgres בודק RLS גם על ענף
-- ה-UPDATE כבר בזמן התכנון, ולכן חסרה מדיניות UPDATE מפילה את הבקשה גם
-- כשאין בכלל קונפליקט אמיתי. לא נגעתי במדיניות UPDATE כלליות אחרות -
-- רק נוספה מדיניות צרה לתיקיית agreements/ בלבד, תואמת בדיוק למדיניות
-- ה-INSERT שכבר קיימת שם.
-- ============================================================================

drop policy if exists "business_files_agreements_anon_update" on storage.objects;
create policy "business_files_agreements_anon_update" on storage.objects
  for update to anon
  using (
    bucket_id = 'business-files'
    and (storage.foldername(name))[1] = 'agreements'
  )
  with check (
    bucket_id = 'business-files'
    and (storage.foldername(name))[1] = 'agreements'
  );
