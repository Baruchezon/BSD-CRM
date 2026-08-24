-- ============================================================================
-- תיקון: הוספת 'matches' לרשימת הערכים המותרים ב-record_notes.table_name
--
-- הבעיה: מסך פרטי התאמה (match-detail.html) שולח table_name='matches' בעת
-- הוספת הערה, אבל record_notes_table_name_check הוגדרה עוד לפני שהוסף שימוש
-- זה (13.08.2026) וכללה רק 'leads' ו-'businesses'. כל ניסיון להוסיף הערה
-- במסך התאמות נכשל עם שגיאת check constraint violation.
--
-- דווח ע"י בארוך 24.08.2026, אושר וטופל באותו יום.
-- ============================================================================

ALTER TABLE public.record_notes DROP CONSTRAINT record_notes_table_name_check;

ALTER TABLE public.record_notes
  ADD CONSTRAINT record_notes_table_name_check
  CHECK (table_name = ANY (ARRAY['leads'::text, 'businesses'::text, 'matches'::text]));
