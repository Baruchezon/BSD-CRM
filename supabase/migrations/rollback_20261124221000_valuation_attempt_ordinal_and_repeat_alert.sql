-- Rollback for 20261124221000_valuation_attempt_ordinal_and_repeat_alert.
-- Restores submit_valuation_request to v3 (protection + buyers count + numbering).
-- Drops alert objects and the new columns. Does not delete valuation_requests rows.
-- Sequence: if no real row numbered 100+ exists, next stays 100.

drop trigger if exists valuation_request_blocks_notify_trg on public.valuation_request_blocks;
drop function if exists public.valuation_request_blocks_notify();
drop function if exists public.valuation_repeat_alert_send_test();

drop policy if exists valuation_repeat_alert_sends_admin_manager_select on public.valuation_repeat_alert_sends;
drop table if exists public.valuation_repeat_alert_sends;
drop table if exists public.valuation_repeat_alert_auth;

alter table public.valuation_request_blocks drop column if exists attempt_no;
alter table public.valuation_request_blocks drop column if exists is_test;

alter table public.valuation_requests drop constraint if exists valuation_requests_visitor_attempt_no_chk;
alter table public.valuation_requests drop column if exists visitor_attempt_no;

-- Restore submit from v3 file (protection + buyers count). Source:
-- 20261124213500_valuation_protection_numbering_buyers_count.sql

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
  vid text;
  vid_hash text;
  fp text;
  fp_hash text;
  consent text;
  vkey text;
  used integer;
  buyers integer;
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

  -- optional, informational only (not in valuation_calc). Invalid -> null, never 400.
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

  -- identification: invalid/missing values are ignored, never rejected (old site clients keep working).
  vid := lower(btrim(coalesce(p ->> 'visitor_id', '')));
  if vid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    vid_hash := md5('bsd-valuation-vid:' || vid);
  end if;
  fp := btrim(coalesce(p ->> 'fp', ''));
  if char_length(fp) between 8 and 200 then
    fp_hash := md5('bsd-valuation-fp:' || fp);
  end if;
  consent := case when p ->> 'consent' in ('granted', 'essential') then p ->> 'consent' end;
  vkey := case
    when vid_hash is not null then 'vid:' || vid_hash
    when fp_hash is not null and iph is not null then 'fp:' || fp_hash || '|ip:' || iph
    else null
  end;

  buyers := public.bsd_active_buyers_count();

  -- 3-limit only when we can identify the person; IP alone is not enough (shared NAT).
  if vid_hash is not null or (fp_hash is not null and iph is not null) then
    used := public.valuation_usage_count(vid_hash, fp_hash, iph, p ->> 'phone', p ->> 'email');
    if used >= 3 then
      insert into public.valuation_request_blocks (
        visitor_id_hash, fingerprint_hash, ip_hash, visitor_key, consent_state, page, attempt_count, snapshot
      ) values (
        vid_hash, fp_hash, iph, vkey, consent, left(p ->> 'page', 300), used,
        jsonb_strip_nulls(jsonb_build_object(
          'sector', p ->> 'sector',
          'profit', profit,
          'employees', emp,
          'turnover', turn
        ))
      );
      return jsonb_build_object(
        'ok', false,
        'error', 'limit_reached',
        'message', 'הגעתם למכסת שלוש הערכות השווי הזמינות במחשבון. לעזרה ולהערכת עומק פנו אלינו: 077-4446707 או info@bsd-bbi.co.il',
        'active_buyers_count', buyers
      );
    end if;
  end if;

  calc := public.valuation_calc(p ->> 'sector', profit, p);
  labels := case when jsonb_typeof(p -> 'labels') = 'object' then p -> 'labels' else '{}'::jsonb end;
  if emp is not null and not labels ? 'employees' then labels := labels || jsonb_build_object('employees', 'מספר עובדים'); end if;
  if turn is not null and not labels ? 'turnover' then labels := labels || jsonb_build_object('turnover', 'מחזור שנתי (₪)'); end if;

  insert into public.valuation_requests (
    calc_version, sector, sector_label, profit, owner_dependency, staff, books, location, risk, trend, business_age,
    answer_labels, result_kind, value_low, value_high, multiple_low, multiple_high, adjustment, value_ups, value_downs,
    client_result, page, referrer_host, utm, device_type, ip_hash, is_test, employees_count, annual_turnover,
    visitor_id_hash, fingerprint_hash, consent_state, visitor_key)
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
    iph, coalesce((p ->> 'is_test')::boolean, false), emp, turn,
    vid_hash, fp_hash, consent, vkey)
  returning * into rec;

  return jsonb_build_object(
    'ok', true,
    'request_number', rec.request_number,
    'token', rec.client_token,
    'active_buyers_count', buyers
  );
end $$;

revoke all on function public.submit_valuation_request(jsonb) from public;
grant execute on function public.submit_valuation_request(jsonb) to anon, authenticated;


select setval(
  pg_get_serial_sequence('public.valuation_requests', 'request_number'),
  case when (select max(request_number) from public.valuation_requests) >= 100
       then (select max(request_number) from public.valuation_requests)
       else 100 end,
  (select max(request_number) from public.valuation_requests) >= 100
);
