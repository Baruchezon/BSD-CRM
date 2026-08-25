BEGIN;

-- תיקון ממוקד: מחיקת עסק ב-businesses.html (deleteBiz) הייתה נכשלת בשקט
-- (שגיאת foreign key מהשרת, שהוצגה כטקסט טכני לא ברור למשתמש) בכל עסק
-- שיש לו משימה (tasks), פגישת התאמה (match_meetings), או רשומת תיקון
-- מספר (business_number_correction_log) המקושרות אליו ישירות, וכן בכל
-- עסק שיש לו התאמה (match) עם פגישות/משימות/הפצת-אנונימי משלה - כי
-- ה-CASCADE של businesses->matches מנסה למחוק גם את ההתאמה, וזו נחסמת
-- באותה בעיה בדיוק ברמת ההתאמה.
--
-- אומת בפועל מול פרודקשן (25.08.2026): נסיון מחיקה אמיתי (בתוך
-- טרנזקציה עם ROLLBACK, בלי לשנות נתונים) על עסק אמיתי הניב בדיוק את
-- השגיאה:
--   ERROR: update or delete on table "businesses" violates foreign key
--   constraint "tasks_business_id_fkey" on table "tasks"
--
-- הפתרון: משימות, פגישות ורשומות תיקון מספר הן רשומות היסטוריה/פעילות
-- בעלות ערך עצמאי (משימה שבוצעה, פגישה שהתקיימה) - אין שום סיבה שהן
-- ימחקו רק כי כרטיס העסק נמחק. באותו העיקרון שכבר קיים במערכת עבור
-- public_inquiries.business_id (SET NULL קיים כבר), משנים גם את שש
-- המגבלות הבאות מ-NO ACTION ל-SET NULL: הרשומה התלויה נשארת, רק
-- ההפניה לעסק/התאמה שנמחקו מתאפסת ל-NULL. שום מידע לא נמחק בגלל
-- השינוי הזה.
--
-- לא נוגעים ב: matches.business_id_fkey (כבר CASCADE - נכון: התאמה
-- בלי עסק היא לא מושג הגיוני, לא רשומת פעילות עצמאית), ולא ב-
-- match_status_history/match_participants (כבר CASCADE - נכון: היסטוריית
-- סטטוס לא אמורה להתקיים בלי ההתאמה עצמה).

ALTER TABLE tasks DROP CONSTRAINT tasks_business_id_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_business_id_fkey
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;

ALTER TABLE tasks DROP CONSTRAINT tasks_match_id_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL;

ALTER TABLE match_meetings DROP CONSTRAINT match_meetings_business_id_fkey;
ALTER TABLE match_meetings ADD CONSTRAINT match_meetings_business_id_fkey
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;

ALTER TABLE match_meetings DROP CONSTRAINT match_meetings_match_id_fkey;
ALTER TABLE match_meetings ADD CONSTRAINT match_meetings_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL;

ALTER TABLE business_number_correction_log DROP CONSTRAINT business_number_correction_log_business_id_fkey;
ALTER TABLE business_number_correction_log ADD CONSTRAINT business_number_correction_log_business_id_fkey
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;

ALTER TABLE anon_distributions DROP CONSTRAINT anon_distributions_match_id_fkey;
ALTER TABLE anon_distributions ADD CONSTRAINT anon_distributions_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL;

COMMIT;
