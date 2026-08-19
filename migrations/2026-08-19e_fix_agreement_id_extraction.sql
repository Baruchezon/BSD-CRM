-- ============================================================================
-- BSD-CRM — תיקון: מזהה ההסכם נמצא בשם הקובץ, לא בתיקייה שלישית
-- תאריך: 19/08/2026 (המשך ל-2026-08-19d)
-- ----------------------------------------------------------------------------
-- נתפס בבדיקה: הנתיב בפועל הוא agreements/{טבלה}/{uuid}.pdf - כלומר רק 2
-- רמות תיקיות (agreements, טבלה) והמזהה הוא חלק משם הקובץ עצמו, לא תיקייה
-- שלישית. גם המדיניות הישנה שהייתה בנויה מראש (business_files_agreements_select)
-- וגם המדיניות המגבילה שנוספה כרגע (...restrict_select) הניחו בטעות תיקייה
-- שלישית (storage.foldername(name))[3] - שלא קיימת בנתיב בפועל, ולכן
-- record_id תמיד יצא NULL וחסם גישה גם למי שכן אמור להיות מורשה.
-- התיקון: שליפת המזהה משם הקובץ (storage.filename) בהסרת הסיומת .pdf.
-- ============================================================================

drop policy if exists "business_files_agreements_select" on storage.objects;
create policy "business_files_agreements_select" on storage.objects
  for select using (
    bucket_id = 'business-files'
    and (storage.foldername(name))[1] = 'agreements'
    and has_agreement_record_access(
          (storage.foldername(name))[2],
          safe_uuid(regexp_replace(storage.filename(name), '\.pdf$', '', 'i')),
          auth.uid()
        )
  );

drop policy if exists "business_files_agreements_restrict_select" on storage.objects;
create policy "business_files_agreements_restrict_select" on storage.objects
  as restrictive
  for select
  using (
    bucket_id <> 'business-files'
    or (storage.foldername(name))[1] <> 'agreements'
    or has_agreement_record_access(
         (storage.foldername(name))[2],
         safe_uuid(regexp_replace(storage.filename(name), '\.pdf$', '', 'i')),
         auth.uid()
       )
  );
