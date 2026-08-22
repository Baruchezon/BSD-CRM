-- ============================================================================
-- BSD-CRM — תיקון קריטי: דליפת מידע מזהה דרך public_business_listings
-- תאריך: 21/08/2026
-- ============================================================================
-- התקלה: ה-VIEW public_business_listings (נוצר היום, מיגרציה קודמת) חשף
-- לציבור את b.short_description - השדה הגולמי/הפנימי שהצוות ממלא בעת יצירת
-- העסק, שמעולם לא עבר בדיקת אנונימיות. השדה הנכון, שכבר עובר סינון מפורש
-- מול שם העסק/הבעלים/טלפון/מייל/אתר/כתובת (ראו scanText ב-businesses.html,
-- וגם הוא ה-VIEW הפנימי הקיים businesses_anonymous_card - ששם השדה הזה כן
-- קיים אך מעולם לא מוצג בפועל בממשק) הוא b.anon_summary.
--
-- אומתה בפועל דליפה חיה: שני עסקים שכבר סומנו לפרסום ציבורי (מור אחזקת
-- מבנים, ריקו מסעדה) חשפו את שמם/פרטים מזהים דרך short_description.
--
-- הרוט-קוז המדויק: את ה-VIEW בניתי מתוך העתקה של רשימת השדות מ-
-- businesses_anonymous_card הקיים - שגם בו מופיע short_description (אך שם
-- הוא לעולם לא נקרא בממשק בפועל, ראו renderAnonBizGrid), ולא שמתי לב
-- להבדל בין "שדה שקיים ב-VIEW" לבין "שדה שבאמת עבר בדיקת אנונימיות".
--
-- התיקון:
-- 1. anon_summary במקום short_description.
-- 2. sale_reason הגולמי מוסר לגמרי מה-VIEW - הגרסה המתומצתת שלו כבר
--    משולבת בתוך anon_summary עצמו כשanon_card_show_reason=true (ראו
--    generateAnonSummary ב-businesses.html), כך שהעמודה הנפרדת הייתה גם
--    מיותרת וגם בלתי מסוננת.
-- 3. הגנה ברמת השרת (לא רק Frontend): טריגר על businesses שבודק, בכל
--    INSERT/UPDATE שבו anon_card_active=true או public_listing_active=true,
--    שאף אחד מ-anon_summary/anon_display_name לא מכיל את internal_name,
--    anonymous_name, owner_name, owner_phone, owner_email, website או
--    address בפועל (case-insensitive) - זהה ללוגיקת scanText הקיימת
--    ב-Frontend, אבל אי אפשר לעקוף אותה בעזרת קריאת API ישירה.
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
  b.anon_summary as short_description,
  case when b.anon_card_show_price then b.asking_price else null end as asking_price,
  b.created_at
from businesses b
where b.public_listing_active = true
  and b.anon_card_active = true
  and b.listing_status = 'active';

grant select on public_business_listings to anon, authenticated;

-- הגנת שרת: לא לסמוך רק על בדיקת ה-Frontend
create or replace function bsd_check_anon_fields_for_identifiers()
returns trigger
language plpgsql
as $$
declare
  identifiers text[];
  ident text;
  haystack text;
begin
  if not (coalesce(new.anon_card_active, false) or coalesce(new.public_listing_active, false)) then
    return new;
  end if;

  identifiers := array_remove(array[
    new.internal_name, new.anonymous_name, new.owner_name,
    new.owner_phone, new.owner_email, new.website, new.address
  ], null);

  haystack := lower(coalesce(new.anon_summary, '') || ' ' || coalesce(new.anon_display_name, ''));

  foreach ident in array identifiers loop
    if length(trim(ident)) >= 3 and haystack like '%' || lower(trim(ident)) || '%' then
      raise exception 'anon_summary/anon_display_name contains an identifying value ("%") while anon_card_active or public_listing_active is true - blocked at the database level', ident
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists bsd_check_anon_fields_trigger on businesses;
create trigger bsd_check_anon_fields_trigger
  before insert or update on businesses
  for each row
  execute function bsd_check_anon_fields_for_identifiers();
