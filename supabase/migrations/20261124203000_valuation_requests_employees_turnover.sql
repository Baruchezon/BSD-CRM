-- 24.11.2026 v2 (Baruch approved via Yossi 20:25): real number of employees + annual turnover (ILS)
-- on the site valuation form. Optional and informational only: valuation_calc is unchanged.
-- Additive: two nullable columns + the submit RPC accepts the optional keys `employees` / `turnover`
-- (integer >= 0 / annual ILS; missing or null = not given).

alter table public.valuation_requests add column if not exists employees_count integer;
alter table public.valuation_requests add column if not exists annual_turnover numeric;
alter table public.valuation_requests drop constraint if exists valuation_requests_employees_count_range;
alter table public.valuation_requests add constraint valuation_requests_employees_count_range
  check (employees_count is null or employees_count between 0 and 100000);
alter table public.valuation_requests drop constraint if exists valuation_requests_annual_turnover_range;
alter table public.valuation_requests add constraint valuation_requests_annual_turnover_range
  check (annual_turnover is null or annual_turnover between 0 and 10000000000);
comment on column public.valuation_requests.employees_count is 'מספר עובדים (מהטופס, לא משפיע על החישוב)';
comment on column public.valuation_requests.annual_turnover is 'מחזור שנתי בש״ח (מהטופס, לא משפיע על החישוב)';

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
  emp integer;
  turn numeric;
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

  -- v2 (24.11.2026, Baruch via Yossi 20:25): optional, informational only (not in valuation_calc).
  -- Missing, null, empty, invalid or out-of-range values are stored as null, never rejected,
  -- so the site never gets a 400 because of these keys.
  begin
    emp := case when jsonb_typeof(p -> 'employees') in ('number', 'string') and btrim(p ->> 'employees') ~ '^[0-9]{1,6}$'
                then (btrim(p ->> 'employees'))::integer end;
  exception when others then emp := null; end;
  if emp is not null and emp > 100000 then emp := null; end if;
  begin
    turn := case when jsonb_typeof(p -> 'turnover') = 'number' then round((p ->> 'turnover')::numeric)
                 when jsonb_typeof(p -> 'turnover') = 'string' and btrim(p ->> 'turnover') ~ '^[0-9][0-9,]*(\.[0-9]+)?$'
                 then round(replace(btrim(p ->> 'turnover'), ',', '')::numeric) end;
  exception when others then turn := null; end;
  if turn is not null and (turn < 0 or turn > 10000000000) then turn := null; end if;

  calc := public.valuation_calc(p ->> 'sector', profit, p);
  labels := case when jsonb_typeof(p -> 'labels') = 'object' then p -> 'labels' else '{}'::jsonb end;
  if emp is not null and not labels ? 'employees' then labels := labels || jsonb_build_object('employees', 'מספר עובדים'); end if;
  if turn is not null and not labels ? 'turnover' then labels := labels || jsonb_build_object('turnover', 'מחזור שנתי (₪)'); end if;

  insert into public.valuation_requests (
    calc_version, sector, sector_label, profit, owner_dependency, staff, books, location, risk, trend, business_age,
    answer_labels, result_kind, value_low, value_high, multiple_low, multiple_high, adjustment, value_ups, value_downs,
    client_result, page, referrer_host, utm, device_type, ip_hash, is_test, employees_count, annual_turnover)
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
    iph, coalesce((p ->> 'is_test')::boolean, false), emp, turn)
  returning * into rec;

  return jsonb_build_object('request_number', rec.request_number, 'token', rec.client_token);
end $$;

revoke all on function public.submit_valuation_request(jsonb) from public;
grant execute on function public.submit_valuation_request(jsonb) to anon, authenticated;

-- Test runs in rolled-back transactions still advance the identity sequence. While no real request
-- exists yet, restart numbering so the first real one is «הערכת שווי מס׳ 1».
do $$
begin
  if not exists (select 1 from public.valuation_requests) then
    perform setval(pg_get_serial_sequence('public.valuation_requests', 'request_number'), 1, false);
  end if;
end $$;
