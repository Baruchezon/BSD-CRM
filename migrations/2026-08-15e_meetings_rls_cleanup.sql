-- ============================================================================
-- BSD-CRM — תיקון אותה בעיה על match_meetings (הקלטות/סיכומי פגישות)
-- תאריך: 15/08/2026 (המשך הבדיקה שמצאה את אותה בעיה על matches)
-- ============================================================================
-- אותה מחלת: migrations/2026-08-13_stage2_meetings_summaries.sql יצרה
-- "agent_authorized_view_all_meetings" - מדיניות select גורפת לכל agent_
-- authorized על כל ההקלטות/סיכומי הפגישות במערכת (כולל תמלולים מלאים),
-- לפי ההגדרה הישנה והרחבה. לא הוחלפה עד כה כי לא נגעתי במשימות עד השלב
-- הזה. מחליף אותה במדיניות שתואמת בדיוק את has_full_business_access.
-- own_created_meetings (מ-general_recordings_rls) נשארת כמו שהיא - תמיד
-- נכון שהיוצר יראה את מה שהוא הקליט בעצמו.
-- ============================================================================

drop policy if exists "admin_manager_full_access_meetings" on match_meetings;
drop policy if exists "agent_authorized_view_all_meetings" on match_meetings;
drop policy if exists "agent_authorized_edit_own_meetings" on match_meetings;
drop policy if exists "agent_authorized_update_own_meetings" on match_meetings;
drop policy if exists "agent_own_only_meetings" on match_meetings;
-- own_created_meetings לא נוגעים בה - נשארת.

create policy "meetings_admin_manager_full" on match_meetings
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  );

create policy "meetings_full_business_access" on match_meetings
  for select using (
    (business_id is not null and has_full_business_access(business_id, auth.uid()))
    or (buyer_id is not null and exists (select 1 from leads l where l.id = buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid())))
    or (match_id is not null and exists (
      select 1 from matches m where m.id = match_id
      and (
        has_full_business_access(m.business_id, auth.uid())
        or exists (select 1 from leads l where l.id = m.buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
      )
    ))
  );

create policy "meetings_full_business_insert" on match_meetings
  for insert with check (
    (business_id is not null and has_full_business_access(business_id, auth.uid()))
    or (buyer_id is not null and exists (select 1 from leads l where l.id = buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid())))
    or created_by = auth.uid()
  );

create policy "meetings_full_business_update" on match_meetings
  for update using (
    (business_id is not null and has_full_business_access(business_id, auth.uid()))
    or (buyer_id is not null and exists (select 1 from leads l where l.id = buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid())))
    or created_by = auth.uid()
  );

-- ============================================================================
-- אותה בעיה בדיוק (p.role in (...,'agent_authorized') גורף) קיימת גם ב-4
-- טבלאות עזר נוספות שנוצרו יחד עם matches/match_meetings ב-13.08. מתקן את
-- כולן כאן באותו מעבר, כדי לא להשאיר עוד "זליגות" מאותה מחלה.
-- ============================================================================

drop policy if exists "follow_parent_match_history" on match_status_history;
create policy "follow_parent_match_history" on match_status_history
  for all using (
    exists (
      select 1 from matches m
      where m.id = match_status_history.match_id
      and (
        exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
        or has_full_business_access(m.business_id, auth.uid())
        or exists (select 1 from leads l where l.id = m.buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
      )
    )
  );

drop policy if exists "follow_parent_match_participants" on match_participants;
create policy "follow_parent_match_participants" on match_participants
  for all using (
    exists (
      select 1 from matches m
      where m.id = match_participants.match_id
      and (
        exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
        or has_full_business_access(m.business_id, auth.uid())
        or exists (select 1 from leads l where l.id = m.buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
      )
    )
  );

drop policy if exists "follow_parent_meeting_participants" on meeting_participants;
create policy "follow_parent_meeting_participants" on meeting_participants
  for all using (
    exists (
      select 1 from match_meetings mm
      where mm.id = meeting_participants.meeting_id
      and (
        exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
        or mm.created_by = auth.uid()
        or (mm.business_id is not null and has_full_business_access(mm.business_id, auth.uid()))
        or (mm.buyer_id is not null and exists (select 1 from leads l where l.id = mm.buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid())))
      )
    )
  );

drop policy if exists "follow_parent_summary_versions" on meeting_summary_versions;
create policy "follow_parent_summary_versions" on meeting_summary_versions
  for all using (
    exists (
      select 1 from match_meetings mm
      where mm.id = meeting_summary_versions.meeting_id
      and (
        exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
        or mm.created_by = auth.uid()
        or (mm.business_id is not null and has_full_business_access(mm.business_id, auth.uid()))
        or (mm.buyer_id is not null and exists (select 1 from leads l where l.id = mm.buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid())))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- אותה בעיה גם ב-storage.objects עבור bucket temp-audio (הקלטות בתהליך
-- תמלול, לפני מחיקה) - נתן ל-agent_authorized גישה גורפת. הופך אותה לגישה
-- לפי בעלות/טיפול בהתאמה עצמה, בדיוק כמו match_meetings.
-- ---------------------------------------------------------------------------
drop policy if exists "temp_audio_admin_manager_full" on storage.objects;
create policy "temp_audio_admin_manager_full" on storage.objects
  for all using (
    bucket_id = 'temp-audio'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  );

drop policy if exists "temp_audio_agent_own" on storage.objects;
create policy "temp_audio_agent_own" on storage.objects
  for all using (
    bucket_id = 'temp-audio'
    and exists (
      select 1 from matches m
      where m.id::text = (storage.foldername(name))[1]
      and (
        has_full_business_access(m.business_id, auth.uid())
        or exists (select 1 from leads l where l.id = m.buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
      )
    )
  );
