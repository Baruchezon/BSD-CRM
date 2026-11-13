-- Read-only roster for the CRM, plus a test flag and an identity audit.
-- Does not open the subscriber table. Rollback:
-- supabase/migrations/rollback_20261113230000_business_alert_roster.sql

begin;

alter table public.business_alert_subscribers
  add column if not exists is_test boolean not null default false;

alter table public.business_alert_subscribers
  add column if not exists test_note text;

comment on column public.business_alert_subscribers.is_test is
  'True for a trial signup. Shown in the roster with a בדיקה badge, and kept out of sending and matching.';

update public.business_alert_subscribers
set is_test = true,
    test_note = 'בדיקה של ברוך/אדם 13.11'
where id = 'b6272485-0059-4c42-99f7-97650275bf8b';

create table if not exists public.business_alert_identity_audit (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.business_alert_subscribers (id),
  previous jsonb not null,
  incoming jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.business_alert_identity_audit is
  'A later signup on the same phone or email. The stored name and email stay. This row keeps both values.';

alter table public.business_alert_identity_audit enable row level security;

revoke all on table public.business_alert_identity_audit from public, anon, authenticated, service_role;
grant select, insert on table public.business_alert_identity_audit to service_role;

create or replace function public.business_alert_roster()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select
      s.id,
      s.first_name,
      s.last_name,
      s.phone,
      s.email,
      s.created_at,
      s.signup_channel,
      s.source,
      s.manual_source,
      s.status,
      s.consent_email,
      s.consent_whatsapp,
      s.categories,
      s.subcategories,
      s.regions,
      s.region,
      s.budget_min,
      s.budget_max,
      s.budget_open,
      s.looking_for,
      s.is_test,
      s.test_note
    from public.business_alert_subscribers s
  ) x;
$$;

comment on function public.business_alert_roster() is
  'Read-only list for CRM admin and manager. The edge function checks the profile, then calls this. No anon access.';

revoke all on function public.business_alert_roster() from public, anon, authenticated;
grant execute on function public.business_alert_roster() to service_role, business_alert_manager;

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

  if v_row.is_test is true then
    v_reason := 'is_test';
  elsif v_row.status = 'pending_consent' then
    v_reason := 'pending_consent';
  elsif v_row.legacy_no_consent is true then
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

commit;
