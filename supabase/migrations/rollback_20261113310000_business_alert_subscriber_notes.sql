-- Restores the roster without notes. Dropping the column deletes stored notes,
-- so export them first: select id, notes from public.business_alert_subscribers where notes is not null;
begin;

create or replace function public.business_alert_roster()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
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
$function$;

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_notes_length;

alter table public.business_alert_subscribers
  drop column if exists notes;

commit;
