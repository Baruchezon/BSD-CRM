-- ============================================================================
-- BSD-CRM — הפעלת עמוד הרשימה הציבורית (listings.html) בצורה מאובטחת
-- תאריך: 21/08/2026
-- ============================================================================
-- הרקע: listings.html (עמוד ציבורי, לא דורש התחברות, נוצר 30.07.2026) קרא
-- מהתחלה לשתי טבלאות (public_business_listings, public_inquiries) שמעולם
-- לא נוצרו במסד הנתונים בפועל. בפועל העמוד לא היה מקושר משום מקום באתר
-- ולא היה חי, כך שלא היו פניות שאבדו. המיגרציה הזו משלימה את התשתית
-- החסרה, בצורה מאובטחת ואנונימית בלבד:
--
-- 1. עמודה חדשה על businesses: public_listing_active (ברירת מחדל false -
--    opt-in מפורש לכל עסק בנפרד, לא כלום נחשף כברירת מחדל).
-- 2. VIEW ציבורי public_business_listings - חושף רק שדות אנונימיים,
--    ורק לעסקים שגם public_listing_active=true וגם anon_card_active=true
--    (כלומר כבר עברו הכנת תקציר אנונימי דרך התהליך הקיים) וגם
--    listing_status='active'. שדה מחיר/סיבת מכירה מכובד לפי אותם דגלים
--    (anon_card_show_price / anon_card_show_reason) שכבר קיימים למטרה הזו.
--    בלי שם עסק, בלי כתובת/עיר, בלי בעלים, בלי כל מזהה.
-- 3. טבלת public_inquiries - טבלה אמיתית (לא VIEW) כי צריך גם להכניס אליה
--    מבקר אנונימי. RLS: הכנסה (INSERT) פתוחה לאנונימי ולמחובר; קריאה
--    (SELECT)/עדכון רק לצוות מחובר של BSD. כך מבקר אתר לא יכול לקרוא את
--    הפניות של אחרים.
-- ============================================================================

-- 1. דגל opt-in לפרסום ציבורי
alter table businesses add column if not exists public_listing_active boolean not null default false;
comment on column businesses.public_listing_active is 'האם העסק מפורסם בעמוד הרשימה הציבורי (listings.html) - opt-in מפורש, ברירת מחדל false';

-- 2. VIEW הרשימה הציבורית האנונימית
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
  b.short_description,
  case when b.anon_card_show_price then b.asking_price else null end as asking_price,
  case when b.anon_card_show_reason then b.sale_reason else null end as sale_reason,
  b.created_at
from businesses b
where b.public_listing_active = true
  and b.anon_card_active = true
  and b.listing_status = 'active';

grant select on public_business_listings to anon, authenticated;

-- 3. טבלת פניות ציבוריות
create table if not exists public_inquiries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete set null,
  name text not null,
  phone text not null,
  message text,
  handled boolean not null default false,
  handled_by uuid references profiles(id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public_inquiries is 'פניות שהושארו על ידי מבקרים אנונימיים בעמוד listings.html הציבורי';

alter table public_inquiries enable row level security;

drop policy if exists public_inquiries_insert_anyone on public_inquiries;
create policy public_inquiries_insert_anyone
  on public_inquiries for insert
  to anon, authenticated
  with check (true);

drop policy if exists public_inquiries_select_staff on public_inquiries;
create policy public_inquiries_select_staff
  on public_inquiries for select
  to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

drop policy if exists public_inquiries_update_staff on public_inquiries;
create policy public_inquiries_update_staff
  on public_inquiries for update
  to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()))
  with check (exists (select 1 from profiles p where p.id = auth.uid()));

-- שים לב: אין למבקר אנונימי אף הרשאת select/update/delete על public_inquiries -
-- רק insert. כל צוות BSD המחובר יכול לצפות ולסמן כטופל.
