-- ============================================================================
-- BSD-CRM — שמירת קובץ ה-PDF החתום מ-bsd-contracts בכרטיס העסק/ליד
-- תאריך: 19/08/2026
-- הרצה: Supabase SQL Editor, כמו כל migration קודם.
-- ----------------------------------------------------------------------------
-- רקע: המנגנון has_agreement_record_access + מדיניות הקריאה
-- business_files_agreements_select, וכן הפונקציות find_agreement_record /
-- mark_business_agreement_signed / mark_lead_agreement_signed, כבר קיימים
-- ב-DB החי אך אינם מחוברים לשום דבר בקוד (לא ב-BSD-CRM ולא ב-bsd-contracts) -
-- כנראה תחילת עבודה על הפיצ'ר הזה בדיוק, שנעצרה באמצע. המיגרציה הזו משלימה
-- אותה: מוסיפה את עמודות הנתיב החסרות, את מדיניות ה-INSERT החסרה, ופונקציה
-- אחת חדשה לשמירת הנתיב - בלי לגעת בשתי הפונקציות הקיימות
-- upsert_business_from_agreement / upsert_lead_from_agreement שכבר עובדות.
--
-- מוסכמת הנתיב שכבר קיימת בפועל דרך has_agreement_record_access:
--   agreements/businesses/{business_id}.pdf
--   agreements/leads/{lead_id}.pdf
-- ============================================================================

alter table businesses add column if not exists agreement_pdf_path        text;
alter table businesses add column if not exists agreement_pdf_uploaded_at timestamptz;
alter table leads      add column if not exists agreement_pdf_path        text;
alter table leads      add column if not exists agreement_pdf_uploaded_at timestamptz;

-- מדיניות ההעלאה החסרה, באותו דפוס בדיוק כמו training_forms_anon_insert
-- הקיימת (כתיבה פתוחה לתיקייה צרה, קריאה תמיד עוברת דרך has_agreement_record_access)
drop policy if exists "business_files_agreements_anon_insert" on storage.objects;
create policy "business_files_agreements_anon_insert" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'business-files'
    and (storage.foldername(name))[1] = 'agreements'
  );

-- שמירת הנתיב על הרשומה הנכונה, אחרי שה-PDF כבר הועלה ל-Storage.
-- משתמשת באותו נירמול טלפון בדיוק כמו upsert_business_from_agreement /
-- upsert_lead_from_agreement, כדי שלא תיתכן סטייה בין הפונקציות.
create or replace function public.save_agreement_pdf_path(
  p_table_name text,   -- 'businesses' | 'leads'
  p_phone text,
  p_path text,
  p_type text default null  -- נדרש רק כאשר p_table_name = 'leads'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_normalized text;
  v_id uuid;
begin
  v_normalized := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_normalized = '' then
    return;
  end if;

  if p_table_name = 'businesses' then
    select id into v_id from businesses
    where regexp_replace(coalesce(owner_phone, ''), '[^0-9]', '', 'g') = v_normalized
    limit 1;
    if v_id is not null then
      update businesses
      set agreement_pdf_path = p_path, agreement_pdf_uploaded_at = now()
      where id = v_id;
    end if;
  elsif p_table_name = 'leads' then
    select id into v_id from leads
    where type::text = p_type
      and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_normalized
    limit 1;
    if v_id is not null then
      update leads
      set agreement_pdf_path = p_path, agreement_pdf_uploaded_at = now()
      where id = v_id;
    end if;
  end if;
end;
$function$;

grant execute on function public.save_agreement_pdf_path(text, text, text, text) to anon, authenticated;
-- (סדר הפרמטרים בפועל: table_name, phone, path, type)
