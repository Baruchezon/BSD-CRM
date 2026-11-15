-- 15.11.2026 dashboard global search (Baruch asked 15:35): one box under the greeting, finds a record anywhere.
-- crm_global_search is SECURITY INVOKER: every table is read with the caller's own RLS, so an agent sees only
-- what the CRM already shows them. Website alert subscribers have no staff SELECT policy (the CRM reads them
-- through business-alert-admin), so that one part goes through a SECURITY DEFINER helper gated to active
-- admin/manager, the same check as business_distribution_require_staff().
-- Rollback: rollback_20261115160000_crm_global_search.sql

create or replace function public.crm_search_digits(p text)
returns text language sql immutable set search_path to 'pg_catalog' as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^972', '0')
$$;

create or replace function public.crm_global_search_subscribers(p_q text, p_limit integer default 15)
returns table(kind text, id uuid, title text, subtitle text, badge text, extra_badge text, is_archived boolean,
              href text, rank integer, updated_at timestamptz)
language plpgsql stable security definer set search_path to 'pg_catalog', 'public' as $$
declare
  q text := btrim(coalesce(p_q, ''));
  pat text;
  d text;
begin
  if not exists (select 1 from public.profiles where profiles.id = auth.uid() and status = 'active' and role in ('admin', 'manager')) then
    return;
  end if;
  if char_length(q) < 2 then return; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  d := public.crm_search_digits(q);
  return query
  select 'subscriber'::text, s.id,
         coalesce(nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), s.email, 'נרשם ללא שם'),
         concat_ws(' · ', nullif(s.phone, ''), nullif(s.region, ''), case s.status when 'active' then 'פעיל' when 'unsubscribed_all' then 'הוסר מכל הדיוור' when 'unsubscribed_email' then 'הוסר מדיוור מייל' else nullif(s.status, '') end),
         'נרשם לעדכונים'::text,
         case when s.crm_lead_id is not null then 'מקושר לכרטיס' end,
         (s.archived_at is not null),
         'site-buyers.html?open=' || s.id::text,
         case when concat_ws(' ', s.first_name, s.last_name) ilike q || '%' then 3 else 1 end,
         coalesce(s.updated_at, s.created_at)
  from public.business_alert_subscribers s
  where concat_ws(' ', s.first_name, s.last_name) ilike pat
     or s.email ilike pat
     or s.region ilike pat
     or (char_length(d) >= 5 and public.crm_search_digits(s.phone) like '%' || d || '%')
  order by 9 desc, 10 desc nulls last
  limit greatest(1, least(coalesce(p_limit, 15), 30));
end $$;

create or replace function public.crm_global_search(p_q text, p_limit integer default 40)
returns table(kind text, id uuid, title text, subtitle text, badge text, extra_badge text, is_archived boolean,
              href text, rank integer, updated_at timestamptz)
language plpgsql stable security invoker set search_path to 'pg_catalog', 'public' as $$
declare
  q text := btrim(coalesce(p_q, ''));
  pat text;
  pre text;
  d text;
  per integer := 15;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where profiles.id = auth.uid() and status = 'active') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(q) < 2 then return; end if;
  q := left(q, 80);
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  pre := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  d := public.crm_search_digits(q);
  -- digits are used for phones only when the query is mostly a number (050-123, 0501234567, +97250…)
  -- (5+ digits, so a short number like 1109 means a business/client number, not a phone fragment)
  if char_length(d) < 5 or char_length(d) < char_length(regexp_replace(q, '[\s\-+().]', '', 'g')) - 1 then d := ''; end if;

  return query
  select * from (
    -- Leads: buyers, sellers/business owners, investors/partners, including archived and closed.
    (select 'lead'::text, l.id,
           coalesce(nullif(btrim(l.full_name), ''), nullif(btrim(concat_ws(' ', l.first_name, l.last_name)), ''), l.business_name, 'ללא שם'),
           concat_ws(' · ', nullif(l.phone, ''), nullif(l.client_number, ''),
                     case when l.type = 'seller' and nullif(l.business_name, '') is not null then 'עסק: ' || l.business_name end,
                     nullif(l.status, ''), nullif(l.city, '')),
           case when l.type = 'seller' then 'בעל עסק'
                when l.type = 'partner' or l.buyer_type ilike '%משקיע%' then 'משקיע'
                else 'קונה' end,
           case when l.website_intake_stage = 'new' then 'ליד חדש מהאתר'
                when l.status in ('חדש', 'חדש לטיפול') then 'ליד' end,
           coalesce(l.is_archived, false),
           'leads.html?open=' || l.id::text,
           (case when l.full_name ilike pre or l.first_name ilike pre or l.last_name ilike pre then 3 else 1 end)
             + (case when coalesce(l.is_archived, false) then 0 else 1 end),
           coalesce(l.updated_at, l.created_at)
    from public.leads l
    where l.full_name ilike pat or concat_ws(' ', l.first_name, l.last_name) ilike pat
       or l.email ilike pat or l.city ilike pat or l.business_name ilike pat or l.client_number ilike pat
       or (d <> '' and (public.crm_search_digits(l.phone) like '%' || d || '%' or public.crm_search_digits(l.phone2) like '%' || d || '%'))
    order by 9 desc, 10 desc nulls last limit per)
    union all
    -- Businesses (including archived / sold / removed). Never the number alone.
    (select 'business'::text, b.id,
           coalesce(nullif(btrim(b.internal_name), ''), nullif(btrim(b.anon_display_name), ''), nullif(btrim(b.anonymous_name), ''), b.field, 'עסק'),
           concat_ws(' · ', nullif(b.business_number, ''),
                     case when nullif(btrim(b.internal_name), '') is not null and nullif(btrim(b.anon_display_name), '') is not null
                               and b.anon_display_name <> b.internal_name then b.anon_display_name end,
                     case when nullif(b.owner_name, '') is not null then 'בעלים: ' || btrim(b.owner_name) end,
                     case coalesce(nullif(b.listing_status, ''), 'active') when 'active' then 'פעיל למכירה' when 'sold' then 'נמכר' when 'removed' then 'עסקה לא פעילה' else b.listing_status end,
                     nullif(b.city, '')),
           'עסק'::text,
           case when (b.owner_name ilike pat or (d <> '' and public.crm_search_digits(b.owner_phone) like '%' || d || '%'))
                     and not (b.internal_name ilike pat or b.anon_display_name ilike pat) then 'נמצא לפי בעל העסק' end,
           coalesce(b.is_archived, false),
           'businesses.html?open=' || b.id::text,
           (case when b.internal_name ilike pre or b.anon_display_name ilike pre or b.business_number ilike '%-' || q then 3 else 1 end)
             + (case when coalesce(b.is_archived, false) then 0 else 1 end),
           coalesce(b.updated_at, b.created_at)
    from public.businesses b
    where b.internal_name ilike pat or b.anon_display_name ilike pat or b.anonymous_name ilike pat
       or b.business_number ilike pat or (q ~ '\D' and b.internal_code ilike pat) or b.city ilike pat or b.field ilike pat
       or b.owner_name ilike pat or b.owner_email ilike pat
       or (d <> '' and public.crm_search_digits(b.owner_phone) like '%' || d || '%')
    order by 9 desc, 10 desc nulls last limit per)
    union all
    -- Brokers (מתווכים), including archived.
    (select 'broker'::text, r.id,
           coalesce(nullif(btrim(r.full_name), ''), nullif(btrim(concat_ws(' ', r.first_name, r.last_name)), ''), 'מתווך'),
           concat_ws(' · ', nullif(r.phone, ''), nullif(r.status, ''), nullif(r.city, '')),
           'מתווך'::text, null::text, coalesce(r.is_archived, false),
           'brokers.html?open=' || r.id::text,
           (case when r.full_name ilike pre then 3 else 1 end) + (case when coalesce(r.is_archived, false) then 0 else 1 end),
           coalesce(r.updated_at, r.created_at)
    from public.brokers r
    where r.full_name ilike pat or concat_ws(' ', r.first_name, r.last_name) ilike pat or r.email ilike pat or r.city ilike pat
       or (d <> '' and public.crm_search_digits(r.phone) like '%' || d || '%')
    order by 9 desc, 10 desc nulls last limit per)
    union all
    -- Training inquiries (admin-only by RLS).
    (select 'training'::text, t.id,
           coalesce(nullif(btrim(concat_ws(' ', t.first_name, t.last_name)), ''), 'ללא שם'),
           concat_ws(' · ', nullif(t.phone, ''), nullif(t.registration_number, ''), nullif(t.status, '')),
           'מתעניין בהכשרה'::text, null::text, coalesce(t.is_archived, false),
           'training-admin.html?open=' || t.id::text,
           (case when concat_ws(' ', t.first_name, t.last_name) ilike pre then 3 else 1 end) + (case when coalesce(t.is_archived, false) then 0 else 1 end),
           coalesce(t.updated_at, t.created_at)
    from public.training_leads t
    where concat_ws(' ', t.first_name, t.last_name) ilike pat or t.email ilike pat or t.address ilike pat
       or (d <> '' and public.crm_search_digits(t.phone) like '%' || d || '%')
    order by 9 desc, 10 desc nulls last limit per)
    union all
    (select * from public.crm_global_search_subscribers(q, per))
  ) x
  order by 9 desc, 10 desc nulls last
  limit greatest(1, least(coalesce(p_limit, 40), 60));
end $$;

comment on function public.crm_global_search(text, integer) is
  'Dashboard global search (15.11.2026). SECURITY INVOKER: results respect the caller''s RLS. Min 2 chars.';

revoke all on function public.crm_global_search(text, integer) from public, anon;
revoke all on function public.crm_global_search_subscribers(text, integer) from public, anon;
grant execute on function public.crm_global_search(text, integer) to authenticated;
grant execute on function public.crm_global_search_subscribers(text, integer) to authenticated;
grant execute on function public.crm_search_digits(text) to authenticated;
