-- ============================================================================
-- BSD-CRM — שלב 3: הקלטה, תמלול, ניתוח AI (Migration בטוח)
-- תאריך: 13/08/2026
-- הרצה: Supabase SQL Editor, בדיוק כמו migrations קודמים.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. עמודה חדשה ב-match_meetings: שמירת התמלול הגולמי לעיון/ביקורת
--    (לא חובה לפי האפיון, אך מאפשרת לבדוק מה ה-AI התבסס עליו אם יש ספק)
-- ---------------------------------------------------------------------------
alter table match_meetings add column if not exists raw_transcript text;

-- ---------------------------------------------------------------------------
-- 2. Storage bucket זמני להקלטות אודיו - פרטי (לא public), נמחק אוטומטית
--    ע"י ה-Edge Function לאחר תמלול+ניתוח מוצלחים.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('temp-audio', 'temp-audio', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RLS על storage.objects לבאקט הזה - אותו דפוס הרשאות כמו שאר המערכת:
--    admin/manager/agent_authorized יכולים הכול; agent רק על מה שהוא יצר
--    (מזוהה לפי תיקיית match_id בנתיב הקובץ - path נראה כך: {match_id}/{filename}).
-- ---------------------------------------------------------------------------
drop policy if exists "temp_audio_admin_manager_full" on storage.objects;
create policy "temp_audio_admin_manager_full" on storage.objects
  for all using (
    bucket_id = 'temp-audio'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager','agent_authorized'))
  );

drop policy if exists "temp_audio_agent_own" on storage.objects;
create policy "temp_audio_agent_own" on storage.objects
  for all using (
    bucket_id = 'temp-audio'
    and exists (
      select 1 from matches m
      where m.id::text = (storage.foldername(name))[1]
      and (
        exists (select 1 from businesses b where b.id = m.business_id and b.created_by = auth.uid())
        or exists (select 1 from leads l where l.id = m.buyer_id and l.created_by = auth.uid())
      )
    )
  );

-- ============================================================================
-- הערה: ה-Edge Function (analyze-meeting-audio) משתמשת ב-Service Role Key
-- שעוקף RLS לצורך הורדה/מחיקה של קבצים - כך שגם אם משתמש מסוים לא רשאי
-- לקרוא ישירות מה-bucket, השרת (הפונקציה) עדיין יכול לעבד את הקובץ שהוא
-- עצמו רק העלה. ה-RLS למעלה מגן על גישה ישירה מהדפדפן בלבד.
-- ============================================================================
