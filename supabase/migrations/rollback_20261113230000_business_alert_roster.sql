-- Rolls back 20261113230000_business_alert_roster.sql.
-- Drops the roster, the identity audit, and the test flag.
-- Restores the send gate so it no longer reads is_test. Subscriber rows stay.

begin;

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

  return query select v_allowed, v_reason, v_id;
end;
$$;

drop function if exists public.business_alert_roster();
drop table if exists public.business_alert_identity_audit;

alter table public.business_alert_subscribers
  drop column if exists test_note;

alter table public.business_alert_subscribers
  drop column if exists is_test;

commit;
