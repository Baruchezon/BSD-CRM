-- Rollback for 20261113120000_business_alert_compliance.sql.
-- Restores the manager functions to the 20261112b bodies.
-- unsubscribe_token is converted back to uuid, so any 32-byte tokens are replaced.
-- Do not run this while a sender is in the middle of a mailing.

begin;

drop trigger if exists business_alert_sync_compliance on public.business_alert_subscribers;
drop function if exists public.business_alert_sync_compliance();
drop function if exists public.business_alert_crm_detail(uuid);
drop function if exists public.business_alert_crm_list();
drop function if exists public.business_alert_record_visit(text, text, text);
drop function if exists public.business_alert_set_handling(uuid, text, boolean, boolean);
drop function if exists public.business_alert_apply_status(uuid, text, text, boolean);
drop function if exists public.business_alert_apply_whatsapp_stop(text, text);
drop function if exists public.business_alert_unsubscribe_by_token(text, text, text);
drop function if exists public.business_alert_is_stop_text(text);
drop function if exists public.business_alert_gate_send(uuid, text, text, text, numeric);

drop table if exists public.business_alert_page_views;
drop table if exists public.business_alert_send_attempts;

delete from public.business_alert_signup_attempts where kind in ('visit', 'send');
alter table public.business_alert_signup_attempts
  drop constraint if exists business_alert_signup_attempts_kind_check;
alter table public.business_alert_signup_attempts
  add constraint business_alert_signup_attempts_kind_check
  check (kind = any (array['signup'::text, 'unsubscribe'::text]));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_status_check,
  drop constraint if exists business_alert_subscribers_unsubscribed_at_check,
  drop constraint if exists business_alert_subscribers_unsubscribed_by_check,
  drop constraint if exists business_alert_subscribers_active_consent_check,
  drop constraint if exists business_alert_subscribers_unsubscribe_token_len_check,
  drop constraint if exists business_alert_subscribers_crm_lead_id_fkey;

alter table public.business_alert_subscribers
  drop column if exists consent_general,
  drop column if exists consent_text,
  drop column if exists consent_version,
  drop column if exists source_url,
  drop column if exists legacy_no_consent,
  drop column if exists email_unsubscribed_at,
  drop column if exists whatsapp_unsubscribed_at,
  drop column if exists do_not_call,
  drop column if exists do_not_call_at,
  drop column if exists manager_notes,
  drop column if exists handled_at,
  drop column if exists handled_by,
  drop column if exists crm_lead_id,
  drop column if exists visit_token;

update public.business_alert_subscribers
set status = 'unsubscribed',
    unsubscribed_at = coalesce(unsubscribed_at, now()),
    unsubscribed_by = case
      when unsubscribed_by in ('self_link', 'manager', 'admin') then unsubscribed_by
      else 'self_link'
    end
where status in ('unsubscribed_email', 'unsubscribed_whatsapp', 'unsubscribed_all');

update public.business_alert_subscribers
set consent_email = true
where status = 'active' and consent_email is not true;

alter table public.business_alert_subscribers
  alter column unsubscribe_token drop default;
alter table public.business_alert_subscribers
  alter column unsubscribe_token type uuid using gen_random_uuid();
alter table public.business_alert_subscribers
  alter column unsubscribe_token set default gen_random_uuid();

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_status_check
    check (status = any (array['active'::text, 'unsubscribed'::text])),
  add constraint business_alert_subscribers_active_consent_check
    check (status <> 'active' or consent_email is true),
  add constraint business_alert_subscribers_unsubscribed_at_check
    check (
      (status = 'active' and unsubscribed_at is null)
      or (status = 'unsubscribed' and unsubscribed_at is not null)
    ),
  add constraint business_alert_subscribers_unsubscribed_by_check
    check (
      (status = 'active' and unsubscribed_by is null)
      or (status = 'unsubscribed' and unsubscribed_by = any (array['self_link'::text, 'manager'::text, 'admin'::text]))
    );

create or replace function public.business_alert_active_email_subscribers()
returns table(
  id uuid, first_name text, last_name text, email text, phone text, phone9 text,
  interests text[], budget_min numeric, budget_max numeric, budget_open boolean,
  region text, consent_whatsapp boolean, source text, created_at timestamptz,
  sent_business_numbers text[]
)
language sql stable security definer set search_path to 'pg_catalog', 'public'
as $$
  select s.id, s.first_name, s.last_name, s.email, s.phone, s.phone9, s.interests,
    s.budget_min, s.budget_max, s.budget_open, s.region, s.consent_whatsapp, s.source, s.created_at,
    coalesce((
      select array_agg(d.business_number order by d.sent_at, d.business_number)
      from public.business_alert_sends d where d.subscriber_id = s.id
    ), '{}'::text[])
  from public.business_alert_subscribers s
  where s.status = 'active' and s.consent_email is true;
$$;

create or replace function public.business_alert_log_send(
  p_subscriber_id uuid, p_business_number text, p_match_pct numeric, p_channel text default 'email'
)
returns boolean
language plpgsql security definer set search_path to 'pg_catalog', 'public'
as $$
declare
  v_status text; v_email boolean; v_whatsapp boolean; v_id uuid;
  v_business text := btrim(coalesce(p_business_number, ''));
  v_channel text := coalesce(p_channel, '');
begin
  if p_subscriber_id is null or v_business = '' then
    raise exception 'subscriber and business number are required' using errcode = '22023';
  end if;
  if p_match_pct is null or p_match_pct < 0 or p_match_pct > 100 then
    raise exception 'match_pct must be between 0 and 100' using errcode = '22023';
  end if;
  if v_channel <> 'email' and v_channel <> 'whatsapp' then
    raise exception 'channel must be email or whatsapp' using errcode = '22023';
  end if;
  select subscribers.status, subscribers.consent_email, subscribers.consent_whatsapp
    into v_status, v_email, v_whatsapp
  from public.business_alert_subscribers as subscribers
  where subscribers.id = p_subscriber_id;
  if not found then raise exception 'subscriber not found' using errcode = 'P0002'; end if;
  if v_status is distinct from 'active' then raise exception 'subscriber is not active' using errcode = '42501'; end if;
  if v_channel = 'email' and v_email is not true then raise exception 'subscriber has no email consent' using errcode = '42501'; end if;
  if v_channel = 'whatsapp' and v_whatsapp is not true then raise exception 'subscriber has no whatsapp consent' using errcode = '42501'; end if;
  insert into public.business_alert_sends (subscriber_id, business_number, match_pct, channel, created_by)
  values (p_subscriber_id, v_business, p_match_pct, v_channel, session_user)
  on conflict (subscriber_id, business_number) do nothing
  returning business_alert_sends.id into v_id;
  return v_id is not null;
end;
$$;

create or replace function public.business_alert_set_status(
  p_subscriber_id uuid, p_status text, p_reason text default null
)
returns table(id uuid, status text, unsubscribed_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path to 'pg_catalog', 'public'
as $$
declare v_consent boolean;
begin
  if p_status is distinct from 'active' and p_status is distinct from 'unsubscribed' then
    raise exception 'status must be active or unsubscribed' using errcode = '22023';
  end if;
  select subscribers.consent_email into v_consent
  from public.business_alert_subscribers as subscribers
  where subscribers.id = p_subscriber_id for update;
  if not found then raise exception 'subscriber not found' using errcode = 'P0002'; end if;
  if p_status = 'active' and v_consent is not true then
    raise exception 'reactivation requires email consent' using errcode = '42501';
  end if;
  return query
  update public.business_alert_subscribers as subscribers
  set status = p_status,
      unsubscribed_at = case when p_status = 'unsubscribed' then now() else null end,
      unsubscribed_by = case when p_status = 'unsubscribed' then 'manager' else null end,
      unsubscribe_reason = case when p_status = 'unsubscribed' then nullif(btrim(coalesce(p_reason, '')), '') else null end,
      updated_at = now()
  where subscribers.id = p_subscriber_id
  returning subscribers.id, subscribers.status, subscribers.unsubscribed_at, subscribers.updated_at;
end;
$$;

revoke all on function public.business_alert_log_send(uuid, text, numeric, text) from public, anon, authenticated, service_role;
revoke all on function public.business_alert_active_email_subscribers() from public, anon, authenticated, service_role;
revoke all on function public.business_alert_set_status(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.business_alert_log_send(uuid, text, numeric, text) to business_alert_manager;
grant execute on function public.business_alert_active_email_subscribers() to business_alert_manager;
grant execute on function public.business_alert_set_status(uuid, text, text) to business_alert_manager;

drop function if exists public.business_alert_new_token();

commit;
