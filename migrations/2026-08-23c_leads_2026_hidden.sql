-- BSD CRM — "הסרה" (מחיקה רכה) מרשימת "לידים 2026" בלבד
--
-- רקע/בטיחות: כפתור המחיקה הכללי הקיים ב-leads-hub.html מפעיל DELETE אמיתי
-- על טבלת leads עצמה. זה אסור במפורש בטאב "לידים 2026" - הרשימה הזו היא
-- view בלבד על leads, ו"הסרה" ממנה חייבת להשפיע רק על התצוגה, בלי שום
-- DELETE/UPDATE על leads/businesses/buyers/partners/מתעניינים בקורס.
--
-- הפתרון: טבלה עצמאית לחלוטין, ללא שום פעולת כתיבה על טבלה אחרת:
--   - "הסרה" = insert שורה אחת לטבלה הזו (never DELETE/UPDATE על leads).
--   - "שחזור" = delete של אותה שורה מהטבלה הזו בלבד (אף פעם לא נוגע ב-lead עצמו).
--   - lead_id הוא unique - מונע הסתרה כפולה של אותו ליד (insert שני ייכשל
--     על הפרת ה-unique, בכוונה - כדי שלא ייווצר מצב לא עקבי).
--   - FK ל-leads(id) עם ON DELETE CASCADE בכיוון אחד בלבד: אם ה-lead
--     המקורי יימחק (מחיקה חוקית, במקום אחר לגמרי במערכת - לא כאן), שורת
--     ההסתרה שמצביעה עליו תימחק אוטומטית בעקבותיו (ניקוי הגיוני - אין טעם
--     "להסתיר" ליד שכבר לא קיים). הכיוון ההפוך אף פעם לא קיים: אין שום
--     טריגר/פונקציה בקובץ הזה שמוחקת או משנה שורת leads בעקבות פעולה על
--     leads_2026_hidden. במילים אחרות: מחיקת leads ---> מוחקת כאן (cascade
--     תקין וסטנדרטי, ולא חוסם מחיקה חוקית עתידית של הליד המקורי). לעולם לא
--     כאן ---> leads.
--   - RLS: אדמין בלבד - select/insert/delete. מנהל (manager) וסוכנים אין
--     להם שום גישה לטבלה הזו כלל, כולל קריאה (בניגוד לרוב הטבלאות
--     האחרות במערכת שבהן manager שווה ל-admin - כאן זה נדרש במפורש).
--   - כל insert/delete נרשם ל-audit_log הכללי הקיים (לא טבלת יומן חדשה)
--     ע"י טריגר security definer, כדי שהתיעוד לא יהיה תלוי בקוד האפליקציה
--     ולא ניתן לדלג עליו מצד הלקוח.

create table if not exists leads_2026_hidden (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references leads(id) on delete cascade,
  hidden_by uuid references profiles(id),
  hidden_at timestamptz not null default now(),
  hidden_reason text
);
create index if not exists idx_leads_2026_hidden_lead on leads_2026_hidden(lead_id);

alter table leads_2026_hidden enable row level security;

drop policy if exists "leads_2026_hidden_admin_only" on leads_2026_hidden;
create policy "leads_2026_hidden_admin_only" on leads_2026_hidden
  for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
-- for all = select/insert/update/delete יחד, ומ-manager/agent_authorized/agent
-- חסום לגמרי (לא רק ל-'admin,manager' כמו ברוב שאר המערכת - כאן נדרש admin בלבד).

-- תיעוד ביומן הפעילות הכללי הקיים (audit_log: table_name, record_id, action,
-- actor_id, occurred_at, details) - לא טבלת יומן חדשה. security definer כדי
-- שהתיעוד יקרה תמיד, גם אם מישהו יכתוב לטבלה הזו ישירות דרך ה-API (לא רק
-- דרך הכפתור באפליקציה).
create or replace function bsd_log_leads_2026_hidden_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (TG_OP = 'INSERT') then
    insert into audit_log(table_name, record_id, action, actor_id, details)
    values ('leads_2026_hidden', new.lead_id, 'hide_from_2026_list', new.hidden_by,
      jsonb_build_object('reason', new.hidden_reason));
    return new;
  elsif (TG_OP = 'DELETE') then
    insert into audit_log(table_name, record_id, action, actor_id, details)
    values ('leads_2026_hidden', old.lead_id, 'restore_to_2026_list', auth.uid(),
      jsonb_build_object('was_hidden_by', old.hidden_by, 'was_hidden_at', old.hidden_at, 'was_reason', old.hidden_reason));
    return old;
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_leads_2026_hidden_audit on leads_2026_hidden;
create trigger trg_leads_2026_hidden_audit
  after insert or delete on leads_2026_hidden
  for each row execute function bsd_log_leads_2026_hidden_change();
