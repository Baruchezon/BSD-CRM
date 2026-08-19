-- ============================================================================
-- BSD-CRM — תיקון: הבדיקה על businesses בתוך מדיניות RLS הייתה כפופה בעצמה
-- ל-RLS של businesses (חסם תמיד למי שאין לו full_business_access)
-- תאריך: 19/08/2026 (המשך ל-2026-08-19f)
-- ----------------------------------------------------------------------------
-- נתפס בבדיקה: "exists (select 1 from businesses b where ...)" בתוך מדיניות
-- RLS רץ עם ההרשאות של המשתמש השואל, ולכן כפוף בעצמו למדיניות ה-RLS של
-- businesses (has_full_business_access) - בדיוק מה שסוכן מורשה-אנונימי אין
-- לו. צריך פונקציית עזר SECURITY DEFINER (כמו has_full_business_access עצמה)
-- שעוקפת את זה, בדיוק לבדיקה הצרה הזו בלבד.
-- ============================================================================

create or replace function public.is_business_anon_card_active(p_business_id uuid)
returns boolean
language sql
stable
security definer
as $function$
  select coalesce((select anon_card_active from businesses where id = p_business_id), false);
$function$;

drop policy if exists "sale_files_anon_view_select" on business_sale_files;
create policy "sale_files_anon_view_select" on business_sale_files
  for select using (
    confidentiality_level = 1
    and status = 'active'
    and is_business_anon_card_active(business_id)
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
  );

drop policy if exists "business_files_anon_view_select" on storage.objects;
create policy "business_files_anon_view_select" on storage.objects
  for select using (
    bucket_id = 'business-files'
    and exists (
      select 1 from business_sale_files f
      where f.storage_path = storage.objects.name
        and f.confidentiality_level = 1
        and f.status = 'active'
        and is_business_anon_card_active(f.business_id)
    )
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
  );
