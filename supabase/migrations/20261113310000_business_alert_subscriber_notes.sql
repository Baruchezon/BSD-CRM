-- Optional free-text notes from the bottom of the signup form (Baruch, 13.11.2026).
-- Nullable, at most 500 characters. The CRM roster returns it.
-- Rollback: supabase/migrations/rollback_20261113310000_business_alert_subscriber_notes.sql

begin;

alter table public.business_alert_subscribers
  add column if not exists notes text;

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_notes_length;

alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_notes_length
  check (notes is null or char_length(notes) <= 500);

comment on column public.business_alert_subscribers.notes is
  'Free-text notes the subscriber typed at the bottom of the form. Plain text, max 500 characters.';

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
      s.test_note,
      s.notes
    from public.business_alert_subscribers s
  ) x;
$function$;

commit;
