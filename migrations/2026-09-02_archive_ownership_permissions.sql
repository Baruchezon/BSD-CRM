-- ============================================================================
-- BSD-CRM — הסדרת הרשאות ניהול (עריכה/מחיקה/ארכיון/שחזור) לעסקים וקונים
-- תאריך: 02/09/2026
-- הרצה: Supabase SQL Editor. אדיטיבי בלבד ברמת נתונים - לא מוחק כלום.
--
-- ממצא מרכזי מהבדיקה שקדמה למיגרציה זו (RLS חי נבדק ישירות מול production
-- לפני כל שינוי): has_full_business_access ו-is_admin() כבר מעניקים לאדמין
-- גישת update/delete מלאה על כל עסק/קונה, ללא קשר ליוצר. הבעיה האמיתית
-- שנמצאה הפוכה: businesses_delete/leads_delete לא כללו בכלל ענף "יוצר",
-- ו-archiveBiz/archiveLead/restoreBizFromArchive/restoreLeadFromArchive
-- ב-Frontend היו נעולים ל-admin בלבד (בדיקת role בקוד JS) - כך שדווקא
-- המשתמש הרגיל לא יכול היה לנהל את הכרטיסים שהוא עצמו יצר, לא האדמין.
-- המיגרציה הזו סוגרת את שני הכיוונים: אדמין ממשיך לקבל גישה מלאה תמיד,
-- ומשתמש רגיל מקבל שליטה מלאה (עריכה/מחיקה/ארכיון/שחזור) על מה שהוא יצר.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. businesses_delete: הוספת ענף יוצר/מטפל, לצד admin/manager הקיים (ללא שינוי).
-- ----------------------------------------------------------------------------
drop policy if exists "businesses_delete" on businesses;
create policy "businesses_delete" on businesses for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  or created_by = auth.uid()
  or handled_by = auth.uid()
);

-- ----------------------------------------------------------------------------
-- 2. leads_delete: הוספת ענף יוצר (created_by) לכל סוגי הליד, כמו ב-leads_update
--    הקיימת. seller ממשיך גם עם handled_by/manager כמו קודם, ללא רגרסיה.
-- ----------------------------------------------------------------------------
drop policy if exists "leads_delete" on leads;
create policy "leads_delete" on leads for delete using (
  is_admin()
  or (
    type = 'seller' and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'manager')
      or created_by = auth.uid()
      or handled_by = auth.uid()
    )
  )
  or (
    type in ('buyer','partner') and created_by = auth.uid()
  )
);

-- ----------------------------------------------------------------------------
-- 3. get_business_history_summary: היה admin/manager בלבד - כעת גם יוצר/מטפל
--    של אותו עסק ספציפי (לא כל עסק), כדי שמשתמש רגיל שמוחק עסק שהוא יצר
--    יוכל לעבור את בדיקת ההיסטוריה שמונעת מחיקה פיזית שגויה (בדיוק כמו
--    שהמנגנון הזה כבר עובד לאדמין היום ב-deleteBiz).
-- ----------------------------------------------------------------------------
create or replace function get_business_history_summary(biz_id uuid)
returns table(table_name text, row_count bigint)
language plpgsql security definer
set search_path = public
as $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','manager')
  ) AND NOT EXISTS (
    SELECT 1 FROM businesses b WHERE b.id = biz_id AND (b.created_by = auth.uid() OR b.handled_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'permission denied: admin/manager or owner only';
  END IF;

  RETURN QUERY
  SELECT 'matches', count(*) FROM matches WHERE business_id = biz_id
  UNION ALL
  SELECT 'tasks', count(*) FROM tasks WHERE business_id = biz_id
  UNION ALL
  SELECT 'match_meetings', count(*) FROM match_meetings WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_number_correction_log', count(*) FROM business_number_correction_log WHERE business_id = biz_id
  UNION ALL
  SELECT 'anon_distributions', count(*) FROM anon_distributions WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_sale_files', count(*) FROM business_sale_files WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_file_meta', count(*) FROM business_file_meta WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_access_requests', count(*) FROM business_access_requests WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_access_grants', count(*) FROM business_access_grants WHERE business_id = biz_id
  UNION ALL
  SELECT 'business_access_audit', count(*) FROM business_access_audit WHERE business_id = biz_id
  UNION ALL
  SELECT 'files_meta', count(*) FROM files_meta WHERE business_id = biz_id
  UNION ALL
  SELECT 'public_inquiries', count(*) FROM public_inquiries WHERE business_id = biz_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. get_lead_history_summary: אותו דפוס בדיוק, חדש לגמרי (לא היה קיים) -
--    כדי ש-deleteLead יוכל לבצע Soft-Delete-אם-יש-היסטוריה בדיוק כמו deleteBiz,
--    עכשיו שגם ליוצר-לא-אדמין יש הרשאת מחיקה על ליד שהוא יצר בעצמו.
-- ----------------------------------------------------------------------------
create or replace function get_lead_history_summary(p_lead_id uuid)
returns table(table_name text, row_count bigint)
language plpgsql security definer
set search_path = public
as $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','manager')
  ) AND NOT EXISTS (
    SELECT 1 FROM leads l WHERE l.id = p_lead_id AND (l.created_by = auth.uid() OR l.handled_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'permission denied: admin/manager or owner only';
  END IF;

  RETURN QUERY
  SELECT 'matches'::text, count(*) FROM matches m WHERE m.buyer_id = p_lead_id
  UNION ALL
  SELECT 'tasks'::text, count(*) FROM tasks t WHERE t.buyer_id = p_lead_id
  UNION ALL
  SELECT 'match_meetings'::text, count(*) FROM match_meetings mm WHERE mm.buyer_id = p_lead_id
  UNION ALL
  SELECT 'client_number_correction_log'::text, count(*) FROM client_number_correction_log c WHERE c.lead_id = p_lead_id
  UNION ALL
  SELECT 'anon_distributions'::text, count(*) FROM anon_distributions a WHERE a.buyer_id = p_lead_id
  UNION ALL
  SELECT 'lead_access_grants'::text, count(*) FROM lead_access_grants g WHERE g.lead_id = p_lead_id
  UNION ALL
  SELECT 'lead_access_audit'::text, count(*) FROM lead_access_audit au WHERE au.lead_id = p_lead_id
  UNION ALL
  SELECT 'signed_agreements'::text, count(*) FROM signed_agreements sa WHERE sa.table_name = 'leads' AND sa.record_id = p_lead_id
  UNION ALL
  SELECT 'record_notes'::text, count(*) FROM record_notes rn WHERE rn.table_name = 'leads' AND rn.record_id = p_lead_id;
END;
$$;
-- תיקון 02.09.2026 (אותו יום): הגרסה הראשונה נכשלה בפועל בבדיקה (ambiguous
-- column "table_name" מול signed_agreements/record_notes) - תוקן מיד ל-alias
-- מפורש לכל טבלה, ואומת שוב בהצלחה לפני שהמשך העבודה המשיך.

revoke all on function get_lead_history_summary(uuid) from public, anon;
grant execute on function get_lead_history_summary(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. אכיפת שדות ארכיון בשרת (הגנה כפולה - לא רק ממשק): מי שביצע/מתי/למה
--    בארכוב לא יכולים להיזויף מהלקוח, ושחזור מוגבל לאדמין או למי שארכב
--    בעצמו. פועל על UPDATE, לפני trg_*_touch (סדר אלפביתי - 'archive' < 'touch').
-- ----------------------------------------------------------------------------
create or replace function enforce_business_archive_integrity()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_archived is distinct from new.is_archived then
    if new.is_archived and not old.is_archived then
      if new.archive_reason is null or trim(new.archive_reason) = '' then
        raise exception 'נדרשת סיבה להעברה לארכיון';
      end if;
      new.archived_by := auth.uid();
      new.archived_at := now();
    elsif old.is_archived and not new.is_archived then
      if not (
        exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
        or old.archived_by = auth.uid()
      ) then
        raise exception 'שחזור מהארכיון מותר רק לאדמין או למי שהעביר את הכרטיס לארכיון';
      end if;
      new.archived_at := null;
      new.archived_by := null;
      new.archive_reason := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_businesses_archive_integrity on businesses;
create trigger trg_businesses_archive_integrity
  before update on businesses
  for each row execute function enforce_business_archive_integrity();

create or replace function enforce_lead_archive_integrity()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_archived is distinct from new.is_archived then
    if new.is_archived and not old.is_archived then
      if new.archive_reason is null or trim(new.archive_reason) = '' then
        raise exception 'נדרשת סיבה להעברה לארכיון';
      end if;
      new.archived_by := auth.uid();
      new.archived_at := now();
    elsif old.is_archived and not new.is_archived then
      if not (
        exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
        or old.archived_by = auth.uid()
      ) then
        raise exception 'שחזור מהארכיון מותר רק לאדמין או למי שהעביר את הכרטיס לארכיון';
      end if;
      new.archived_at := null;
      new.archived_by := null;
      new.archive_reason := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_leads_archive_integrity on leads;
create trigger trg_leads_archive_integrity
  before update on leads
  for each row execute function enforce_lead_archive_integrity();

COMMIT;

-- ============================================================================
-- הערה: audit log לא דורש שינוי - trg_businesses_touch/trg_leads_touch (שתיהן
-- כבר קיימות, function משותפת trg_touch_and_log) כבר רושמות ל-activity_log כל
-- update/delete כולל שינוי is_archived, עם old_value/new_value מלאים
-- ו-user_id=auth.uid(). זה מכסה גם עריכה, מחיקה, ארכיון, שחזור, ושליחת הסכם
-- (כולן עוברות update() רגיל על businesses/leads) - נבדק בקוד לפני כתיבת
-- המיגרציה, לא הונח כברירת מחדל.
-- ============================================================================
