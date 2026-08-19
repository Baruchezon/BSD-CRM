-- ============================================================================
-- BSD-CRM — זיהוי אוטומטי של קבצים אנונימיים לפי שם קובץ (business_file_meta)
-- תאריך: 19/08/2026
-- ----------------------------------------------------------------------------
-- הבעיה: עד היום, קבצים אנונימיים שחשופים למי שיש לו can_view_anonymous_businesses
-- (למשל סוכן מורשה) הגיעו רק מ-business_sale_files עם confidentiality_level=1
-- (ראו 2026-08-19f/g). קבצים שהאדמין מעלה דרך אזור "קבצים מצורפים" הכללי
-- בכרטיס העסק (business_file_meta) לא נחשפו בכלל, כי ה-RLS שלהם
-- (business_file_meta_select, ב-2026-08-17_business_file_meta.sql) דורש
-- has_full_business_access - בדיוק מה שסוכן מורשה בתפקיד "אנונימי" אין לו.
--
-- הפתרון: זיהוי לפי *שם הקובץ* (לא צריך שדה/דגל נפרד, לא צריך שהאדמין יסמן
-- שום דבר ידנית) - קובץ ששמו (display_name, ואם אין אז original_filename)
-- מכיל את המילה "אנונימי" נחשב אוטומטית מאושר להפצה אנונימית. "אנונימי" הוא
-- תת-מחרוזת של "אנונימית" (עברית לא מבחינה רישיות), אז תבנית אחת מכסה את
-- שתי הצורות. זה חל אוטומטית גם על קבצים קיימים (ברגע שיש להם שורת
-- מטא-דאטה - ראו backfill בצד הלקוח ב-loadBizFiles) וגם על קבצים עתידיים,
-- בלי migration/סימון נוסף בכל פעם.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. עוזר זיהוי שם קובץ אנונימי - פונקציה אחת, קריאה משני מקומות (RLS למטה
--    וגם מהלקוח דרך JS מקביל בביזנס.html, כדי ששני הצדדים יתאימו תמיד).
-- ---------------------------------------------------------------------------
create or replace function public.is_anon_filename(p_name text)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_name, '') ~ 'אנונימי';
$function$;

-- ---------------------------------------------------------------------------
-- 2. הרשאת קריאה לשורות business_file_meta שעונות על שני התנאים: שם הקובץ
--    מזוהה כאנונימי, והעסק פעיל בכרטיס האנונימי (is_business_anon_card_active,
--    כבר קיימת מ-2026-08-19g - עוקפת RLS עצמי של businesses בכוונה, אותה
--    בעיה בדיוק שתוקנה שם). זו מדיניות select *נוספת* - לא מחליפה את
--    business_file_meta_select הקיימת (מי שיש לו full_business_access ממשיך
--    לראות הכל כרגיל דרך המדיניות ההיא, בלי שינוי).
-- ---------------------------------------------------------------------------
drop policy if exists "business_file_meta_anon_view_select" on business_file_meta;
create policy "business_file_meta_anon_view_select" on business_file_meta
  for select using (
    is_anon_filename(coalesce(display_name, original_filename))
    and is_business_anon_card_active(business_id)
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
  );

-- אותו עיקרון על ה-Storage עצמו (בלי זה, ה-URL החתום על הקובץ עצמו ייכשל
-- גם אם שורת המטא-דאטה נגישה - בדיוק כמו העיקרון ב-business_files_anon_view_select
-- הקיימת לקבצי תיק המכירה).
drop policy if exists "business_files_meta_anon_view_select" on storage.objects;
create policy "business_files_meta_anon_view_select" on storage.objects
  for select using (
    bucket_id = 'business-files'
    and exists (
      select 1 from business_file_meta m
      where m.storage_path = storage.objects.name
        and is_anon_filename(coalesce(m.display_name, m.original_filename))
        and is_business_anon_card_active(m.business_id)
    )
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
  );

-- ---------------------------------------------------------------------------
-- 3. anon_distributions (מעקב הפצות, 2026-08-19f) צריך לתעד גם שליחה של קובץ
--    ממקור business_file_meta, לא רק business_sale_files. anon_file_id היה
--    מוגבל ב-FK קשיח ל-business_sale_files בלבד - לא ניתן להצביע על שתי
--    טבלאות בבת אחת עם FK רגיל, אז מסירים את ה-FK הקשיח ומוסיפים עמודת
--    מקור; אימות השייכות בפועל (שהקובץ אכן קיים, אנונימי ושייך לעסק הנכון)
--    עובר עכשיו במלואו למדיניות ה-INSERT למטה במקום ל-FK - אותה רמת הגנה,
--    רק גמישה מספיק לשני המקורות.
-- ---------------------------------------------------------------------------
alter table anon_distributions drop constraint if exists anon_distributions_anon_file_id_fkey;
alter table anon_distributions add column if not exists anon_file_source text not null default 'sale_file'
  check (anon_file_source in ('sale_file','file_meta'));
comment on column anon_distributions.anon_file_source is 'מאיזו טבלה מגיע anon_file_id - business_sale_files (תיק מכירה, confidentiality_level=1) או business_file_meta (קובץ מזוהה אוטומטית לפי שם)';

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
      (anon_file_source = 'sale_file' and exists (
        select 1 from business_sale_files f
        where f.id = anon_file_id and f.business_id = anon_distributions.business_id
          and f.confidentiality_level = 1 and f.status = 'active'
          and is_business_anon_card_active(f.business_id)
      ))
      or
      (anon_file_source = 'file_meta' and exists (
        select 1 from business_file_meta m
        where m.id = anon_file_id and m.business_id = anon_distributions.business_id
          and is_anon_filename(coalesce(m.display_name, m.original_filename))
          and is_business_anon_card_active(m.business_id)
      ))
    )
  );
