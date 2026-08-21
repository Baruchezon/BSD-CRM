-- ============================================================================
-- BSD-CRM — סימון אמין של שימוש קודם ב-AI על שדות תיאור/הערות
-- תאריך: 21/08/2026
-- ============================================================================
-- דרישה מפורשת: לא לזהות "טקסט שנוצר ע"י AI" לפי ניחוש/סגנון כתיבה - זה לא
-- מדויק. הפתרון: נתוני מערכת אמיתיים שנשמרים בכל פעם שמשתמש מאשר "אישור
-- והחלפה" בתצוגה המקדימה של שיפור הניסוח (businesses.html), ונשמרים בפועל
-- רק כשהטופס עצמו נשמר (saveBiz) - בדיוק כמו כל שינוי אחר בטופס.
--
-- שני זוגות עמודות מקבילים (short_description / notes), כל זוג:
--   *_ai_edited_at  - מתי בוצעה עריכת ה-AI האחרונה שאושרה (null = מעולם לא)
--   *_ai_edited_by  - איזה משתמש הפעיל אותה
--   *_pre_ai_text   - הטקסט כפי שהיה רגע לפני אותה עריכה (לשחזור אמין,
--                     גם בפתיחה מחדש של הטופס בסשן אחר - לא רק זיכרון דפדפן)
--   *_ai_text       - הטקסט המדויק שה-AI הפיק (ייתכן שהמשתמש ליטש אותו
--                     ידנית אחר כך בשדה עצמו - זה נשמר בעמודה הרגילה)
-- ============================================================================

alter table businesses add column if not exists short_description_ai_edited_at timestamptz;
alter table businesses add column if not exists short_description_ai_edited_by uuid references profiles(id);
alter table businesses add column if not exists short_description_pre_ai_text  text;
alter table businesses add column if not exists short_description_ai_text      text;

alter table businesses add column if not exists notes_ai_edited_at timestamptz;
alter table businesses add column if not exists notes_ai_edited_by uuid references profiles(id);
alter table businesses add column if not exists notes_pre_ai_text  text;
alter table businesses add column if not exists notes_ai_text      text;

-- אין כאן שום שינוי ל-RLS, להרשאות, למבנה ההפצה, או לטבלת המשתמשים -
-- זו תוספת עמודות בלבד לטבלת businesses הקיימת.
