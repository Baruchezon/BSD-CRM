-- BSD CRM - "לידים מהאתר": תיבת קליטה נפרדת ללידים חדשים מהאתר (SITE123)
--
-- עד כה האוטומציה סיווגה כל ליד ישר ל-type='buyer'/'seller'/'partner' ברגע
-- הקליטה (גם כשלא הייתה ודאות), מה שגרם לו "להיעלם" בתוך רשימות הקונים/
-- המוכרים הרגילות בלי שהוא סימן שדיבר עם הלקוח. המיגרציה הזו לא הופכת אף
-- טבלה קיימת - רק מוסיפה עמודות ל-leads שמאפשרות לשמור כל ליד אתר חדש
-- ב"תיבת קליטה" נפרדת עד לאישור ידני מפורש, בלי לגעת בשום דבר אחר.
--
-- website_intake_stage:
--   'new'       - התקבל מהאתר, עדיין לא סומן "שוחחתי עם הלקוח"
--   'contacted' - סומן "שוחחתי עם הלקוח", ממתין לסיווג/שמירה
--   'training'  - שויך ל"מתעניין בהכשרה" (אין טאב קונים/מוכרים מתאים, נשאר כאן לצמיתות)
--   null        - לא ליד-אתר בכלל, או שכבר הועבר סופית לטאב המתאים (קונה/מוכר/שותף)
alter table leads add column if not exists website_intake_stage text;
alter table leads add column if not exists website_purpose_guess text;      -- ניחוש בלבד להצגה - לעולם לא סיווג סופי
alter table leads add column if not exists intake_conversation_summary text; -- מהות השיחה
alter table leads add column if not exists intake_conversation_notes text;   -- הערות
alter table leads add column if not exists intake_customer_wants text;       -- מה הלקוח מחפש
alter table leads add column if not exists intake_important_details text;    -- פרטים חשובים שעלו בשיחה
alter table leads add column if not exists intake_reviewed_at timestamptz;
alter table leads add column if not exists intake_reviewed_by uuid references profiles(id);

create index if not exists idx_leads_website_intake_stage on leads(website_intake_stage) where website_intake_stage is not null;

-- העברה חד-פעמית: לידים שכבר נוצרו ע"י האוטומציה הישנה (סטטוס 'חדש מהאתר')
-- ועדיין לא טופלו כלל (אין להם עדיין סיכום שיחה) - מוזזים לתיבת הקליטה
-- החדשה כדי שלא "ייעלמו", בלי לגעת בלידים שכבר טופלו/הועברו בעבר.
update leads
set website_intake_stage = 'new', status = 'חדש'
where status = 'חדש מהאתר'
  and website_intake_stage is null
  and intake_conversation_summary is null;
