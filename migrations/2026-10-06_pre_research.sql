-- 06.10.2026 (בקשת ברוך, אושר): «🔎 חקר מקדים» - שדה טקסט פנימי בכרטיס ליד/קונה ובכרטיס עסק.
--
-- leads.pre_research      - כרטיס ליד (leads-hub.html) וכרטיס קונה (leads.html). ליד שעובר
--                           לקונים עם «שמור והעבר» הוא אותה שורה, כך שהחקר נשאר אוטומטית.
-- businesses.pre_research - כרטיס עסק (businesses.html). ליד מוכר שעובר עם «שמור והעבר»
--                           מעתיק את החקר לכרטיס העסק (leads-hub.html, ensureWebsiteLeadBusiness).
--
-- זה השינוי היחיד במסד: שתי עמודות nullable, בלי default, בלי שינוי בנתונים קיימים.
-- אין טריגר/פונקציה/VIEW שצריך לעדכן:
--   * public_business_listings, businesses_anonymous_card, businesses_social_feed מוגדרים
--     עם רשימת עמודות מפורשת (לא SELECT *), ולכן העמודה החדשה לא נחשפת בהם.
--   * ההעברה ליד -> קונה/עסק מתבצעת בצד הלקוח (leads-hub.html), לא ב-DB.
--   * RLS קיים (leads_select/leads_update, businesses_select/businesses_update) חל על השורה
--     כולה, כך שהעמודה מקבלת בדיוק את אותה נראות כמו notes.
-- Rollback: migrations/2026-10-06_pre_research_rollback.sql

ALTER TABLE public.leads      ADD COLUMN IF NOT EXISTS pre_research text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS pre_research text;
