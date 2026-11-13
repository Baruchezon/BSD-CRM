-- Verbal add during a call, and a soft log of calls, WhatsApp, email and notes.
-- Nothing in business_alert_interactions is deleted. A row is hidden with deleted_at.
-- Apply after 20261113190000. Do not apply until the CRM screen that calls these
-- functions is deployed.
-- Rollback: supabase/migrations/rollback_20261113200000_business_alert_interactions.sql

begin;

alter table public.business_alert_subscribers
  add column if not exists consent_method text,
  add column if not exists consent_by text;

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_consent_method_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_consent_method_check
  check (consent_method is null or consent_method in ('form', 'verbal'));

comment on column public.business_alert_subscribers.consent_method is
  'form for the website checkbox. verbal when a CRM user records spoken consent.';
comment on column public.business_alert_subscribers.consent_by is
  'CRM user who recorded verbal consent. Empty on a website signup.';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'business_alert_subscribers'
      and column_name = 'email'
      and is_nullable = 'NO'
  ) then
    execute 'alter table public.business_alert_subscribers alter column email drop not null';
  end if;
end $$;

create table if not exists public.business_alert_interactions (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.business_alert_subscribers(id),
  at timestamptz not null default now(),
  kind text not null check (kind in ('call', 'whatsapp', 'email', 'note')),
  direction text check (direction is null or direction in ('out', 'in')),
  outcome text check (outcome is null or outcome in ('answered', 'no_answer', 'requested_details', 'other')),
  note text,
  created_by text,
  deleted_at timestamptz,
  deleted_by text
);

create index if not exists business_alert_interactions_subscriber_idx
  on public.business_alert_interactions (subscriber_id, at desc);

alter table public.business_alert_interactions enable row level security;
revoke all on public.business_alert_interactions from public, anon, authenticated;
grant select, insert, update on public.business_alert_interactions to service_role;

comment on table public.business_alert_interactions is
  'Calls, WhatsApp, email and notes for one subscriber. Soft-hide with deleted_at. No delete grant.';

create or replace function public.business_alert_log_interaction(
  p_subscriber_id uuid,
  p_kind text,
  p_direction text,
  p_outcome text,
  p_note text,
  p_created_by text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_kind text := btrim(coalesce(p_kind, ''));
  v_direction text := nullif(btrim(coalesce(p_direction, '')), '');
  v_outcome text := nullif(btrim(coalesce(p_outcome, '')), '');
begin
  if not exists (select 1 from public.business_alert_subscribers s where s.id = p_subscriber_id) then
    raise exception 'subscriber not found' using errcode = 'P0002';
  end if;
  if v_kind not in ('call', 'whatsapp', 'email', 'note') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if v_direction is not null and v_direction not in ('out', 'in') then
    raise exception 'invalid_direction' using errcode = '22023';
  end if;
  if v_outcome is not null and v_outcome not in ('answered', 'no_answer', 'requested_details', 'other') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  insert into public.business_alert_interactions (subscriber_id, kind, direction, outcome, note, created_by)
  values (p_subscriber_id, v_kind, v_direction, v_outcome, nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_created_by, '')), ''))
  returning id into v_id;
  return (
    select jsonb_build_object(
      'id', i.id, 'at', i.at, 'kind', i.kind, 'direction', i.direction,
      'outcome', i.outcome, 'note', i.note, 'created_by', i.created_by
    )
    from public.business_alert_interactions i
    where i.id = v_id
  );
end;
$$;

create or replace function public.business_alert_list_interactions(p_subscriber_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'at', i.at, 'kind', i.kind, 'direction', i.direction,
    'outcome', i.outcome, 'note', i.note, 'created_by', i.created_by
  ) order by i.at desc), '[]'::jsonb)
  from public.business_alert_interactions i
  where i.subscriber_id = p_subscriber_id
    and i.deleted_at is null;
$$;

create or replace function public.business_alert_hide_interaction(
  p_id uuid,
  p_by text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  update public.business_alert_interactions
  set deleted_at = now(),
      deleted_by = nullif(btrim(coalesce(p_by, '')), '')
  where id = p_id
    and deleted_at is null
  returning id into v_id;
  if v_id is null then
    raise exception 'interaction not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v_id, 'hidden', true);
end;
$$;

create or replace function public.business_alert_add_verbal(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_consent_email boolean,
  p_consent_whatsapp boolean,
  p_categories text[],
  p_regions text[],
  p_budget_min numeric,
  p_budget_max numeric,
  p_budget_open boolean,
  p_consent_by text,
  p_verbal boolean
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
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
begin
  if p_verbal is not true then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if v_first = '' or v_phone = '' or btrim(coalesce(p_consent_by, '')) = '' then
    raise exception 'missing_required_fields' using errcode = '22023';
  end if;
  if coalesce(p_consent_email, false) is not true and coalesce(p_consent_whatsapp, false) is not true then
    raise exception 'no_channel' using errcode = '22023';
  end if;
  if v_email is not null and exists (select 1 from public.business_alert_subscribers s where lower(s.email) = v_email) then
    raise exception 'email_exists' using errcode = '23505';
  end if;

  insert into public.business_alert_subscribers (
    first_name, last_name, phone, phone9, email,
    interests, categories, regions,
    budget_min, budget_max, budget_open, region,
    consent_email, consent_whatsapp, consent_general, consent_text,
    consent_version, consent_text_version, consent_at, consent_method, consent_by,
    signup_channel, manual_source, legacy_no_consent, status
  ) values (
    v_first, coalesce(v_last, '—'), v_phone,
    right(regexp_replace(v_phone, '\D', '', 'g'), 9),
    v_email,
    array['אחר'], coalesce(p_categories, '{}'), coalesce(p_regions, '{}'),
    p_budget_min, p_budget_max, coalesce(p_budget_open, false), 'כל הארץ',
    coalesce(p_consent_email, false), coalesce(p_consent_whatsapp, false), true,
    'התקבלה הסכמה בעל פה',
    'verbal-2026-11-13', 'verbal-2026-11-13', now(), 'verbal', btrim(p_consent_by),
    'our_link', 'call', false, 'active'
  )
  returning id into v_id;

  return public.business_alert_screen_card(v_id);
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
      s.categories, s.subcategories, s.flags, s.regions, s.taxonomy_version,
      s.budget_min, s.budget_max, s.budget_open, s.region,
      s.consent_email, s.consent_whatsapp, s.consent_general, s.consent_text,
      s.consent_version, s.consent_text_version, s.consent_at, s.consent_method, s.consent_by,
      s.source, s.source_url,
      s.signup_channel, s.manual_source,
      s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term,
      s.looking_for,
      s.legacy_no_consent, s.status, s.unsubscribed_at, s.unsubscribed_by, s.unsubscribe_reason,
      s.email_unsubscribed_at, s.whatsapp_unsubscribed_at,
      s.resubscribed_at, s.status_history,
      s.do_not_call, s.do_not_call_at, s.manager_notes, s.handled_at, s.handled_by,
      s.crm_lead_id, s.created_at, s.updated_at,
      (select count(*) from public.business_alert_page_views v where v.subscriber_id = s.id) as view_count,
      (select count(*) from public.business_alert_sends d where d.subscriber_id = s.id) as send_count,
      (select max(d.sent_at) from public.business_alert_sends d where d.subscriber_id = s.id) as last_sent_at,
      (select count(*) from public.business_alert_interactions i where i.subscriber_id = s.id and i.deleted_at is null and i.kind = 'call') as call_count,
      (select count(*) from public.business_alert_interactions i where i.subscriber_id = s.id and i.deleted_at is null and i.kind = 'call' and i.outcome = 'answered') as answered_count,
      (select count(*) from public.business_alert_interactions i where i.subscriber_id = s.id and i.deleted_at is null and i.kind = 'call' and i.outcome = 'no_answer') as no_answer_count,
      (select max(i.at) from public.business_alert_interactions i where i.subscriber_id = s.id and i.deleted_at is null) as last_contact_at
    from public.business_alert_subscribers s
  ) x;
$$;

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
          s.categories, s.subcategories, s.flags, s.regions, s.taxonomy_version,
          s.budget_min, s.budget_max, s.budget_open, s.region, s.looking_for,
          s.consent_email, s.consent_whatsapp, s.consent_general, s.consent_text,
          s.consent_version, s.consent_text_version, s.consent_at, s.consent_method, s.consent_by,
          s.source, s.source_url,
          s.signup_channel, s.manual_source,
          s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term,
          s.legacy_no_consent, s.status, s.unsubscribed_at, s.unsubscribed_by, s.unsubscribe_reason,
          s.email_unsubscribed_at, s.whatsapp_unsubscribed_at,
          s.resubscribed_at, s.status_history,
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
    'interactions', public.business_alert_list_interactions(p_subscriber_id),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object('channel', a.channel, 'purpose', a.purpose, 'allowed', a.allowed, 'block_reason', a.block_reason, 'created_at', a.created_at) order by a.created_at desc)
      from public.business_alert_send_attempts a
      where a.subscriber_id = p_subscriber_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.business_alert_log_interaction(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.business_alert_list_interactions(uuid) from public, anon, authenticated;
revoke all on function public.business_alert_hide_interaction(uuid, text) from public, anon, authenticated;
revoke all on function public.business_alert_add_verbal(text, text, text, text, boolean, boolean, text[], text[], numeric, numeric, boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.business_alert_crm_list() from public, anon, authenticated;
revoke all on function public.business_alert_screen_card(uuid) from public, anon, authenticated;

grant execute on function public.business_alert_log_interaction(uuid, text, text, text, text, text) to service_role, business_alert_manager;
grant execute on function public.business_alert_list_interactions(uuid) to service_role, business_alert_manager;
grant execute on function public.business_alert_hide_interaction(uuid, text) to service_role, business_alert_manager;
grant execute on function public.business_alert_add_verbal(text, text, text, text, boolean, boolean, text[], text[], numeric, numeric, boolean, text, boolean) to service_role, business_alert_manager;
grant execute on function public.business_alert_crm_list() to service_role, business_alert_manager;
grant execute on function public.business_alert_screen_card(uuid) to service_role, business_alert_manager;

commit;
