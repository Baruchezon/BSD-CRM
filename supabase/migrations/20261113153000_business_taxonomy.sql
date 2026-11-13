-- Map businesses onto taxonomy-v1 and store the website form's slug lists.
-- The JSON file supabase/functions/_shared/taxonomy-v1.json is the source of the slugs.
-- Proposed only: do not apply until the signup function that writes these columns is deployed.
-- Rollback: supabase/migrations/rollback_20261113153000_business_taxonomy.sql

begin;

alter table public.business_alert_subscribers
  add column if not exists categories text[] not null default '{}',
  add column if not exists subcategories text[] not null default '{}',
  add column if not exists regions text[] not null default '{}';

comment on column public.business_alert_subscribers.categories is
  'Taxonomy category slugs from taxonomy-v1, sent by the website as categories[].';
comment on column public.business_alert_subscribers.subcategories is
  'Taxonomy subcategory slugs, sent as subcategories[].';
comment on column public.business_alert_subscribers.regions is
  'Taxonomy region slugs, sent as regions[]. Legacy region text stays in region.';

alter table public.business_alert_subscribers
  add column if not exists signup_channel text not null default 'website';

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_signup_channel_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_signup_channel_check
  check (signup_channel in ('website', 'our_link'));

comment on column public.business_alert_subscribers.signup_channel is
  'website = נרשם דרך האתר. our_link = יזום שלנו. Any other value is stored as website.';

-- utm_source, utm_medium, utm_campaign, utm_content and source_url already exist.

alter table public.businesses
  add column if not exists taxonomy jsonb;

comment on column public.businesses.taxonomy is
  'Mapped taxonomy-v1 slugs: {categories, subcategories, regions, flags}. Filled from category, subcategory, field and region text. Not shown to the public.';

create or replace function public.business_taxonomy_classify(
  p_category text,
  p_subcategory text,
  p_field text,
  p_region text
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  blob text := concat_ws(' ', coalesce(p_category, ''), coalesce(p_subcategory, ''), coalesce(p_field, ''), coalesce(p_region, ''));
  cats text[] := '{}';
  subs text[] := '{}';
  regs text[] := '{}';
  flags text[] := '{}';
begin
  if blob like '%מסעדה%' or blob like '%המבורגר%' or blob like '%פיצה%' or blob like '%שווארמה%' or blob like '%פלאפל%' then
    cats := array['food'];
  end if;
  if blob like '%המבורגר%' or blob like '%פיצה%' or blob like '%שווארמה%' or blob like '%פלאפל%' or blob like '%מזון מהיר%' then
    subs := subs || array['fast_food'];
  end if;
  if blob like '%מסעדה%' then subs := subs || array['restaurant']; end if;
  if blob like '%מאפי%' then cats := cats || array['food']; subs := subs || array['bakery']; end if;
  if blob like '%בית קפה%' or blob like '%בתי קפה%' then cats := cats || array['food']; subs := subs || array['cafe']; end if;
  if blob like '%קייטרינג%' or blob like '%הסעדה%' then cats := cats || array['food']; subs := subs || array['catering']; end if;
  if blob like '%פאב%' or blob like '%בר %' then cats := cats || array['food']; subs := subs || array['pub_bar']; end if;
  if blob like '%ייצור מזון%' or blob like '%יצור מזון%' then cats := cats || array['food']; subs := subs || array['food_production']; end if;
  if blob like '%מינימרקט%' or blob like '%מכולת%' then cats := cats || array['grocery']; subs := subs || array['minimarket']; end if;
  if blob like '%סופר%' then cats := cats || array['grocery']; subs := subs || array['supermarket']; end if;
  if blob like '%ירק%' or blob like '%פירות%' then cats := cats || array['grocery']; subs := subs || array['produce']; end if;
  if blob like '%מעדנ%' then cats := cats || array['grocery']; subs := subs || array['deli']; end if;
  if blob like '%אופנה%' or blob like '%הלבשה%' then cats := cats || array['retail']; subs := subs || array['fashion']; end if;
  if blob like '%אונליין%' or blob like '%איקומרס%' then cats := cats || array['retail']; subs := subs || array['ecommerce']; end if;
  if blob like '%ייבוא%' or blob like '%יבוא%' then cats := cats || array['wholesale']; subs := subs || array['import']; end if;
  if blob like '%סיטונ%' then cats := cats || array['wholesale']; subs := subs || array['wholesale']; end if;
  if blob like '%הפצה%' then cats := cats || array['wholesale']; subs := subs || array['distribution']; end if;
  if blob like '%מספרה%' then cats := cats || array['beauty']; subs := subs || array['hair_salon']; end if;
  if blob like '%קוסמטיק%' then cats := cats || array['beauty']; subs := subs || array['cosmetics']; end if;
  if blob like '%ציפורנ%' then cats := cats || array['beauty']; subs := subs || array['nails']; end if;
  if blob like '%אסתטיק%' then cats := cats || array['beauty']; subs := subs || array['medical_aesthetics']; end if;
  if blob like '%מרפאה%' or blob like '%קליניק%' then cats := cats || array['health']; subs := subs || array['clinic']; end if;
  if blob like '%כושר%' or blob like '%סטודיו%' then cats := cats || array['health']; subs := subs || array['fitness']; end if;
  if blob like '%מוסך%' then cats := cats || array['auto']; subs := subs || array['garage']; end if;
  if blob like '%שטיפת רכב%' then cats := cats || array['auto']; subs := subs || array['car_wash']; end if;
  if blob like '%קבלנ%' then cats := cats || array['construction']; subs := subs || array['contracting']; end if;
  if blob like '%מיזוג%' then cats := cats || array['construction']; subs := subs || array['hvac_electric']; end if;
  if blob like '%מפעל%' or blob like '%תעשי%' or (blob like '%ייצור%' and blob not like '%ייצור מזון%' and blob not like '%יצור מזון%') then
    cats := cats || array['construction']; subs := subs || array['manufacturing'];
  end if;
  if blob like '%אחזק%' or blob like '%ניקיון%' then cats := cats || array['services']; subs := subs || array['cleaning_maintenance']; end if;
  if blob like '%הסעות%' or blob like '%תיירות%' then cats := cats || array['services']; subs := subs || array['transport_tourism']; end if;
  if blob like '%תוכנ%' or blob like '%אתרים%' then cats := cats || array['services']; subs := subs || array['software_web']; end if;
  if blob like '%שיווק%' then cats := cats || array['services']; subs := subs || array['marketing_digital']; end if;
  if blob like '%צהרון%' or blob like '%גן ילדים%' then cats := cats || array['education_leisure']; subs := subs || array['kindergarten']; end if;
  if blob like '%חוגים%' then cats := cats || array['education_leisure']; subs := subs || array['classes']; end if;
  if blob like '%פנאי%' or blob like '%משחק%' then cats := cats || array['education_leisure']; subs := subs || array['leisure']; end if;
  if blob like '%זכיינות%' then flags := flags || array['franchise']; end if;

  if coalesce(p_region, '') like '%כל הארץ%' then
    regs := array['all'];
  else
    if coalesce(p_region, '') like '%צפון%' then regs := regs || array['north']; end if;
    if coalesce(p_region, '') like '%חיפה%' or coalesce(p_region, '') like '%קריות%' then regs := regs || array['haifa']; end if;
    if coalesce(p_region, '') like '%שרון%' then regs := regs || array['sharon']; end if;
    if coalesce(p_region, '') like '%תל אביב%' then regs := regs || array['tel_aviv']; end if;
    if coalesce(p_region, '') like '%מרכז%' or coalesce(p_region, '') like '%גוש דן%' then regs := regs || array['center']; end if;
    if coalesce(p_region, '') like '%שפלה%' then regs := regs || array['shfela']; end if;
    if coalesce(p_region, '') like '%ירושלים%' then regs := regs || array['jerusalem']; end if;
    if coalesce(p_region, '') like '%דרום%' then regs := regs || array['south']; end if;
  end if;

  return jsonb_build_object(
    'categories', to_jsonb(coalesce((select array_agg(distinct item) from unnest(cats) as item), '{}')),
    'subcategories', to_jsonb(coalesce((select array_agg(distinct item) from unnest(subs) as item), '{}')),
    'regions', to_jsonb(coalesce((select array_agg(distinct item) from unnest(regs) as item), '{}')),
    'flags', to_jsonb(coalesce((select array_agg(distinct item) from unnest(flags) as item), '{}'))
  );
end;
$$;

revoke all on function public.business_taxonomy_classify(text, text, text, text) from public, anon, authenticated;
grant execute on function public.business_taxonomy_classify(text, text, text, text) to service_role;

update public.businesses
set taxonomy = public.business_taxonomy_classify(category, subcategory, field, region)
where taxonomy is null;

create or replace function public.business_alert_crm_list()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select
      s.id, s.first_name, s.last_name, s.phone, s.phone9, s.email, s.interests,
      s.categories, s.subcategories, s.regions,
      s.budget_min, s.budget_max, s.budget_open, s.region,
      s.consent_email, s.consent_whatsapp, s.consent_general, s.consent_text,
      s.consent_version, s.consent_text_version, s.consent_at, s.source, s.source_url,
      s.signup_channel, s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term,
      s.looking_for,
      s.legacy_no_consent, s.status, s.unsubscribed_at, s.unsubscribed_by, s.unsubscribe_reason,
      s.email_unsubscribed_at, s.whatsapp_unsubscribed_at,
      s.do_not_call, s.do_not_call_at, s.manager_notes, s.handled_at, s.handled_by,
      s.crm_lead_id, s.created_at, s.updated_at,
      (select count(*) from public.business_alert_page_views v where v.subscriber_id = s.id) as view_count,
      (select count(*) from public.business_alert_sends d where d.subscriber_id = s.id) as send_count
    from public.business_alert_subscribers s
  ) x;
$$;

revoke all on function public.business_alert_crm_list() from public, anon, authenticated;
grant execute on function public.business_alert_crm_list() to service_role, business_alert_manager;

commit;
