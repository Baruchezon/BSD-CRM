-- 24.11.2026 (בקשת ברוך): «בקשות להערכות שווי».
-- Every submission of the public valuation calculator on www.bsd-bbi.co.il/הערכת-שווי-עסק/
-- is stored here with all answers and the result shown, numbered «הערכת שווי מס׳ X».
-- Anonymous submissions are stored too (statistics). Contact details are attached only when
-- the visitor leaves them in the page's own lead form.
-- Write path: two narrow SECURITY DEFINER RPCs callable with the site's publishable key.
-- The result is recomputed here (same formula as assets/valuation-calculator.js v20261124d),
-- so a forged request can't plant arbitrary numbers. No anon table policies at all.
-- Read path: CRM admin/manager (active profile) only.

create table if not exists public.valuation_requests (
  id uuid primary key default gen_random_uuid(),
  request_number bigint generated always as identity (start with 1) unique,
  created_at timestamptz not null default now(),
  client_token uuid not null default gen_random_uuid() unique,
  calc_version text,
  sector text not null,
  sector_label text not null,
  profit numeric not null,
  owner_dependency text,
  staff text,
  books text,
  location text,
  risk text,
  trend text,
  business_age text,
  answer_labels jsonb not null default '{}'::jsonb,
  result_kind text not null check (result_kind in ('range', 'not_profitable')),
  value_low numeric,
  value_high numeric,
  multiple_low numeric,
  multiple_high numeric,
  adjustment numeric,
  value_ups text[] not null default '{}',
  value_downs text[] not null default '{}',
  client_result jsonb,
  contact_name text,
  contact_phone text,
  contact_email text,
  contact_city text,
  contact_purposes text[],
  contact_at timestamptz,
  lead_id uuid references public.leads(id) on delete set null,
  page text,
  referrer_host text,
  utm text,
  device_type text,
  ip_hash text,
  is_test boolean not null default false,
  is_archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid
);

create index if not exists valuation_requests_created_idx on public.valuation_requests (created_at desc);
create index if not exists valuation_requests_ip_idx on public.valuation_requests (ip_hash, created_at desc);

alter table public.valuation_requests enable row level security;

drop policy if exists valuation_requests_admin_manager_select on public.valuation_requests;
create policy valuation_requests_admin_manager_select on public.valuation_requests
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.role in ('admin', 'manager')));

revoke all on table public.valuation_requests from public, anon, authenticated;
grant select on table public.valuation_requests to authenticated;

-- Server-side copy of the site's calculator (valuation-calculator.js v20261124d).
create or replace function public.valuation_calc(p_sector text, p_profit numeric, p_answers jsonb)
returns jsonb language plpgsql immutable set search_path to 'pg_catalog', 'public' as $$
declare
  sectors jsonb := '{
    "food":["מסעדות, בתי קפה ומזון",1.0,2.0],
    "retail":["חנויות, מינימרקטים וקמעונאות",1.2,2.2],
    "services":["שירותים, קליניקות ומספרות",1.5,2.5],
    "kids":["חינוך, חוגים ופנאי",1.3,2.3],
    "transport":["תחבורה, הסעות ולוגיסטיקה",1.8,3.0],
    "tourism":["תיירות, מלונאות ואירוח",1.8,3.2],
    "import":["ייבוא, סיטונאות והפצה",2.0,3.5],
    "industry":["תעשייה, ייצור ומפעלים",2.0,3.5],
    "online":["טכנולוגיה, דיגיטל ומסחר מקוון",2.0,4.0],
    "other":["תחום אחר",1.5,2.5]}'::jsonb;
  factors jsonb := '{
    "owner":{"high":[-0.15,"תלות גבוהה בבעלים"],"mid":[0,""],"low":[0.07,"העסק עובד גם בלי הבעלים"]},
    "staff":{"new":[-0.05,"עובדים חדשים"],"mid":[0,""],"veteran":[0.06,"עובדים ותיקים"],"none":[0,""]},
    "books":{"messy":[-0.12,"נתונים לא מסודרים"],"mid":[0,""],"organized":[0.08,"עסק מסודר"]},
    "location":{"weak":[-0.08,"מיקום חלש או שכירות קצרה"],"mid":[0,""],"strong":[0.06,"מיקום מצוין ושכירות ארוכה"],"na":[0,""]},
    "risk":{"high":[-0.12,"סיכון מהותי / לקוח מרכזי"],"mid":[0,""],"low":[0.05,"לקוחות וספקים מפוזרים"]},
    "trend":{"down":[-0.15,"רווחים בירידה"],"flat":[0,""],"up":[0.08,"רווחים בעלייה"]},
    "age":{"young":[-0.10,"עסק צעיר"],"mid":[0,""],"old":[0.05,"עסק ותיק עם מוניטין"]}}'::jsonb;
  s jsonb := coalesce(sectors -> p_sector, sectors -> 'other');
  k text;
  e jsonb;
  adj numeric := 0;
  ups text[] := '{}';
  downs text[] := '{}';
  lo numeric; hi numeric; vlo numeric; vhi numeric;
begin
  foreach k in array array['owner','staff','books','location','risk','trend','age'] loop
    e := factors -> k -> (p_answers ->> k);
    if e is null then continue; end if;
    adj := adj + (e ->> 0)::numeric;
    if (e ->> 0)::numeric > 0 then ups := ups || (e ->> 1); end if;
    if (e ->> 0)::numeric < 0 then downs := downs || (e ->> 1); end if;
  end loop;
  adj := least(0.35, greatest(-0.45, adj));
  lo := (s ->> 1)::numeric * (1 + adj);
  hi := (s ->> 2)::numeric * (1 + adj);
  vlo := p_profit * lo; vhi := p_profit * hi;
  -- roundNice(): 50K steps from 2M, 10K from 500K, else 5K (JS Math.round = half up)
  vlo := greatest(0, floor(vlo / (case when vlo >= 2000000 then 50000 when vlo >= 500000 then 10000 else 5000 end) + 0.5) * (case when vlo >= 2000000 then 50000 when vlo >= 500000 then 10000 else 5000 end));
  vhi := greatest(0, floor(vhi / (case when vhi >= 2000000 then 50000 when vhi >= 500000 then 10000 else 5000 end) + 0.5) * (case when vhi >= 2000000 then 50000 when vhi >= 500000 then 10000 else 5000 end));
  return jsonb_build_object('sector_label', s ->> 0, 'adj', adj, 'mult_low', round(lo, 3), 'mult_high', round(hi, 3),
    'low', vlo, 'high', vhi, 'ups', to_jsonb(ups), 'downs', to_jsonb(downs));
end $$;

create or replace function public.submit_valuation_request(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path to 'pg_catalog', 'public' as $$
declare
  allowed jsonb := '{
    "sector":["food","retail","services","kids","transport","tourism","import","industry","online","other"],
    "owner":["high","mid","low"], "staff":["new","mid","veteran","none"], "books":["messy","mid","organized"],
    "location":["weak","mid","strong","na"], "risk":["high","mid","low"], "trend":["down","flat","up"],
    "age":["young","mid","old"]}'::jsonb;
  k text;
  v text;
  profit numeric;
  calc jsonb;
  hdr jsonb;
  ip text;
  iph text;
  rec public.valuation_requests%rowtype;
  labels jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 6000 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  foreach k in array array['sector','owner','staff','books','location','risk','trend','age'] loop
    v := p ->> k;
    if v is null or not (allowed -> k ? v) then raise exception 'invalid %', k using errcode = '22023'; end if;
  end loop;
  begin
    profit := round((p ->> 'profit')::numeric);
  exception when others then
    raise exception 'invalid profit' using errcode = '22023';
  end;
  if profit is null or profit < -1000000000 or profit > 1000000000 then
    raise exception 'invalid profit' using errcode = '22023';
  end if;

  begin hdr := current_setting('request.headers', true)::jsonb; exception when others then hdr := null; end;
  ip := split_part(coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-forwarded-for', ''), ',', 1);
  iph := case when ip = '' then null else md5('bsd-valuation:' || ip) end;
  if iph is not null and (select count(*) from public.valuation_requests r
                          where r.ip_hash = iph and r.created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'rate limited' using errcode = '53400';
  end if;

  calc := public.valuation_calc(p ->> 'sector', profit, p);
  labels := case when jsonb_typeof(p -> 'labels') = 'object' then p -> 'labels' else '{}'::jsonb end;

  insert into public.valuation_requests (
    calc_version, sector, sector_label, profit, owner_dependency, staff, books, location, risk, trend, business_age,
    answer_labels, result_kind, value_low, value_high, multiple_low, multiple_high, adjustment, value_ups, value_downs,
    client_result, page, referrer_host, utm, device_type, ip_hash, is_test)
  values (
    left(p ->> 'calc_version', 40), p ->> 'sector', calc ->> 'sector_label', profit, p ->> 'owner', p ->> 'staff',
    p ->> 'books', p ->> 'location', p ->> 'risk', p ->> 'trend', p ->> 'age',
    labels, case when profit <= 0 then 'not_profitable' else 'range' end,
    case when profit > 0 then (calc ->> 'low')::numeric end, case when profit > 0 then (calc ->> 'high')::numeric end,
    case when profit > 0 then (calc ->> 'mult_low')::numeric end, case when profit > 0 then (calc ->> 'mult_high')::numeric end,
    (calc ->> 'adj')::numeric,
    case when profit > 0 then array(select jsonb_array_elements_text(calc -> 'ups')) else '{}' end,
    case when profit > 0 then array(select jsonb_array_elements_text(calc -> 'downs')) else '{}' end,
    case when jsonb_typeof(p -> 'client_result') = 'object' then p -> 'client_result' end,
    left(p ->> 'page', 300), left(p ->> 'referrer_host', 180), left(p ->> 'utm', 200), left(p ->> 'device_type', 20),
    iph, coalesce((p ->> 'is_test')::boolean, false))
  returning * into rec;

  return jsonb_build_object('request_number', rec.request_number, 'token', rec.client_token);
end $$;

-- The visitor left details in the page's lead form after seeing the result: attach them once,
-- only within 6 hours, only with the secret per-submission token. Best-effort link to the
-- lead that website-lead just created (same phone, last 2 hours).
create or replace function public.attach_valuation_request_contact(p_token uuid, p jsonb)
returns boolean language plpgsql volatile security definer set search_path to 'pg_catalog', 'public' as $$
declare
  rid uuid;
  ph text := left(btrim(coalesce(p ->> 'phone', '')), 40);
  digits text;
  lid uuid;
begin
  if p_token is null or p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 3000 then return false; end if;
  select id into rid from public.valuation_requests
   where client_token = p_token and contact_at is null and created_at > now() - interval '6 hours'
   for update;
  if rid is null then return false; end if;
  digits := regexp_replace(regexp_replace(ph, '\D', '', 'g'), '^(00972|972)', '0');
  if char_length(digits) >= 9 then
    select l.id into lid from public.leads l
     where l.created_at > now() - interval '2 hours'
       and regexp_replace(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), '^(00972|972)', '0') = digits
     order by l.created_at desc limit 1;
  end if;
  update public.valuation_requests set
    contact_name = nullif(left(btrim(coalesce(p ->> 'name', '')), 120), ''),
    contact_phone = nullif(ph, ''),
    contact_email = nullif(left(btrim(coalesce(p ->> 'email', '')), 200), ''),
    contact_city = nullif(left(btrim(coalesce(p ->> 'city', '')), 120), ''),
    contact_purposes = case when jsonb_typeof(p -> 'purposes') = 'array'
                            then array(select left(x, 80) from jsonb_array_elements_text(p -> 'purposes') x limit 5) end,
    contact_at = now(),
    lead_id = coalesce(lid, lead_id)
  where id = rid;
  return true;
end $$;

-- CRM: hide a test/duplicate row (soft, reversible). Admin/manager only.
create or replace function public.set_valuation_request_archived(p_id uuid, p_archived boolean)
returns boolean language plpgsql volatile security definer set search_path to 'pg_catalog', 'public' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and role in ('admin', 'manager')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.valuation_requests set is_archived = coalesce(p_archived, false),
    archived_at = case when p_archived then now() end, archived_by = case when p_archived then auth.uid() end
  where id = p_id;
  return found;
end $$;

revoke all on function public.valuation_calc(text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.submit_valuation_request(jsonb) from public;
revoke all on function public.attach_valuation_request_contact(uuid, jsonb) from public;
revoke all on function public.set_valuation_request_archived(uuid, boolean) from public, anon;
grant execute on function public.submit_valuation_request(jsonb) to anon, authenticated;
grant execute on function public.attach_valuation_request_contact(uuid, jsonb) to anon, authenticated;
grant execute on function public.set_valuation_request_archived(uuid, boolean) to authenticated;

comment on table public.valuation_requests is 'בקשות להערכות שווי מהמחשבון באתר (24.11.2026). קריאה: admin/manager בלבד. כתיבה: submit_valuation_request / attach_valuation_request_contact.';
