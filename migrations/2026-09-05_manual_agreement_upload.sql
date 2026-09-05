-- ============================================================================
-- BSD-CRM — העלאה ידנית של הסכם התקשרות חתום מתוך הכרטיס (עסק/קונה-משקיע/מתווך)
-- תאריך: 05/09/2026
-- הרצה: Supabase SQL Editor, כמו כל migration קודם בפרויקט.
-- ----------------------------------------------------------------------------
-- רקע: מנגנון ה-agreement_pdf_path הקיים (ר' 2026-08-19_agreement_pdf_storage.sql
-- ומיגרציות ההמשך 19b-19e) כבר תומך בשלוש הטבלאות (businesses/leads/brokers),
-- כולל עמודות path/uploaded_at, מוסכמת נתיב agreements/{table}/{id}.pdf,
-- ופונקציות has_agreement_record_access / viewAgreementPdf / downloadAgreementPdf
-- הקיימות כבר בקוד. המנגנון הקיים (save_agreement_pdf_path) משייך לפי מספר
-- טלפון בלבד - מתאים לזרימה החיצונית (bsd-contracts) שאינה מזהה את הרשומה
-- מראש, אבל לא מתאים/לא בטוח כשההעלאה מתבצעת מתוך הכרטיס עצמו בו מזהה
-- הרשומה כבר ידוע בוודאות - שם נדרש שיוך לפי מזהה רשומה ישיר, לא טלפון.
--
-- זו הרחבה בטוחה בלבד: לא נוגעת ב-save_agreement_pdf_path / find_agreement_record /
-- mark_business_agreement_signed / mark_lead_agreement_signed הקיימות (משמשות
-- את bsd-contracts ונשארות כפי שהן), לא נוגעת בהרשאות Storage הקיימות (נבדק:
-- מדיניות "storage_insert" הקיימת כבר מאפשרת למשתמש פעיל ולא-viewer להעלות
-- לכל נתיב בבאקט business-files, כולל agreements/ - אין צורך במדיניות חדשה).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. עמודת "מי העלה" - חסרה היום לחלוטין על שלוש הטבלאות (רק path+uploaded_at קיימים)
-- ---------------------------------------------------------------------------
alter table businesses add column if not exists agreement_pdf_uploaded_by uuid references profiles(id);
alter table leads      add column if not exists agreement_pdf_uploaded_by uuid references profiles(id);
alter table brokers    add column if not exists agreement_pdf_uploaded_by uuid references profiles(id);

comment on column businesses.agreement_pdf_uploaded_by is 'מי העלה את קובץ ה-PDF החתום (העלאה ידנית מהכרטיס)';
comment on column leads.agreement_pdf_uploaded_by      is 'מי העלה את קובץ ה-PDF החתום (העלאה ידנית מהכרטיס)';
comment on column brokers.agreement_pdf_uploaded_by    is 'מי העלה את קובץ ה-PDF החתום (העלאה ידנית מהכרטיס)';

-- ---------------------------------------------------------------------------
-- 2. פונקציית RPC חדשה וצרה - שיוך לפי מזהה רשומה ישיר (לא טלפון), להעלאה
--    ידנית מתוך הכרטיס. בודקת הרשאה בעצמה (SECURITY DEFINER) באמצעות
--    has_agreement_record_access הקיימת - אותה הרשאה בדיוק שכבר שולטת על
--    מי יכול לצפות/להוריד הסכם היום, כדי לא ליצור סטנדרט הרשאה מקביל.
--    מעדכנת agreement_status ל"יש הסכם חתום" רק אם הוא עדיין לא כבר כך
--    (לא דורסת/"שוברת" סטטוס קיים כנדרש), ולא נוגעת במספר הסכם אם כבר קיים.
-- ---------------------------------------------------------------------------
create or replace function public.save_manual_signed_agreement(
  p_table_name text,   -- 'businesses' | 'leads' | 'brokers'
  p_record_id uuid,
  p_path text,
  p_uploaded_by uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_table_name not in ('businesses','leads','brokers') then
    raise exception 'טבלה לא נתמכת: %', p_table_name;
  end if;
  if not has_agreement_record_access(p_table_name, p_record_id, auth.uid()) then
    raise exception 'אין הרשאה לעדכן הסכם עבור רשומה זו';
  end if;

  if p_table_name = 'businesses' then
    update businesses
    set agreement_pdf_path = p_path,
        agreement_pdf_uploaded_at = now(),
        agreement_pdf_uploaded_by = p_uploaded_by,
        agreement_status = case when agreement_status = 'יש הסכם חתום' then agreement_status else 'יש הסכם חתום' end
    where id = p_record_id;
  elsif p_table_name = 'leads' then
    update leads
    set agreement_pdf_path = p_path,
        agreement_pdf_uploaded_at = now(),
        agreement_pdf_uploaded_by = p_uploaded_by,
        agreement_status = case when agreement_status = 'יש הסכם חתום' then agreement_status else 'יש הסכם חתום' end
    where id = p_record_id;
  elsif p_table_name = 'brokers' then
    update brokers
    set agreement_pdf_path = p_path,
        agreement_pdf_uploaded_at = now(),
        agreement_pdf_uploaded_by = p_uploaded_by,
        agreement_status = case when agreement_status = 'יש הסכם חתום' then agreement_status else 'יש הסכם חתום' end
    where id = p_record_id;
  end if;
end;
$function$;

grant execute on function public.save_manual_signed_agreement(text, uuid, text, uuid) to authenticated;
revoke execute on function public.save_manual_signed_agreement(text, uuid, text, uuid) from anon, public;
