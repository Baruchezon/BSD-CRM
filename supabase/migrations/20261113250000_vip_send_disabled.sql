-- Stage E stays off. vip_send_enabled defaults to false.
-- Recipients are the CRM buyers list: leads.type = buyer, not archived,
-- with an email. agreement_status is returned so the preview can show it.
-- It does not decide who is included. agreement_send_events is not the source.
-- Rollback: supabase/migrations/rollback_20261113250000_vip_send_disabled.sql

begin;

alter table public.business_alert_match_settings
  add column if not exists vip_send_enabled boolean not null default false,
  add column if not exists vip_send_allowlist uuid[] not null default '{}';

comment on column public.business_alert_match_settings.vip_send_enabled is
  'Send a VIP business to VIP clients. False until Baruch turns it on. sending_enabled is a different switch.';

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
              s.do_not_call is true
              or s.status in ('unsubscribed', 'unsubscribed_all', 'unsubscribed_email')
              or s.email_unsubscribed_at is not null
            )
        )
    ) x
  );
end;
$$;

revoke all on function public.business_alert_vip_recipients() from public, anon, authenticated;
grant execute on function public.business_alert_vip_recipients() to service_role, business_alert_manager;

create table if not exists public.business_alert_vip_sends (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  lead_id uuid not null,
  sent_at timestamptz not null default now(),
  sent_by text,
  constraint business_alert_vip_sends_pair unique (business_id, lead_id)
);

comment on table public.business_alert_vip_sends is
  'One row per business sent to a buyer. A repeat is refused unless the caller asks to send again. Rows are not deleted.';

alter table public.business_alert_vip_sends enable row level security;
revoke all on public.business_alert_vip_sends from public, anon, authenticated;
grant select, insert, update on public.business_alert_vip_sends to service_role;

commit;
