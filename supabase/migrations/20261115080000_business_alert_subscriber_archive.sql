-- Archive and permanent delete for business-alert subscribers.
-- Additive. Archived rows stay in the table and are kept out of every send.
-- A purge keeps one row with no name, email, or phone.
-- Rollback: supabase/migrations/rollback_20261115080000_business_alert_subscriber_archive.sql

begin;

alter table public.business_alert_subscribers
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists archive_reason text,
  add column if not exists prev_status text;

comment on column public.business_alert_subscribers.archived_at is
  'When the subscriber was moved to the archive. Null means they still appear in the lists and can be sent to.';

create index if not exists business_alert_subscribers_archived_idx
  on public.business_alert_subscribers (archived_at desc)
  where archived_at is not null;

alter table public.business_alert_subscriber_history
  drop constraint if exists business_alert_subscriber_history_action_check;

alter table public.business_alert_subscriber_history
  add constraint business_alert_subscriber_history_action_check
  check (action in ('update', 'confirm', 'reactivate', 'unsubscribe', 'archive', 'restore'));

create table if not exists public.business_alert_subscriber_purges (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null,
  purged_at timestamptz not null default now(),
  purged_by text not null default 'baruch',
  had_email boolean not null default false,
  had_phone boolean not null default false,
  sends_count integer not null default 0
);

comment on table public.business_alert_subscriber_purges is
  'One row after a permanent delete. No name, email, or phone. subscriber_id is the old id only.';

alter table public.business_alert_subscriber_purges enable row level security;
revoke all on public.business_alert_subscriber_purges from public, anon, authenticated;
grant select, insert on public.business_alert_subscriber_purges to service_role;

grant delete on public.business_alert_send_attempts to service_role;
grant delete on public.business_alert_page_views to service_role;
grant delete on public.business_alert_sends to service_role;
grant delete on public.business_alert_matches to service_role;
grant delete on public.business_alert_interactions to service_role;
grant delete on public.business_alert_detail_requests to service_role;
grant delete on public.business_alert_short_links to service_role;
grant delete on public.business_alert_update_nonces to service_role;
grant delete on public.business_alert_subscriber_history to service_role;
grant delete on public.business_alert_identity_audit to service_role;
grant delete on public.business_alert_subscribers to service_role;

create or replace function public.business_alert_vip_recipients()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc nulls last), '[]'::jsonb)
    from (
      select l.id, l.first_name, l.last_name, l.phone, l.email, l.agreement_status, l.created_at
      from public.leads l
      where l.type::text = 'buyer'
        and l.is_archived is not true
        and position('@' in btrim(coalesce(l.email, ''))) > 1
        and not exists (
          select 1
          from public.business_alert_subscribers s
          where (
              (nullif(btrim(coalesce(l.email, '')), '') is not null and lower(l.email) = lower(s.email))
              or (
                nullif(right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9), '') is not null
                and s.phone9 = right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9)
              )
            )
            and (
              s.archived_at is not null
              or s.do_not_call is true
              or s.status in ('unsubscribed', 'unsubscribed_all', 'unsubscribed_email')
              or s.email_unsubscribed_at is not null
            )
        )
    ) x
  );
end;
$$;

commit;
