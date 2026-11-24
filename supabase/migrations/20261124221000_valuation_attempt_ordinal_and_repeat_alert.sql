-- 24.11.2026 ~22:10 IL (Baruch via Roman): per-visitor attempt ordinal,
-- log 4th+ attempts with attempt_no, and email Baruch at most once per
-- visitor per Israel day. Alerts start from this setup onward (no backfill).
-- Does not touch sending_enabled / dry_run / vip_send_enabled /
-- request_details_enabled / bsd_alert_dispatch_auth.
-- Existing is_test rows 1 and 2 stay as they are. Sequence is set back to
-- next=100 at the end (tests must re-set if they call nextval/insert).

alter table public.valuation_requests
  add column if not exists visitor_attempt_no integer;
alter table public.valuation_requests drop constraint if exists valuation_requests_visitor_attempt_no_chk;
alter table public.valuation_requests add constraint valuation_requests_visitor_attempt_no_chk
  check (visitor_attempt_no is null or visitor_attempt_no between 1 and 3);
comment on column public.valuation_requests.visitor_attempt_no is
  '1/2/3: this visitor''s successful attempt ordinal in the identified cluster. Null if the request could not be identified.';

alter table public.valuation_request_blocks
  add column if not exists attempt_no integer;
alter table public.valuation_request_blocks
  add column if not exists is_test boolean not null default false;
comment on column public.valuation_request_blocks.attempt_no is
  'Nth attempt that was blocked (4, 5, …).';
create index if not exists valuation_request_blocks_is_test_idx
  on public.valuation_request_blocks (is_test, created_at desc);

-- Auth for the valuation-repeat-alert edge function (separate from bsd_alert_dispatch_auth).
create table if not exists public.valuation_repeat_alert_auth (
  id boolean primary key default true check (id),
  token text not null,
  created_at timestamptz not null default now()
);
alter table public.valuation_repeat_alert_auth enable row level security;
revoke all on table public.valuation_repeat_alert_auth from public, anon, authenticated;
grant select on table public.valuation_repeat_alert_auth to service_role;
insert into public.valuation_repeat_alert_auth(id, token)
values (true, encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

create table if not exists public.valuation_repeat_alert_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  visitor_key text not null,
  block_id uuid,
  is_test boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'sent', 'error', 'skipped')),
  resend_id text,
  error text
);
comment on table public.valuation_repeat_alert_sends is
  'Outbound Baruch alerts for 4th+ valuation attempts. At most one successful/queued send per visitor_key per Israel calendar day (non-test).';
create index if not exists valuation_repeat_alert_sends_visitor_day_idx
  on public.valuation_repeat_alert_sends (visitor_key, created_at desc);
alter table public.valuation_repeat_alert_sends enable row level security;
drop policy if exists valuation_repeat_alert_sends_admin_manager_select on public.valuation_repeat_alert_sends;
create policy valuation_repeat_alert_sends_admin_manager_select on public.valuation_repeat_alert_sends
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('admin', 'manager')
  ));
revoke all on table public.valuation_repeat_alert_sends from public, anon, authenticated;
grant select on table public.valuation_repeat_alert_sends to authenticated;
grant all on table public.valuation_repeat_alert_sends to service_role;

-- ---------------------------------------------------------------------------
-- submit_valuation_request: same v3 contract + visitor_attempt_no / attempt_no / is_test on blocks
-- ---------------------------------------------------------------------------
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
  used integer := 0;
  attempt integer;
  buyers integer;
  is_t boolean;
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
  is_t := coalesce((p ->> 'is_test')::boolean, false);
  buyers := public.bsd_active_buyers_count();

  if vid_hash is not null or (fp_hash is not null and iph is not null) then
    used := public.valuation_usage_count(vid_hash, fp_hash, iph, p ->> 'phone', p ->> 'email');
    attempt := used + 1;
    if used >= 3 then
      insert into public.valuation_request_blocks (
        visitor_id_hash, fingerprint_hash, ip_hash, visitor_key, consent_state, page,
        attempt_count, attempt_no, is_test, snapshot
      ) values (
        vid_hash, fp_hash, iph, vkey, consent, left(p ->> 'page', 300),
        used, attempt, is_t,
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
    visitor_id_hash, fingerprint_hash, consent_state, visitor_key, visitor_attempt_no)
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
    iph, is_t, emp, turn,
    vid_hash, fp_hash, consent, vkey, attempt)
  returning * into rec;

  return jsonb_build_object(
    'ok', true,
    'request_number', rec.request_number,
    'token', rec.client_token,
    'active_buyers_count', buyers,
    'visitor_attempt_no', rec.visitor_attempt_no
  );
end $$;

revoke all on function public.submit_valuation_request(jsonb) from public;
grant execute on function public.submit_valuation_request(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Alert trigger: 4th+ (non-test) → at most one email per visitor per IL day.
-- is_test blocks are stored but do not auto-email (Roman QA). A separate
-- test function sends exactly when invoked.
-- ---------------------------------------------------------------------------
create or replace function public.valuation_request_blocks_notify()
returns trigger language plpgsql security definer set search_path to 'pg_catalog', 'public' as $$
declare
  vkey text;
  already boolean;
  payload jsonb;
  hist jsonb;
  send_id uuid;
begin
  if to_regnamespace('net') is null then
    return new;
  end if;
  if coalesce(new.is_test, false) then
    return new;
  end if;
  vkey := coalesce(nullif(new.visitor_key, ''), 'anon:' || new.id::text);

  select exists(
    select 1 from public.valuation_repeat_alert_sends s
    where s.visitor_key = vkey
      and s.is_test is not true
      and s.status in ('queued', 'sent')
      and ((s.created_at at time zone 'Asia/Jerusalem')::date
           = (now() at time zone 'Asia/Jerusalem')::date)
  ) into already;
  if already then
    insert into public.valuation_repeat_alert_sends(visitor_key, block_id, is_test, status)
    values (vkey, new.id, false, 'skipped');
    return new;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'request_number', r.request_number,
      'sector_label', r.sector_label,
      'profit', r.profit,
      'value_low', r.value_low,
      'value_high', r.value_high,
      'created_at', r.created_at,
      'visitor_attempt_no', r.visitor_attempt_no
    ) order by r.created_at), '[]'::jsonb)
  into hist
  from public.valuation_requests r
  where r.visitor_key = new.visitor_key
     or (new.visitor_id_hash is not null and r.visitor_id_hash = new.visitor_id_hash)
     or (new.fingerprint_hash is not null and new.ip_hash is not null
         and r.fingerprint_hash = new.fingerprint_hash and r.ip_hash = new.ip_hash);

  payload := jsonb_build_object(
    'is_test', false,
    'block_id', new.id,
    'visitor_key', vkey,
    'attempt_no', new.attempt_no,
    'attempt_count', new.attempt_count,
    'snapshot', new.snapshot,
    'created_at', new.created_at,
    'history', hist
  );

  insert into public.valuation_repeat_alert_sends(visitor_key, block_id, is_test, status)
  values (vkey, new.id, false, 'queued')
  returning id into send_id;
  payload := payload || jsonb_build_object('send_id', send_id);

  perform net.http_post(
    url := 'https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/valuation-repeat-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bsd-valuation-alert-token',
      (select token from public.valuation_repeat_alert_auth where id = true)
    ),
    body := payload,
    timeout_milliseconds := 20000
  );
  return new;
end $$;

drop trigger if exists valuation_request_blocks_notify_trg on public.valuation_request_blocks;
create trigger valuation_request_blocks_notify_trg
  after insert on public.valuation_request_blocks
  for each row execute function public.valuation_request_blocks_notify();

revoke all on function public.valuation_request_blocks_notify() from public, anon, authenticated;

-- Explicit one-off test email (does not insert a block, does not count toward the daily cap).
create or replace function public.valuation_repeat_alert_send_test()
returns jsonb language plpgsql security definer set search_path to 'pg_catalog', 'public' as $$
declare
  payload jsonb;
  send_id uuid;
begin
  if to_regnamespace('net') is null then
    return jsonb_build_object('ok', false, 'error', 'pg_net missing');
  end if;
  payload := jsonb_build_object(
    'is_test', true,
    'visitor_key', 'vid:test-sample',
    'attempt_no', 4,
    'attempt_count', 3,
    'snapshot', jsonb_build_object('sector', 'food', 'profit', 300000, 'employees', 5, 'turnover', 900000),
    'created_at', now(),
    'history', jsonb_build_array(
      jsonb_build_object('request_number', 100, 'sector_label', 'מסעדות, בתי קפה ומזון', 'profit', 300000,
        'value_low', 300000, 'value_high', 600000, 'created_at', now() - interval '2 days', 'visitor_attempt_no', 1),
      jsonb_build_object('request_number', 101, 'sector_label', 'מסעדות, בתי קפה ומזון', 'profit', 320000,
        'value_low', 320000, 'value_high', 640000, 'created_at', now() - interval '1 day', 'visitor_attempt_no', 2),
      jsonb_build_object('request_number', 102, 'sector_label', 'חנויות, מינימרקטים וקמעונאות', 'profit', 450000,
        'value_low', 450000, 'value_high', 900000, 'created_at', now() - interval '1 hour', 'visitor_attempt_no', 3)
    )
  );
  insert into public.valuation_repeat_alert_sends(visitor_key, is_test, status)
  values ('vid:test-sample', true, 'queued')
  returning id into send_id;
  payload := payload || jsonb_build_object('send_id', send_id);
  perform net.http_post(
    url := 'https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/valuation-repeat-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bsd-valuation-alert-token',
      (select token from public.valuation_repeat_alert_auth where id = true)
    ),
    body := payload,
    timeout_milliseconds := 20000
  );
  return jsonb_build_object('ok', true, 'send_id', send_id);
end $$;

revoke all on function public.valuation_repeat_alert_send_test() from public, anon, authenticated;

-- Keep next real request_number at 100 (this migration does not insert rows).
select setval(
  pg_get_serial_sequence('public.valuation_requests', 'request_number'),
  100,
  false
);
