-- Adding a person is not consent. A manual row is pending_consent until a
-- channel is explicitly checked, with its own method and optional note.
-- pending_consent is excluded from sends. Rollback:
-- supabase/migrations/rollback_20261113210000_business_alert_pending_consent.sql

begin;

alter table public.business_alert_subscribers
  add column if not exists consent_email_method text,
  add column if not exists consent_whatsapp_method text,
  add column if not exists consent_email_note text,
  add column if not exists consent_whatsapp_note text;

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_consent_method_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_consent_method_check
  check (consent_method is null or consent_method in ('form', 'verbal_call', 'whatsapp_reply', 'written'));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_email_method_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_email_method_check
  check (consent_email_method is null or consent_email_method in ('verbal_call', 'whatsapp_reply', 'written', 'form'));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_whatsapp_method_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_whatsapp_method_check
  check (consent_whatsapp_method is null or consent_whatsapp_method in ('verbal_call', 'whatsapp_reply', 'written', 'form'));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_status_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_status_check
  check (status = any (array['active','pending_consent','unsubscribed','unsubscribed_email','unsubscribed_whatsapp','unsubscribed_all']));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_unsubscribed_at_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_unsubscribed_at_check
  check (
    (status in ('active', 'pending_consent') and unsubscribed_at is null and email_unsubscribed_at is null and whatsapp_unsubscribed_at is null)
    or (status = 'unsubscribed_email' and unsubscribed_at is not null and email_unsubscribed_at is not null and whatsapp_unsubscribed_at is null)
    or (status = 'unsubscribed_whatsapp' and unsubscribed_at is not null and whatsapp_unsubscribed_at is not null and email_unsubscribed_at is null)
    or (status in ('unsubscribed', 'unsubscribed_all') and unsubscribed_at is not null and email_unsubscribed_at is not null and whatsapp_unsubscribed_at is not null)
  );

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_unsubscribed_by_check;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_unsubscribed_by_check
  check (
    (status in ('active', 'pending_consent') and unsubscribed_by is null)
    or (status not in ('active', 'pending_consent') and unsubscribed_by = any (array['self_link','manager','admin','whatsapp_stop']))
  );

comment on column public.business_alert_subscribers.consent_email_method is
  'How email consent was given: verbal_call, whatsapp_reply, written, or form. Null when email was not consented.';
comment on column public.business_alert_subscribers.consent_whatsapp_method is
  'How WhatsApp consent was given. Null when WhatsApp was not consented.';

create or replace function public.business_alert_add_manual(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_consent_email boolean,
  p_consent_whatsapp boolean,
  p_email_method text,
  p_whatsapp_method text,
  p_email_note text,
  p_whatsapp_note text,
  p_categories text[],
  p_regions text[],
  p_budget_min numeric,
  p_budget_max numeric,
  p_budget_open boolean,
  p_consent_by text
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
  v_email_on boolean := coalesce(p_consent_email, false);
  v_whatsapp_on boolean := coalesce(p_consent_whatsapp, false);
  v_email_method text := nullif(btrim(coalesce(p_email_method, '')), '');
  v_whatsapp_method text := nullif(btrim(coalesce(p_whatsapp_method, '')), '');
  v_any boolean;
begin
  if v_first = '' or v_phone = '' then
    raise exception 'missing_required_fields' using errcode = '22023';
  end if;
  if v_email_on and v_email_method not in ('verbal_call', 'whatsapp_reply', 'written', 'form') then
    raise exception 'consent_method' using errcode = '22023';
  end if;
  if v_whatsapp_on and v_whatsapp_method not in ('verbal_call', 'whatsapp_reply', 'written', 'form') then
    raise exception 'consent_method' using errcode = '22023';
  end if;
  if not v_email_on then
    v_email_method := null;
  end if;
  if not v_whatsapp_on then
    v_whatsapp_method := null;
  end if;
  v_any := v_email_on or v_whatsapp_on;
  if v_email is not null and exists (select 1 from public.business_alert_subscribers s where lower(s.email) = v_email) then
    raise exception 'email_exists' using errcode = '23505';
  end if;

  insert into public.business_alert_subscribers (
    first_name, last_name, phone, phone9, email,
    interests, categories, regions,
    budget_min, budget_max, budget_open, region,
    consent_email, consent_whatsapp, consent_general,
    consent_email_method, consent_whatsapp_method, consent_email_note, consent_whatsapp_note,
    consent_text, consent_at, consent_by,
    signup_channel, manual_source, legacy_no_consent, status
  ) values (
    v_first, coalesce(v_last, '—'), v_phone,
    right(regexp_replace(v_phone, '\D', '', 'g'), 9),
    v_email,
    array['אחר'], coalesce(p_categories, '{}'), coalesce(p_regions, '{}'),
    p_budget_min, p_budget_max, coalesce(p_budget_open, false), 'כל הארץ',
    v_email_on, v_whatsapp_on, case when v_any then true else null end,
    v_email_method, v_whatsapp_method,
    case when v_email_on then nullif(btrim(coalesce(p_email_note, '')), '') else null end,
    case when v_whatsapp_on then nullif(btrim(coalesce(p_whatsapp_note, '')), '') else null end,
    null,
    case when v_any then now() else null end,
    case when v_any then nullif(btrim(coalesce(p_consent_by, '')), '') else null end,
    'our_link', 'call', not v_any,
    case when v_any then 'active' else 'pending_consent' end
  )
  returning id into v_id;

  return public.business_alert_screen_card(v_id);
end;
$$;

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

  if v_row.status = 'pending_consent' then
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

revoke all on function public.business_alert_add_manual(text, text, text, text, boolean, boolean, text, text, text, text, text[], text[], numeric, numeric, boolean, text) from public, anon, authenticated;
grant execute on function public.business_alert_add_manual(text, text, text, text, boolean, boolean, text, text, text, text, text[], text[], numeric, numeric, boolean, text) to service_role, business_alert_manager;

commit;
