-- Compliance and CRM fields for business-alert subscribers.
-- Extends the live 20261112 / 20261112b schema. Does not open the tables to anon.
-- Apply before deploying business-alert-signup, business-alert-unsubscribe,
-- business-alert-admin, and business-alert-visit.
-- Rollback: supabase/migrations/rollback_20261113120000_business_alert_compliance.sql

begin;

do $$
begin
  if to_regclass('public.business_alert_subscribers') is null then
    raise exception 'business_alert_subscribers is missing; apply the 20261112 migrations first';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'business_alert_manager') then
    raise exception 'role business_alert_manager is missing; apply 20261112b first';
  end if;
end $$;

create or replace function public.business_alert_new_token()
returns text
language sql
volatile
set search_path = pg_catalog
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
$$;

comment on function public.business_alert_new_token() is
  '32-byte url-safe token for unsubscribe links and visit cookies. Not a guessable uuid.';

revoke all on function public.business_alert_new_token() from public, anon, authenticated;
grant execute on function public.business_alert_new_token() to service_role;

alter table public.business_alert_subscribers
  add column if not exists consent_general boolean,
  add column if not exists consent_text text,
  add column if not exists consent_version text,
  add column if not exists source_url text,
  add column if not exists legacy_no_consent boolean not null default true,
  add column if not exists email_unsubscribed_at timestamptz,
  add column if not exists whatsapp_unsubscribed_at timestamptz,
  add column if not exists do_not_call boolean not null default false,
  add column if not exists do_not_call_at timestamptz,
  add column if not exists manager_notes text,
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by text,
  add column if not exists crm_lead_id uuid,
  add column if not exists visit_token text;

-- Existing rows, and rows the already-deployed signup inserts without these
-- columns, stay legacy until a request with the new consent fields arrives.
update public.business_alert_subscribers
set legacy_no_consent = true
where consent_general is not true;

alter table public.business_alert_subscribers
  alter column unsubscribe_token drop default;

alter table public.business_alert_subscribers
  alter column unsubscribe_token type text using unsubscribe_token::text;

update public.business_alert_subscribers
set unsubscribe_token = public.business_alert_new_token()
where unsubscribe_token is null
   or unsubscribe_token !~ '^[A-Za-z0-9_-]{43}$';

update public.business_alert_subscribers
set visit_token = public.business_alert_new_token()
where visit_token is null
   or visit_token !~ '^[A-Za-z0-9_-]{43}$';

alter table public.business_alert_subscribers
  alter column unsubscribe_token set default public.business_alert_new_token(),
  alter column visit_token set default public.business_alert_new_token(),
  alter column visit_token set not null;

create unique index if not exists business_alert_subscribers_visit_token_key
  on public.business_alert_subscribers (visit_token);

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_status_check,
  drop constraint if exists business_alert_subscribers_unsubscribed_at_check,
  drop constraint if exists business_alert_subscribers_unsubscribed_by_check,
  drop constraint if exists business_alert_subscribers_active_consent_check,
  drop constraint if exists business_alert_subscribers_unsubscribe_token_len_check,
  drop constraint if exists business_alert_subscribers_crm_lead_id_fkey;

update public.business_alert_subscribers
set status = 'unsubscribed_all',
    email_unsubscribed_at = coalesce(email_unsubscribed_at, unsubscribed_at, now()),
    whatsapp_unsubscribed_at = coalesce(whatsapp_unsubscribed_at, unsubscribed_at, now()),
    unsubscribed_at = coalesce(unsubscribed_at, now())
where status = 'unsubscribed';

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_status_check
    check (status = any (array['active','unsubscribed','unsubscribed_email','unsubscribed_whatsapp','unsubscribed_all'])),
  add constraint business_alert_subscribers_active_consent_check
    check (status <> 'active' or consent_email is true or consent_whatsapp is true),
  add constraint business_alert_subscribers_unsubscribed_at_check
    check (
      (status = 'active' and unsubscribed_at is null and email_unsubscribed_at is null and whatsapp_unsubscribed_at is null)
      or (status = 'unsubscribed_email' and unsubscribed_at is not null and email_unsubscribed_at is not null and whatsapp_unsubscribed_at is null)
      or (status = 'unsubscribed_whatsapp' and unsubscribed_at is not null and whatsapp_unsubscribed_at is not null and email_unsubscribed_at is null)
      or (status in ('unsubscribed', 'unsubscribed_all') and unsubscribed_at is not null and email_unsubscribed_at is not null and whatsapp_unsubscribed_at is not null)
    ),
  add constraint business_alert_subscribers_unsubscribed_by_check
    check (
      (status = 'active' and unsubscribed_by is null)
      or (status <> 'active' and unsubscribed_by = any (array['self_link','manager','admin','whatsapp_stop']))
    ),
  add constraint business_alert_subscribers_unsubscribe_token_len_check
    check (char_length(unsubscribe_token) >= 43),
  add constraint business_alert_subscribers_crm_lead_id_fkey
    foreign key (crm_lead_id) references public.leads(id) on delete set null;

comment on column public.business_alert_subscribers.legacy_no_consent is
  'True when the row was saved by the pre-13.11.2026 form, or without consent_general. Marketing sends must treat it as not consented.';
comment on column public.business_alert_subscribers.consent_general is
  'The required «אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה» checkbox. Null on legacy rows.';
comment on column public.business_alert_subscribers.consent_text is
  'The full wording shown on the form, stored only for the new consent contract.';
comment on column public.business_alert_subscribers.visit_token is
  'Opaque 32-byte token for listing-page visits. Not the unsubscribe token, and not returned by the public signup response.';

create or replace function public.business_alert_sync_compliance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'unsubscribed' then
    new.status := 'unsubscribed_all';
    if new.email_unsubscribed_at is null then
      new.email_unsubscribed_at := coalesce(new.unsubscribed_at, now());
    end if;
    if new.whatsapp_unsubscribed_at is null then
      new.whatsapp_unsubscribed_at := coalesce(new.unsubscribed_at, now());
    end if;
    if new.unsubscribed_at is null then
      new.unsubscribed_at := now();
    end if;
    if new.unsubscribed_by is null then
      new.unsubscribed_by := 'self_link';
    end if;
  elsif new.status = 'active'
    and new.unsubscribed_at is null
    and (tg_op = 'INSERT' or old.status is distinct from 'active' or old.unsubscribed_at is not null) then
    new.email_unsubscribed_at := null;
    new.whatsapp_unsubscribed_at := null;
    new.unsubscribed_by := null;
    new.unsubscribe_reason := null;
  end if;

  if tg_op = 'INSERT' or new.consent_general is distinct from old.consent_general then
    if new.consent_general is not true then
      new.legacy_no_consent := true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists business_alert_sync_compliance on public.business_alert_subscribers;
create trigger business_alert_sync_compliance
  before insert or update on public.business_alert_subscribers
  for each row execute function public.business_alert_sync_compliance();

create table if not exists public.business_alert_send_attempts (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.business_alert_subscribers(id),
  channel text not null check (channel = any (array['email','whatsapp'])),
  purpose text not null check (purpose = any (array['alert','manual'])),
  business_number text,
  allowed boolean not null,
  block_reason text,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists business_alert_send_attempts_subscriber_idx
  on public.business_alert_send_attempts (subscriber_id, created_at desc);

alter table public.business_alert_send_attempts enable row level security;
revoke all on public.business_alert_send_attempts from public, anon, authenticated;
grant select, insert on public.business_alert_send_attempts to service_role;

comment on table public.business_alert_send_attempts is
  'Every email or WhatsApp attempt, including ones the consent gate blocked. Rows are not deleted.';

create table if not exists public.business_alert_page_views (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.business_alert_subscribers(id),
  page_path text not null check (char_length(page_path) between 1 and 240 and page_path ~ '^/[^?]*$'),
  via text not null check (via = any (array['email_link','cookie'])),
  viewed_at timestamptz not null default now()
);

create index if not exists business_alert_page_views_subscriber_idx
  on public.business_alert_page_views (subscriber_id, viewed_at desc);

alter table public.business_alert_page_views enable row level security;
revoke all on public.business_alert_page_views from public, anon, authenticated;
grant select, insert on public.business_alert_page_views to service_role;

comment on table public.business_alert_page_views is
  'Listing paths a signed-up visitor opened. No name, email, phone, or IP. Empty until the website sends the visit token.';

alter table public.business_alert_signup_attempts
  drop constraint if exists business_alert_signup_attempts_kind_check;
alter table public.business_alert_signup_attempts
  add constraint business_alert_signup_attempts_kind_check
  check (kind = any (array['signup','unsubscribe','visit','send']));

create or replace function public.business_alert_is_stop_text(p_text text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select lower(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')))
    = any (array['הסר','הסירו','stop']);
$$;

create or replace function public.business_alert_unsubscribe_by_token(
  p_token text,
  p_channel text default 'all',
  p_actor text default 'self_link'
)
returns table(found boolean, status text, already boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_status text;
  v_email timestamptz;
  v_whatsapp timestamptz;
  v_at timestamptz;
  v_channel text := coalesce(nullif(btrim(coalesce(p_channel, '')), ''), 'all');
  v_actor text := coalesce(nullif(btrim(coalesce(p_actor, '')), ''), 'self_link');
  v_email_off boolean;
  v_whatsapp_off boolean;
  v_next text;
  v_now timestamptz := now();
begin
  if v_channel not in ('email', 'whatsapp', 'all') then
    raise exception 'invalid channel' using errcode = '22023';
  end if;
  if v_actor not in ('self_link', 'manager', 'admin', 'whatsapp_stop') then
    raise exception 'invalid actor' using errcode = '22023';
  end if;
  if p_token is null or char_length(p_token) < 43 or char_length(p_token) > 200
     or p_token !~ '^[A-Za-z0-9_-]+$' then
    return query select false, null::text, false;
    return;
  end if;

  select s.id, s.status, s.email_unsubscribed_at, s.whatsapp_unsubscribed_at, s.unsubscribed_at
    into v_id, v_status, v_email, v_whatsapp, v_at
  from public.business_alert_subscribers as s
  where s.unsubscribe_token = p_token
  for update;

  if not found then
    return query select false, null::text, false;
    return;
  end if;

  v_email_off := v_channel in ('email', 'all')
    or v_email is not null
    or v_status in ('unsubscribed', 'unsubscribed_all', 'unsubscribed_email');
  v_whatsapp_off := v_channel in ('whatsapp', 'all')
    or v_whatsapp is not null
    or v_status in ('unsubscribed', 'unsubscribed_all', 'unsubscribed_whatsapp');
  v_next := case
    when v_email_off and v_whatsapp_off then 'unsubscribed_all'
    when v_email_off then 'unsubscribed_email'
    else 'unsubscribed_whatsapp'
  end;

  if v_status = v_next or (v_next = 'unsubscribed_all' and v_status in ('unsubscribed', 'unsubscribed_all')) then
    return query select true, 'unsubscribed_all'::text, true
    where v_next = 'unsubscribed_all'
    union all
    select true, v_next, true
    where v_next <> 'unsubscribed_all';
    return;
  end if;

  update public.business_alert_subscribers as s
  set status = v_next,
      email_unsubscribed_at = case when v_email_off then coalesce(s.email_unsubscribed_at, v_now) else null end,
      whatsapp_unsubscribed_at = case when v_whatsapp_off then coalesce(s.whatsapp_unsubscribed_at, v_now) else null end,
      unsubscribed_at = coalesce(s.unsubscribed_at, v_now),
      unsubscribed_by = v_actor,
      unsubscribe_reason = coalesce(s.unsubscribe_reason, v_channel)
  where s.id = v_id;

  return query select true, v_next, false;
end;
$$;

create or replace function public.business_alert_apply_whatsapp_stop(p_phone text, p_text text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_phone9 text := nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9), '');
  v_token text;
  v_count integer := 0;
begin
  if not public.business_alert_is_stop_text(p_text) then
    return 0;
  end if;
  if v_phone9 is null or char_length(v_phone9) <> 9 then
    return 0;
  end if;
  for v_token in
    select s.unsubscribe_token
    from public.business_alert_subscribers as s
    where s.phone9 = v_phone9
  loop
    perform public.business_alert_unsubscribe_by_token(v_token, 'whatsapp', 'whatsapp_stop');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.business_alert_apply_whatsapp_stop(text, text) is
  'Call from the inbound WhatsApp webhook when the text is הסר, הסירו, or stop. Not wired: the 077/Meta setup is frozen.';

create or replace function public.business_alert_gate_send(
  p_subscriber_id uuid,
  p_channel text,
  p_purpose text,
  p_business_number text default null,
  p_match_pct numeric default null
)
returns table(allowed boolean, reason text, attempt_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.business_alert_subscribers%rowtype;
  v_reason text := null;
  v_allowed boolean := false;
  v_id uuid;
  v_purpose text := coalesce(p_purpose, '');
begin
  if p_channel not in ('email', 'whatsapp') then
    raise exception 'channel must be email or whatsapp' using errcode = '22023';
  end if;
  if v_purpose not in ('alert', 'manual') then
    raise exception 'purpose must be alert or manual' using errcode = '22023';
  end if;

  select * into v_row
  from public.business_alert_subscribers
  where id = p_subscriber_id;

  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;

  if v_purpose = 'alert' and nullif(btrim(coalesce(p_business_number, '')), '') is not null then
    if p_match_pct is null or p_match_pct < 0 or p_match_pct > 100 then
      raise exception 'match_pct must be between 0 and 100' using errcode = '22023';
    end if;
  end if;

  if v_row.legacy_no_consent is true then
    v_reason := 'legacy_no_consent';
  elsif v_row.consent_general is not true then
    v_reason := 'no_general_consent';
  elsif p_channel = 'email' and (
    v_row.status in ('unsubscribed', 'unsubscribed_all', 'unsubscribed_email')
    or v_row.email_unsubscribed_at is not null
  ) then
    v_reason := 'unsubscribed_email';
  elsif p_channel = 'whatsapp' and (
    v_row.status in ('unsubscribed', 'unsubscribed_all', 'unsubscribed_whatsapp')
    or v_row.whatsapp_unsubscribed_at is not null
  ) then
    v_reason := 'unsubscribed_whatsapp';
  elsif p_channel = 'email' and v_row.consent_email is not true then
    v_reason := 'no_email_consent';
  elsif p_channel = 'whatsapp' and v_row.consent_whatsapp is not true then
    v_reason := 'no_whatsapp_consent';
  else
    v_allowed := true;
  end if;

  insert into public.business_alert_send_attempts
    (subscriber_id, channel, purpose, business_number, allowed, block_reason, created_by)
  values
    (p_subscriber_id, p_channel, v_purpose, nullif(btrim(coalesce(p_business_number, '')), ''), v_allowed, v_reason, session_user)
  returning id into v_id;

  if v_allowed and v_purpose = 'alert' and nullif(btrim(coalesce(p_business_number, '')), '') is not null then
    insert into public.business_alert_sends (subscriber_id, business_number, match_pct, channel, created_by)
    values (p_subscriber_id, btrim(p_business_number), p_match_pct, p_channel, session_user)
    on conflict (subscriber_id, business_number) do nothing;
  end if;

  return query select v_allowed, v_reason, v_id;
end;
$$;

create or replace function public.business_alert_log_send(
  p_subscriber_id uuid,
  p_business_number text,
  p_match_pct numeric,
  p_channel text default 'email'
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_allowed boolean;
  v_reason text;
begin
  select g.allowed, g.reason
    into v_allowed, v_reason
  from public.business_alert_gate_send(p_subscriber_id, p_channel, 'alert', p_business_number, p_match_pct) as g;

  if v_reason = 'not_found' then
    raise exception 'subscriber not found' using errcode = 'P0002';
  end if;
  if v_allowed is not true then
    raise exception '%', coalesce(v_reason, 'blocked') using errcode = '42501';
  end if;
  return true;
end;
$$;

create or replace function public.business_alert_active_email_subscribers()
returns table(
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  phone9 text,
  interests text[],
  budget_min numeric,
  budget_max numeric,
  budget_open boolean,
  region text,
  consent_whatsapp boolean,
  source text,
  created_at timestamptz,
  sent_business_numbers text[]
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    s.id, s.first_name, s.last_name, s.email, s.phone, s.phone9, s.interests,
    s.budget_min, s.budget_max, s.budget_open, s.region, s.consent_whatsapp,
    s.source, s.created_at,
    coalesce((
      select array_agg(d.business_number order by d.sent_at, d.business_number)
      from public.business_alert_sends d
      where d.subscriber_id = s.id
    ), '{}'::text[]) as sent_business_numbers
  from public.business_alert_subscribers s
  where s.legacy_no_consent is not true
    and s.consent_general is true
    and s.consent_email is true
    and s.email_unsubscribed_at is null
    and s.status in ('active', 'unsubscribed_whatsapp');
$$;

create or replace function public.business_alert_apply_status(
  p_subscriber_id uuid,
  p_status text,
  p_reason text default null,
  p_fresh_consent boolean default false
)
returns table(id uuid, status text, unsubscribed_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.business_alert_subscribers%rowtype;
  v_status text := case when p_status = 'unsubscribed' then 'unsubscribed_all' else p_status end;
  v_now timestamptz := now();
  v_email_off boolean;
  v_whatsapp_off boolean;
  v_next text;
begin
  if v_status not in ('active', 'unsubscribed_email', 'unsubscribed_whatsapp', 'unsubscribed_all') then
    raise exception 'status must be active or an unsubscribe state' using errcode = '22023';
  end if;

  select * into v_row
  from public.business_alert_subscribers
  where business_alert_subscribers.id = p_subscriber_id
  for update;

  if not found then
    raise exception 'subscriber not found' using errcode = 'P0002';
  end if;

  if v_status = 'active' then
    if p_fresh_consent is not true and (
      v_row.legacy_no_consent is true
      or v_row.consent_general is not true
      or v_row.email_unsubscribed_at is not null
      or v_row.whatsapp_unsubscribed_at is not null
      or v_row.status <> 'active'
    ) then
      raise exception 'reactivation requires fresh consent' using errcode = '42501';
    end if;
    if v_row.consent_email is not true and v_row.consent_whatsapp is not true then
      raise exception 'reactivation requires a channel consent' using errcode = '42501';
    end if;
    update public.business_alert_subscribers as s
    set status = 'active',
        unsubscribed_at = null,
        unsubscribed_by = null,
        unsubscribe_reason = null,
        email_unsubscribed_at = null,
        whatsapp_unsubscribed_at = null,
        legacy_no_consent = case when p_fresh_consent then false else s.legacy_no_consent end,
        consent_general = case when p_fresh_consent then true else s.consent_general end,
        consent_at = case when p_fresh_consent then v_now else s.consent_at end,
        updated_at = v_now
    where s.id = p_subscriber_id;
  else
    v_email_off := v_status in ('unsubscribed_email', 'unsubscribed_all')
      or v_row.email_unsubscribed_at is not null
      or v_row.status in ('unsubscribed', 'unsubscribed_all', 'unsubscribed_email');
    v_whatsapp_off := v_status in ('unsubscribed_whatsapp', 'unsubscribed_all')
      or v_row.whatsapp_unsubscribed_at is not null
      or v_row.status in ('unsubscribed', 'unsubscribed_all', 'unsubscribed_whatsapp');
    v_next := case
      when v_email_off and v_whatsapp_off then 'unsubscribed_all'
      when v_email_off then 'unsubscribed_email'
      else 'unsubscribed_whatsapp'
    end;
    update public.business_alert_subscribers as s
    set status = v_next,
        email_unsubscribed_at = case when v_email_off then coalesce(s.email_unsubscribed_at, v_now) else null end,
        whatsapp_unsubscribed_at = case when v_whatsapp_off then coalesce(s.whatsapp_unsubscribed_at, v_now) else null end,
        unsubscribed_at = coalesce(s.unsubscribed_at, v_now),
        unsubscribed_by = 'manager',
        unsubscribe_reason = nullif(btrim(coalesce(p_reason, '')), ''),
        updated_at = v_now
    where s.id = p_subscriber_id;
  end if;

  return query
  select s.id, s.status, s.unsubscribed_at, s.updated_at
  from public.business_alert_subscribers as s
  where s.id = p_subscriber_id;
end;
$$;

create or replace function public.business_alert_set_status(
  p_subscriber_id uuid,
  p_status text,
  p_reason text default null
)
returns table(id uuid, status text, unsubscribed_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  select * from public.business_alert_apply_status(p_subscriber_id, p_status, p_reason, false);
end;
$$;

create or replace function public.business_alert_set_handling(
  p_subscriber_id uuid,
  p_notes text default null,
  p_handled boolean default null,
  p_do_not_call boolean default null
)
returns table(id uuid, handled_at timestamptz, do_not_call boolean, manager_notes text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.business_alert_subscribers as s
  set manager_notes = coalesce(p_notes, s.manager_notes),
      handled_at = case
        when p_handled is true then coalesce(s.handled_at, now())
        when p_handled is false then null
        else s.handled_at
      end,
      handled_by = case
        when p_handled is true then 'manager'
        when p_handled is false then null
        else s.handled_by
      end,
      do_not_call = coalesce(p_do_not_call, s.do_not_call),
      do_not_call_at = case
        when p_do_not_call is true then coalesce(s.do_not_call_at, now())
        when p_do_not_call is false then null
        else s.do_not_call_at
      end,
      updated_at = now()
  where s.id = p_subscriber_id;

  if not found then
    raise exception 'subscriber not found' using errcode = 'P0002';
  end if;

  return query
  select s.id, s.handled_at, s.do_not_call, s.manager_notes
  from public.business_alert_subscribers as s
  where s.id = p_subscriber_id;
end;
$$;

create or replace function public.business_alert_record_visit(
  p_token text,
  p_path text,
  p_via text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_path text := left(split_part(split_part(coalesce(p_path, ''), '?', 1), '#', 1), 240);
begin
  if p_via not in ('email_link', 'cookie') then
    return false;
  end if;
  if v_path !~ '^/[^?]*$' or v_path like '//%' or position('..' in v_path) > 0 then
    return false;
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return false;
  end if;
  select s.id into v_id
  from public.business_alert_subscribers as s
  where s.visit_token = p_token;
  if not found then
    return false;
  end if;
  insert into public.business_alert_page_views (subscriber_id, page_path, via)
  values (v_id, v_path, p_via);
  return true;
end;
$$;

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
      s.budget_min, s.budget_max, s.budget_open, s.region,
      s.consent_email, s.consent_whatsapp, s.consent_general, s.consent_text,
      s.consent_version, s.consent_text_version, s.consent_at, s.source, s.source_url,
      s.legacy_no_consent, s.status, s.unsubscribed_at, s.unsubscribed_by, s.unsubscribe_reason,
      s.email_unsubscribed_at, s.whatsapp_unsubscribed_at,
      s.do_not_call, s.do_not_call_at, s.manager_notes, s.handled_at, s.handled_by,
      s.crm_lead_id, s.created_at, s.updated_at,
      (select count(*) from public.business_alert_page_views v where v.subscriber_id = s.id) as view_count,
      (select count(*) from public.business_alert_sends d where d.subscriber_id = s.id) as send_count
    from public.business_alert_subscribers s
  ) x;
$$;

create or replace function public.business_alert_crm_detail(p_subscriber_id uuid)
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
          s.budget_min, s.budget_max, s.budget_open, s.region,
          s.consent_email, s.consent_whatsapp, s.consent_general, s.consent_text,
          s.consent_version, s.consent_text_version, s.consent_at, s.source, s.source_url,
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
    'sends', coalesce((
      select jsonb_agg(jsonb_build_object('business_number', d.business_number, 'channel', d.channel, 'match_pct', d.match_pct, 'sent_at', d.sent_at) order by d.sent_at desc)
      from public.business_alert_sends d
      where d.subscriber_id = p_subscriber_id
    ), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object('channel', a.channel, 'purpose', a.purpose, 'allowed', a.allowed, 'block_reason', a.block_reason, 'created_at', a.created_at) order by a.created_at desc)
      from public.business_alert_send_attempts a
      where a.subscriber_id = p_subscriber_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.business_alert_is_stop_text(text) from public, anon, authenticated;
revoke all on function public.business_alert_unsubscribe_by_token(text, text, text) from public, anon, authenticated;
revoke all on function public.business_alert_apply_whatsapp_stop(text, text) from public, anon, authenticated;
revoke all on function public.business_alert_gate_send(uuid, text, text, text, numeric) from public, anon, authenticated;
revoke all on function public.business_alert_apply_status(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.business_alert_set_handling(uuid, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.business_alert_record_visit(text, text, text) from public, anon, authenticated;
revoke all on function public.business_alert_crm_list() from public, anon, authenticated;
revoke all on function public.business_alert_crm_detail(uuid) from public, anon, authenticated;

grant execute on function public.business_alert_is_stop_text(text) to service_role, business_alert_manager;
grant execute on function public.business_alert_unsubscribe_by_token(text, text, text) to service_role, business_alert_manager;
grant execute on function public.business_alert_apply_whatsapp_stop(text, text) to service_role, business_alert_manager;
grant execute on function public.business_alert_gate_send(uuid, text, text, text, numeric) to service_role, business_alert_manager;
grant execute on function public.business_alert_apply_status(uuid, text, text, boolean) to service_role, business_alert_manager;
grant execute on function public.business_alert_set_handling(uuid, text, boolean, boolean) to service_role, business_alert_manager;
grant execute on function public.business_alert_record_visit(text, text, text) to service_role, business_alert_manager;
grant execute on function public.business_alert_crm_list() to service_role, business_alert_manager;
grant execute on function public.business_alert_crm_detail(uuid) to service_role, business_alert_manager;

-- Re-assert the existing manager-only grants. service_role needs them so the
-- CRM edge function can call them. anon and authenticated stay revoked.
revoke all on function public.business_alert_log_send(uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.business_alert_active_email_subscribers() from public, anon, authenticated;
revoke all on function public.business_alert_set_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.business_alert_log_send(uuid, text, numeric, text) to service_role, business_alert_manager;
grant execute on function public.business_alert_active_email_subscribers() to service_role, business_alert_manager;
grant execute on function public.business_alert_set_status(uuid, text, text) to service_role, business_alert_manager;

commit;
