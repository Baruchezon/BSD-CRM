-- Extend shared dashboard and leads search, keeping existing grants and row policies.
create or replace function public.crm_search_digits(p text)
returns text language sql immutable set search_path to 'pg_catalog' as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^(00972|972)', '0')
$$;

create or replace function public.crm_global_search(p_q text, p_limit integer default 40)
returns table(kind text, id uuid, title text, subtitle text, badge text, extra_badge text, is_archived boolean,
              href text, rank integer, updated_at timestamptz)
language plpgsql stable security invoker set search_path to 'pg_catalog', 'public' as $$
declare
  q text := btrim(coalesce(p_q, ''));
  pat text;
  pre text;
  d text;
  per integer := 18;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where profiles.id = auth.uid() and status = 'active') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(q) < 2 then return; end if;
  q := left(regexp_replace(q, '\s+', ' ', 'g'), 120);
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  pre := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  d := public.crm_search_digits(q);
  -- digits are used for phones only when the query is mostly a number (050-123, 0501234567, +97250…)
  -- (5+ digits, so a short number like 1109 means a business/client number, not a phone fragment)
  if char_length(d) < 5 or q !~ '^[0-9\s+().‐‑–-]+$' then d := ''; end if;

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
                when l.crm_stage = 'in_progress' then 'לקוחות בטיפול'
                when l.crm_stage = 'lead' or l.website_intake_stage = 'contacted'
                  or l.status in ('חדש', 'חדש לטיפול') then 'ליד' end,
           coalesce(l.is_archived, false),
           (case when not coalesce(l.is_archived, false) and l.crm_stage is null
                     and (l.website_intake_stage in ('new', 'contacted')
                       or (l.source = 'שיחה טלפונית נכנסת' and coalesce(l.status, '') not in ('הועבר לקונה', 'הועבר למוכר'))
                       or (l.type = 'seller' and l.website_intake_stage is null))
                     and not exists (select 1 from public.businesses target where target.seller_id = l.id)
                 then 'leads-hub.html?open=' else 'leads.html?open=' end) || l.id::text,
           (case when (d <> '' and d in (public.crm_search_digits(l.phone), public.crm_search_digits(l.phone2)))
                          or lower(l.email) = lower(q) or lower(l.client_number) = lower(q) then 6
                 when l.full_name ilike pre or concat_ws(' ', l.first_name, l.last_name) ilike pre or l.last_name ilike pre then 3 else 1 end)
             + (case when coalesce(l.is_archived, false) then 0 else 1 end),
           coalesce(l.updated_at, l.created_at)
    from public.leads l
    where l.full_name ilike pat or concat_ws(' ', l.first_name, l.last_name) ilike pat
       or concat_ws(' ', l.email, l.city, l.address, l.business_name, l.lead_business_label, l.business_city,
          l.business_field, l.business_address, l.client_number, l.internal_code, l.company, l.requested_field,
          l.requested_categories, l.requested_area, l.buyer_type, l.source, l.status, l.original_source,
          l.origin_entered_by_name, l.referred_by_agent_name, l.notes, l.intake_customer_wants) ilike pat
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
           case when b.crm_stage = 'in_progress' then 'לקוחות בטיפול'
                when b.crm_stage = 'lead' then 'ליד'
                when (b.owner_name ilike pat or (d <> '' and public.crm_search_digits(b.owner_phone) like '%' || d || '%'))
                     and not (b.internal_name ilike pat or b.anon_display_name ilike pat) then 'נמצא לפי בעל העסק' end,
           coalesce(b.is_archived, false),
           'businesses.html?open=' || b.id::text,
           (case when (d <> '' and d = public.crm_search_digits(b.owner_phone))
                          or lower(b.owner_email) = lower(q) or lower(b.business_number) = lower(q) then 6
                 when b.internal_name ilike pre or b.anon_display_name ilike pre or b.business_number ilike '%-' || q then 3 else 1 end)
             + (case when coalesce(b.is_archived, false) then 0 else 1 end),
           coalesce(b.updated_at, b.created_at)
    from public.businesses b
    where b.internal_name ilike pat or b.anon_display_name ilike pat or b.anonymous_name ilike pat
       or b.business_number ilike pat or (q ~ '\D' and b.internal_code ilike pat) or b.city ilike pat or b.field ilike pat
       or concat_ws(' ', b.owner_name, b.owner_email, b.legal_name, b.category, b.subcategory, b.address, b.region,
          b.website, b.status, b.source, b.original_source, b.origin_entered_by_name, b.referred_by_agent_name,
          b.short_description, b.notes) ilike pat
       or (d <> '' and public.crm_search_digits(b.owner_phone) like '%' || d || '%')
       or exists (
           select 1 from public.leads seller
           where seller.id = b.seller_id
             and (seller.full_name ilike pat or concat_ws(' ', seller.first_name, seller.last_name) ilike pat
               or seller.email ilike pat or seller.business_name ilike pat or seller.lead_business_label ilike pat
               or (d <> '' and (public.crm_search_digits(seller.phone) like '%' || d || '%'
                            or public.crm_search_digits(seller.phone2) like '%' || d || '%')))
       )
    order by 9 desc, 10 desc nulls last limit per)
    union all
    -- The imported 2026 inbox has its own administrator-only row policies.
    (select 'review'::text, y.id, coalesce(nullif(btrim(y.full_name), ''), 'ליד ללא שם'),
           concat_ws(' · ', nullif(y.phone, ''), nullif(y.email, ''), nullif(y.classification, '')),
           'לידים 2026'::text,
           case when y.is_hidden then 'הוסר מהרשימה'
                when y.transferred_to_id is not null then 'הועבר לכרטיס'
                else nullif(y.review_status, '') end,
           false,
           'leads-hub.html?open=' || y.id::text || '&tab=y2026',
           case when (d <> '' and d = public.crm_search_digits(y.phone)) or lower(y.email) = lower(q) then 5
                when y.full_name ilike pre then 3 else 1 end,
           coalesce(y.received_at, y.created_at)
    from public.leads_2026_review y
    where concat_ws(' ', y.full_name, y.email, y.source, y.raw_purpose, y.classification,
                    y.review_status, y.message_content) ilike pat
       or (d <> '' and public.crm_search_digits(y.phone) like '%' || d || '%')
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
  'Shared CRM and leads search. SECURITY INVOKER: results respect the caller''s row policies.';
