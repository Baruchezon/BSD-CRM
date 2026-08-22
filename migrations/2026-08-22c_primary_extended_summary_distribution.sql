-- ============================================================================
-- BSD-CRM — פישוט חיווי תקצירים + הפצת תקציר ראשוני (22/08/2026)
-- ----------------------------------------------------------------------------
-- הקשר: businesses.html כבר פושט לשני חיוויים בלבד ברשימת העסקים - "תקציר
-- ראשוני" (טקסט, anon_summary/anon_display_name - קיים כבר, שום שינוי DB
-- נדרש) ו"תקציר מורחב" (קובץ, מזוהה אך ורק לפי category='מצגת אנונימית' ב-
-- business_file_meta או category='anon_presentation' ב-business_sale_files -
-- שני השדות האלה כבר קיימים, שום migration נדרש לזיהוי עצמו).
--
-- מה כן דורש migration: anon_distributions נבנתה מלכתחילה סביב קובץ בלבד
-- (anon_file_id not null). כדי לאפשר גם שליחת התקציר הראשוני (טקסט, ללא
-- קובץ) עם אותו מנגנון תיעוד קיים בדיוק (לא נבנה מנגנון מקביל, כנדרש
-- בסעיף 6+9 באפיון), צריך: עמודת distribution_type, עמודת summary_snapshot,
-- והפיכת anon_file_id ל-nullable + עדכון מדיניות ה-INSERT בהתאם.
-- ============================================================================

alter table anon_distributions
  add column if not exists distribution_type text not null default 'extended'
    check (distribution_type in ('primary','extended'));
comment on column anon_distributions.distribution_type is 'primary = תקציר ראשוני (טקסט, ללא קובץ) | extended = תקציר מורחב (קובץ, anon_file_id/anon_file_source)';

alter table anon_distributions
  add column if not exists summary_snapshot text;
comment on column anon_distributions.summary_snapshot is 'תמונת מצב של anon_summary בזמן השליחה (רק כאשר distribution_type=primary) - כדי שהתיעוד ישאר מדויק גם אם התקציר יעודכן אחר כך';

-- anon_file_id חייב עכשיו להיות nullable (שליחת תקציר ראשוני אינה מפנה
-- לשום קובץ בכלל). ה-FK הקשיח כבר הוסר ב-2026-08-19j; כאן רק מסירים את
-- ה-NOT NULL שנשאר מההגדרה המקורית.
alter table anon_distributions alter column anon_file_id drop not null;
alter table anon_distributions alter column anon_file_source drop not null;

-- עדכון מדיניות ה-INSERT: מוסיפים ענף primary (ללא קובץ בכלל) לצד שני
-- הענפים הקיימים (sale_file/file_meta) - לא משנים אותם. בענף primary
-- הבדיקה היא שהעסק אכן פעיל בכרטיס האנונימי ושיש לו בפועל תקציר טקסט
-- מוכן (אחרת אין מה לשלוח) - אותה רמת הגנה בדיוק כמו הענפים הקיימים.
drop policy if exists "anon_dist_insert" on anon_distributions;
create policy "anon_dist_insert" on anon_distributions
  for insert with check (
    sender_user_id = auth.uid()
    and exists (
      select 1 from leads l where l.id = buyer_id
      and (l.created_by = auth.uid() or l.handled_by = auth.uid()
           or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager')))
    )
    and (
      (distribution_type = 'primary' and anon_file_id is null and exists (
        select 1 from businesses b
        where b.id = anon_distributions.business_id
          and b.anon_card_active = true
          and (b.anon_summary is not null or b.anon_display_name is not null)
      ))
      or
      (distribution_type = 'extended' and anon_file_source = 'sale_file' and exists (
        select 1 from business_sale_files f
        where f.id = anon_file_id and f.business_id = anon_distributions.business_id
          and f.confidentiality_level = 1 and f.status = 'active'
          and is_business_anon_card_active(f.business_id)
      ))
      or
      (distribution_type = 'extended' and anon_file_source = 'file_meta' and exists (
        select 1 from business_file_meta m
        where m.id = anon_file_id and m.business_id = anon_distributions.business_id
          and (is_anon_filename(coalesce(m.display_name, m.original_filename)) or m.category = 'מצגת אנונימית')
          and is_business_anon_card_active(m.business_id)
      ))
    )
  );

-- ----------------------------------------------------------------------------
-- הרחבת ה-RLS הקיימת כך שתכיר גם בסיווג-קטגוריה (לא רק שם קובץ) לצורך
-- צפייה/הפצה של תקציר מורחב ע"י סוכן עם גישה אנונימית בלבד - עקבי עם
-- העיקרון שקטגוריה היא המקור האמין (סעיף 2 באפיון), בלי לפגוע במה שכבר
-- עבד לפי שם קובץ (OR, לא replace).
-- ----------------------------------------------------------------------------
drop policy if exists "business_file_meta_anon_view_select" on business_file_meta;
create policy "business_file_meta_anon_view_select" on business_file_meta
  for select using (
    (is_anon_filename(coalesce(display_name, original_filename)) or category = 'מצגת אנונימית')
    and is_business_anon_card_active(business_id)
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
  );

drop policy if exists "business_files_meta_anon_view_select" on storage.objects;
create policy "business_files_meta_anon_view_select" on storage.objects
  for select using (
    bucket_id = 'business-files'
    and exists (
      select 1 from business_file_meta m
      where m.storage_path = storage.objects.name
        and (is_anon_filename(coalesce(m.display_name, m.original_filename)) or m.category = 'מצגת אנונימית')
        and is_business_anon_card_active(m.business_id)
    )
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
  );
