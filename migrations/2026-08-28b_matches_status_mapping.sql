-- Stage 2 of the matches-module upgrade: status mapping migration.
-- Safe by construction: the ORIGINAL status text is preserved forever in the
-- new legacy_status column before anything is changed. No row is deleted.
-- Any match whose old status doesn't cleanly fit the new 16-status model is
-- marked 'נדרש עדכון' rather than guessed, per his explicit instruction.

alter table public.matches
  add column if not exists legacy_status text;

-- Freeze the original value first, only for rows not yet migrated.
update public.matches
set legacy_status = status
where legacy_status is null;

-- Apply the approved mapping (old -> new), record an audit row in
-- match_activity_log for every match whose status actually changes.
with mapping(old_status, new_status) as (
  values
    ('חומר מורחב נשלח', 'חומרים מלאים נשלחו'),
    ('לא מתאים לקונה', 'הקונה לא מעוניין'),
    ('נשלח לקונה - ממתין לתגובה (אנונימי)', 'מידע ראשוני נשלח'),
    ('נשלח לקונה', 'מידע ראשוני נשלח'),
    ('מתעניין', 'הקונה מעוניין'),
    ('בבדיקה כלכלית', 'בבדיקת נתונים'),
    ('נשלחו מסמכים לאחר חתימת הסכם', 'חומרים מלאים נשלחו'),
    ('ממתין לתגובת קונה', 'ממתין לתגובה'),
    ('משא ומתן', 'במשא ומתן'),
    ('שיחה עם בעל העסק', 'נדרש עדכון'),
    ('נקבעה פגישה', 'נקבעה פגישה'),
    ('התקיימה פגישה', 'התקיימה פגישה')
),
changed as (
  update public.matches m
  set status = mp.new_status
  from mapping mp
  where m.legacy_status = mp.old_status
    and m.status <> mp.new_status
  returning m.id, mp.old_status, mp.new_status
)
insert into public.match_activity_log (match_id, action_type, description, note)
select id,
       'מיגרציית סטטוסים',
       'שינוי אוטומטי כחלק משדרוג מודול ההתאמות (28.08.2026)',
       'סטטוס קודם: "' || old_status || '" -> סטטוס חדש: "' || new_status || '"'
from changed;
