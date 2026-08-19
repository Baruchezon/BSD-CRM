-- ============================================================================
-- BSD-CRM — תיקון קריסה במדיניות Storage כשנתיב הקובץ לא מתחיל ב-UUID
-- תאריך: 19/08/2026 (המשך ישיר ל-2026-08-19_agreement_pdf_storage.sql)
-- ----------------------------------------------------------------------------
-- הבאג: 3 מדיניות RLS על storage.objects (business_files_upload_permitted,
-- business_files_full_access_only, business_files_delete_permitted) מבצעות
-- ((storage.foldername(name))[1])::uuid בלי בדיקה מוקדמת. זה עבד עד היום כי
-- כל הנתיבים בבאקט התחילו ב-business_id אמיתי (uuid) - אבל ברגע שנוסף נתיב
-- עם תיקייה ראשונה שאינה uuid (agreements/..., וכנראה גם training-forms/...
-- באופן דומה), הביטוי הזה זורק שגיאת Postgres אמיתית "invalid input syntax
-- for type uuid", שמפילה את כל הבקשה - נתפס בבדיקת קצה-לקצה אמיתית
-- (Playwright) של זרימת שמירת ההסכם החתום שנוספה כרגע.
--
-- התיקון: פונקציית עזר safe_uuid() שמחזירה NULL במקום לזרוק שגיאה כשהטקסט
-- אינו UUID תקין. has_full_business_access כבר מטפל נכון ב-biz_id=NULL
-- (כל שלושת ה-exists שבתוכו פשוט מחזירים false) - בדוק ומאומת.
-- ============================================================================

create or replace function public.safe_uuid(p_text text)
returns uuid
language sql
immutable
as $function$
  select case
    when p_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then p_text::uuid
    else null
  end;
$function$;

drop policy if exists "business_files_upload_permitted" on storage.objects;
create policy "business_files_upload_permitted" on storage.objects
  for insert with check (
    bucket_id = 'business-files'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
    and has_full_business_access(safe_uuid((storage.foldername(name))[1]), auth.uid())
  );

drop policy if exists "business_files_full_access_only" on storage.objects;
create policy "business_files_full_access_only" on storage.objects
  for select using (
    bucket_id = 'business-files'
    and has_full_business_access(safe_uuid((storage.foldername(name))[1]), auth.uid())
  );

drop policy if exists "business_files_delete_permitted" on storage.objects;
create policy "business_files_delete_permitted" on storage.objects
  for delete using (
    bucket_id = 'business-files'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_upload_sale_files = true)
    and has_full_business_access(safe_uuid((storage.foldername(name))[1]), auth.uid())
  );
