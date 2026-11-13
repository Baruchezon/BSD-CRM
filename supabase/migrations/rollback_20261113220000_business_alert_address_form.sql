-- Rolls back 20261113220000_business_alert_address_form.sql.
-- Restores the readers and the manual add, then drops the column.
-- Subscriber rows stay.

begin;

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

drop function if exists public.business_alert_set_address_form(uuid, text);
drop function if exists public.business_alert_add_manual(text, text, text, text, boolean, boolean, text, text, text, text, text[], text[], numeric, numeric, boolean, text, text);

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
  if not v_email_on then v_email_method := null; end if;
  if not v_whatsapp_on then v_whatsapp_method := null; end if;
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

revoke all on function public.business_alert_add_manual(text, text, text, text, boolean, boolean, text, text, text, text, text[], text[], numeric, numeric, boolean, text) from public, anon, authenticated;
grant execute on function public.business_alert_add_manual(text, text, text, text, boolean, boolean, text, text, text, text, text[], text[], numeric, numeric, boolean, text) to service_role, business_alert_manager;

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_address_form_check;

alter table public.business_alert_subscribers
  drop column if exists address_form;

commit;
