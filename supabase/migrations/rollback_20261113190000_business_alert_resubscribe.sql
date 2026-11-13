-- Rollback for 20261113190000_business_alert_resubscribe.sql.
-- Restores the list and card functions from 20261113180000, then drops the audit columns.
-- Does not delete subscribers.

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

alter table public.business_alert_subscribers
  drop column if exists resubscribed_at,
  drop column if exists status_history;

commit;
