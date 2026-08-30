-- BSD CRM - קישור בין "לידים להכשרה" (leads.website_intake_stage='training')
-- לבין כרטיס מתעניין (training_leads), בלי לגעת בשום טבלה/עמודה קיימת.
--
-- עד כה website_intake_stage='training' היה מבוי סתום: מסומן ידנית ב-
-- leads-hub.html אבל שום מסך לא קרא אותו. המיגרציה הזו רק מוסיפה עמודות
-- חדשות ל-training_leads שמאפשרות לקשר כרטיס מתעניין לליד המקורי שממנו
-- הוא נוצר, לשמור את תוכן הפנייה המקורי ואת מקורה, ולמנוע כפילויות.
alter table training_leads add column if not exists lead_id uuid references leads(id) on delete set null;
alter table training_leads add column if not exists source text;
alter table training_leads add column if not exists original_inquiry text;

create index if not exists idx_training_leads_lead_id on training_leads(lead_id) where lead_id is not null;

-- הרחבה (30.08.2026, אותו יום): מנגנון "לא לאבד ליד בשקט" - מייל שנכשל
-- בעיבוד (parse/classify/DB) כבר מסומן action='error' ומנוסה שוב אוטומטית,
-- אבל עד כה בלי שום התראה לאדמין - אם הכישלון נמשך, אף אחד לא היה יודע.
-- error_alerted_at מונע הצפה: מתריעים פעם אחת בלבד לכל מייל כושל, לא בכל ריצה חוזרת.
alter table site123_lead_emails add column if not exists error_alerted_at timestamptz;

-- הרחבה שנייה (30.08.2026): מחיקה רכה למתעניינים, במקום DELETE אמיתי -
-- אותה מוסכמה בדיוק כמו leads.is_archived/archived_at/archived_by/
-- archive_reason (leads.html: archiveLead/restoreLeadFromArchive), כדי
-- שלא לאבד מידע בטעות בלחיצת מחיקה. לא נוגע במחיקה בפועל בשום מקום.
alter table training_leads add column if not exists is_archived boolean not null default false;
alter table training_leads add column if not exists archived_at timestamptz;
alter table training_leads add column if not exists archived_by uuid references profiles(id);
alter table training_leads add column if not exists archive_reason text;
create index if not exists idx_training_leads_is_archived on training_leads(is_archived) where is_archived=true;
