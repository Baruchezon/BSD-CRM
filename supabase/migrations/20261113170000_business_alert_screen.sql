-- Subscribers screen: filters, card, send history, do-not-call, manual add.
-- Depends on 20261113120000, 20261113143000 and 20261113153000.
-- Proposed only. Do not apply until the CRM screen and admin function are reviewed.
-- opened_at / replied_at stay null. A Resend open/reply webhook is a proposal only
-- and is not created or wired here.
-- Rollback: supabase/migrations/rollback_20261113170000_business_alert_screen.sql

begin;

do $$
begin
  if to_regclass('public.business_alert_subscribers') is null
     or to_regclass('public.business_alert_sends') is null then
    raise exception 'business alert tables are missing; apply the 20261112 migrations first';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'business_alert_manager') then
    raise exception 'role business_alert_manager is missing; apply 20261112b first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'business_alert_subscribers'
      and column_name = 'signup_channel'
  ) then
    raise exception 'apply 20261113153000_business_taxonomy.sql first';
  end if;
end $$;

alter table public.business_alert_subscribers
  add column if not exists manual_source text;

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_manual_source_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_manual_source_check
  check (manual_source is null or manual_source in ('link', 'manual', 'call'));

comment on column public.business_alert_subscribers.manual_source is
  'How an our_link subscriber was added: link, manual, or call. Null on website signups. Soft note only.';

comment on column public.business_alert_subscribers.do_not_call is
  'Soft flag. Never deletes the subscriber. Does not block email or WhatsApp.';

alter table public.business_alert_sends
  add column if not exists opened_at timestamptz,
  add column if not exists replied_at timestamptz;

comment on column public.business_alert_sends.opened_at is
  'Nullable. A future Resend webhook may set this. Not wired.';
comment on column public.business_alert_sends.replied_at is
  'Nullable. A future reply webhook may set this. Not wired.';

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
      s.signup_channel, s.manual_source,
      s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term,
      s.looking_for,
      s.legacy_no_consent, s.status, s.unsubscribed_at, s.unsubscribed_by, s.unsubscribe_reason,
      s.email_unsubscribed_at, s.whatsapp_unsubscribed_at,
      s.do_not_call, s.do_not_call_at, s.manager_notes, s.handled_at, s.handled_by,
      s.crm_lead_id, s.created_at, s.updated_at,
      (select count(*) from public.business_alert_page_views v where v.subscriber_id = s.id) as view_count,
      (select count(*) from public.business_alert_sends d where d.subscriber_id = s.id) as send_count,
      (select max(d.sent_at) from public.business_alert_sends d where d.subscriber_id = s.id) as last_sent_at
    from public.business_alert_subscribers s
  ) x;
$$;

create or replace function public.business_alert_screen_list(
  p_source text default null,
  p_sector text default null,
  p_region text default null,
  p_budget_min numeric default null,
  p_budget_max numeric default null,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_sector text := nullif(btrim(coalesce(p_sector, '')), '');
  v_region text := nullif(btrim(coalesce(p_region, '')), '');
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_kind text;
  v_budget_max numeric;
  v_budget_min numeric;
begin
  if v_source = 'all' then v_source := null; end if;
  if v_status = 'all' then v_status := null; end if;

  for v_item in
    select value from jsonb_array_elements(public.business_alert_crm_list())
  loop
    v_kind := case
      when v_item->>'manual_source' = 'call' then 'call'
      when v_item->>'manual_source' = 'manual' then 'manual'
      when v_item->>'signup_channel' = 'our_link' then 'our_link'
      else 'website'
    end;

    if v_source = 'our_link' and v_kind = 'website' then continue; end if;
    if v_source is not null and v_source <> 'our_link' and v_kind <> v_source then continue; end if;

    if v_sector is not null
       and not coalesce(v_item->'categories', '[]'::jsonb) @> jsonb_build_array(v_sector)
       and not coalesce(v_item->'interests', '[]'::jsonb) @> jsonb_build_array(v_sector) then
      continue;
    end if;

    if v_region is not null
       and not coalesce(v_item->'regions', '[]'::jsonb) @> jsonb_build_array(v_region)
       and v_item->>'region' is distinct from v_region then
      continue;
    end if;

    v_budget_max := nullif(v_item->>'budget_max', '')::numeric;
    v_budget_min := nullif(v_item->>'budget_min', '')::numeric;
    if p_budget_min is not null
       and coalesce((v_item->>'budget_open')::boolean, false) is not true
       and v_budget_max is not null
       and v_budget_max < p_budget_min then
      continue;
    end if;
    if p_budget_max is not null
       and coalesce((v_item->>'budget_open')::boolean, false) is not true
       and v_budget_min is not null
       and v_budget_min > p_budget_max then
      continue;
    end if;

    if v_status = 'do_not_call' and coalesce((v_item->>'do_not_call')::boolean, false) is not true then
      continue;
    elsif v_status = 'unsubscribed_all'
      and coalesce(v_item->>'status', '') not in ('unsubscribed_all', 'unsubscribed') then
      continue;
    elsif v_status is not null
      and v_status not in ('do_not_call', 'unsubscribed_all')
      and v_item->>'status' is distinct from v_status then
      continue;
    end if;

    v_out := v_out || jsonb_build_array(v_item);
  end loop;

  return v_out;
end;
$$;

create or replace function public.business_alert_sends_history(p_subscriber_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.sent_at desc), '[]'::jsonb)
  from (
    select
      d.business_number,
      (
        select b.internal_name
        from public.businesses b
        where b.business_number = d.business_number
        order by b.internal_name
        limit 1
      ) as internal_name,
      d.sent_at,
      d.channel,
      d.match_pct,
      d.opened_at,
      d.replied_at
    from public.business_alert_sends d
    where d.subscriber_id = p_subscriber_id
  ) x;
$$;

comment on function public.business_alert_sends_history(uuid) is
  'Staff only. Returns the internal business name. Never use this payload in email or WhatsApp.';

create or replace function public.business_alert_screen_card(p_subscriber_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'subscriber', (
      select to_jsonb(x) from (
        select
          s.id, s.first_name, s.last_name, s.phone, s.email, s.interests,
          s.categories, s.subcategories, s.regions,
          s.budget_min, s.budget_max, s.budget_open, s.region, s.looking_for,
          s.consent_email, s.consent_whatsapp, s.consent_general, s.consent_text,
          s.consent_version, s.consent_text_version, s.consent_at, s.source, s.source_url,
          s.signup_channel, s.manual_source,
          s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term,
          s.legacy_no_consent, s.status, s.unsubscribed_at, s.unsubscribed_by, s.unsubscribe_reason,
          s.email_unsubscribed_at, s.whatsapp_unsubscribed_at,
          s.do_not_call, s.do_not_call_at, s.manager_notes, s.handled_at, s.crm_lead_id,
          s.created_at, s.updated_at
        from public.business_alert_subscribers s
        where s.id = p_subscriber_id
      ) x
    ),
    'views', coalesce((
      select jsonb_agg(jsonb_build_object('page_path', v.page_path, 'via', v.via, 'viewed_at', v.viewed_at) order by v.viewed_at desc)
      from public.business_alert_page_views v
      where v.subscriber_id = p_subscriber_id
    ), '[]'::jsonb),
    'sends', public.business_alert_sends_history(p_subscriber_id),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object('channel', a.channel, 'purpose', a.purpose, 'allowed', a.allowed, 'block_reason', a.block_reason, 'created_at', a.created_at) order by a.created_at desc)
      from public.business_alert_send_attempts a
      where a.subscriber_id = p_subscriber_id
    ), '[]'::jsonb)
  );
$$;

create or replace function public.business_alert_set_do_not_call(
  p_subscriber_id uuid,
  p_flag boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.business_alert_subscribers%rowtype;
begin
  update public.business_alert_subscribers as s
  set do_not_call = coalesce(p_flag, false),
      do_not_call_at = case
        when coalesce(p_flag, false) then coalesce(s.do_not_call_at, now())
        else null
      end
  where s.id = p_subscriber_id
  returning s.* into v_row;

  if not found then
    raise exception 'subscriber not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'do_not_call', v_row.do_not_call,
    'do_not_call_at', v_row.do_not_call_at
  );
end;
$$;

create or replace function public.business_alert_manual_add(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_manual_source text,
  p_consent_text text,
  p_consent_version text,
  p_consent_email boolean,
  p_consent_whatsapp boolean,
  p_categories text[] default '{}',
  p_subcategories text[] default '{}',
  p_regions text[] default '{}',
  p_budget_min numeric default null,
  p_budget_max numeric default null,
  p_budget_open boolean default false,
  p_looking_for text default null,
  p_region text default null,
  p_interests text[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_phone text := btrim(coalesce(p_phone, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_source text := btrim(coalesce(p_manual_source, ''));
  v_text text := btrim(coalesce(p_consent_text, ''));
  v_version text := btrim(coalesce(p_consent_version, ''));
  v_interests text[] := coalesce(p_interests, '{}');
  v_region text := nullif(btrim(coalesce(p_region, '')), '');
begin
  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = ''
     or v_phone = '' or v_email = '' then
    raise exception 'missing_required_fields' using errcode = '22023';
  end if;
  if v_source not in ('link', 'manual', 'call') then
    raise exception 'invalid_manual_source' using errcode = '22023';
  end if;
  if v_text = '' or v_version = '' or v_version !~ '^[\w.:-]{1,80}$' then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if coalesce(p_consent_email, false) is not true and coalesce(p_consent_whatsapp, false) is not true then
    raise exception 'no_channel' using errcode = '22023';
  end if;
  if exists (select 1 from public.business_alert_subscribers s where lower(s.email) = v_email) then
    raise exception 'email_exists' using errcode = '23505';
  end if;

  if cardinality(v_interests) = 0 then
    v_interests := array['אחר'];
  end if;
  if v_region is null then
    v_region := 'כל הארץ';
  end if;

  insert into public.business_alert_subscribers (
    first_name, last_name, phone, phone9, email,
    interests, categories, subcategories, regions,
    budget_min, budget_max, budget_open, region, looking_for,
    consent_email, consent_whatsapp, consent_general, consent_text,
    consent_version, consent_text_version, consent_at,
    source, signup_channel, manual_source,
    legacy_no_consent, status
  ) values (
    btrim(p_first_name), btrim(p_last_name), v_phone,
    right(regexp_replace(v_phone, '\D', '', 'g'), 9),
    v_email,
    v_interests, coalesce(p_categories, '{}'), coalesce(p_subcategories, '{}'), coalesce(p_regions, '{}'),
    p_budget_min, p_budget_max, coalesce(p_budget_open, false), v_region, nullif(btrim(coalesce(p_looking_for, '')), ''),
    coalesce(p_consent_email, false), coalesce(p_consent_whatsapp, false), true, v_text,
    v_version, v_version, now(),
    'crm-manual', 'our_link', v_source,
    false, 'active'
  )
  returning id into v_id;

  return public.business_alert_screen_card(v_id);
end;
$$;

revoke all on function public.business_alert_crm_list() from public, anon, authenticated;
revoke all on function public.business_alert_screen_list(text, text, text, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.business_alert_sends_history(uuid) from public, anon, authenticated;
revoke all on function public.business_alert_screen_card(uuid) from public, anon, authenticated;
revoke all on function public.business_alert_set_do_not_call(uuid, boolean) from public, anon, authenticated;
revoke all on function public.business_alert_manual_add(text, text, text, text, text, text, text, boolean, boolean, text[], text[], text[], numeric, numeric, boolean, text, text, text[]) from public, anon, authenticated;

grant execute on function public.business_alert_crm_list() to service_role, business_alert_manager;
grant execute on function public.business_alert_screen_list(text, text, text, numeric, numeric, text) to service_role, business_alert_manager;
grant execute on function public.business_alert_sends_history(uuid) to service_role, business_alert_manager;
grant execute on function public.business_alert_screen_card(uuid) to service_role, business_alert_manager;
grant execute on function public.business_alert_set_do_not_call(uuid, boolean) to service_role, business_alert_manager;
grant execute on function public.business_alert_manual_add(text, text, text, text, text, text, text, boolean, boolean, text[], text[], text[], numeric, numeric, boolean, text, text, text[]) to service_role, business_alert_manager;

commit;
