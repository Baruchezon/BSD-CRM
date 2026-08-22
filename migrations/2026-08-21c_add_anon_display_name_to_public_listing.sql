-- ============================================================================
-- BSD-CRM — הוספת anon_display_name לתצוגת הרשימה הציבורית (ככותרת הכרטיס)
-- תאריך: 21/08/2026
-- ============================================================================
-- listings.html השתמש עד כה ב-b.anonymous_name לכותרת הכרטיס - שדה שמעולם
-- לא היה חלק מה-VIEW הזה (ולא זהה ל-anon_display_name, שהוא השדה שבאמת
-- מוזן ע"י הסוכן ועובר בדיקת מזהים לפני שמירה). בפועל הכותרת תמיד נפלה
-- חזרה ל"עסק למכירה" הגנרי. מוסיפים את anon_display_name ל-VIEW (כבר מוגן
-- ע"י הטריגר bsd_check_anon_fields_for_identifiers מהמיגרציה הקודמת) ומעדכנים
-- את listings.html להשתמש בו.
-- ============================================================================

drop view if exists public_business_listings;

create view public_business_listings
with (security_invoker = false) as
select
  b.id,
  b.field,
  b.category,
  b.subcategory,
  b.region,
  b.years_active,
  b.annual_revenue,
  b.employees_count,
  b.anon_display_name,
  b.anon_summary as short_description,
  case when b.anon_card_show_price then b.asking_price else null end as asking_price,
  b.created_at
from businesses b
where b.public_listing_active = true
  and b.anon_card_active = true
  and b.listing_status = 'active';

grant select on public_business_listings to anon, authenticated;
