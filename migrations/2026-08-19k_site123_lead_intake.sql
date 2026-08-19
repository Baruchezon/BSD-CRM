-- BSD CRM - קליטה אוטומטית של לידים ממיילים של SITE123
--
-- טבלת מעקב בלבד. לא נוגע בטבלאות leads/tasks הקיימות - הפונקציה משתמשת
-- בעמודות הקיימות שלהן כמו שהן (source, notes, status וכו').
--
-- מטרת הטבלה:
--   1. מניעת עיבוד כפול של אותו מייל (unique על gmail_message_id).
--   2. שמירת "טופס" מלא (raw + parsed) לצורך ביקורת/דיבוג בלי לגעת בליד עצמו.
--   3. יומן שקוף: כל מייל שנבדק, גם אם הוחלט לדלג עליו (לא ליד) או שהייתה שגיאה,
--      כדי שאף מייל לא "ייעלם בשקט" בגלל תקלה זמנית - יעובד שוב בריצה הבאה.

create table if not exists site123_lead_emails (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,   -- Message-ID header של המייל - מפתח למניעת כפילות עיבוד
  received_at timestamptz,
  raw_subject text,
  raw_body text,
  parsed jsonb,                            -- השדות שחולצו (שם/טלפון/מייל/מטרה/הודעה/תאריך וכו')
  classification text,                     -- buyer / seller / partner / unclassified / not_a_lead
  needs_review boolean not null default false,   -- לא ניתן לסווג בוודאות - להציג לבדיקה
  action text not null default 'pending',  -- pending / created / merged / skipped_not_lead / error
  lead_id uuid references leads(id) on delete set null,
  matched_existing boolean not null default false,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_site123_lead_emails_action on site123_lead_emails(action);
create index if not exists idx_site123_lead_emails_lead on site123_lead_emails(lead_id);

alter table site123_lead_emails enable row level security;

-- כמו שאר טבלאות המערכת - חשיפה רק ל-admin/manager (סוכנים לא צריכים לראות את
-- "מטבח" קליטת המיילים, רק את הלידים שנוצרים ממנה, שכבר מוגנים ב-RLS של leads).
drop policy if exists site123_lead_emails_select on site123_lead_emails;
create policy site123_lead_emails_select on site123_lead_emails
  for select using (is_admin_or_manager(auth.uid()));

-- אין insert/update/delete מהצד של הדפדפן בכלל - רק ה-Edge Function (עם
-- service_role key, שעוקף RLS) כותבת לטבלה הזו. לכן לא מגדירים policy לכתיבה
-- לתפקידים רגילים (ברירת המחדל היא חסימה מוחלטת לכל מי שאינו service_role).
