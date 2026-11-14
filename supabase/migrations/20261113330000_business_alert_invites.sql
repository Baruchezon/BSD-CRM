-- Personal invite from a lead or buyer card into the business-alert list.
-- Additive. The raw token is never stored. short_links_live is not changed.
-- Rollback: supabase/migrations/rollback_20261113330000_business_alert_invites.sql

begin;

alter table public.business_alert_subscribers
  add column if not exists lead_id uuid references public.leads (id) on delete set null,
  add column if not exists buyer_id uuid references public.leads (id) on delete set null;

comment on column public.business_alert_subscribers.lead_id is
  'Lead card this subscriber joined from. Null when they signed up on the website.';
comment on column public.business_alert_subscribers.buyer_id is
  'Buyer card this subscriber joined from. Buyers are rows in leads.';

create table if not exists public.business_alert_invites (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete cascade,
  buyer_id uuid references public.leads (id) on delete cascade,
  channel text not null,
  token_hash text not null unique,
  short_code text not null unique,
  prefill jsonb not null default '{}'::jsonb,
  status text not null default 'sent',
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  joined_at timestamptz,
  expires_at timestamptz not null,
  subscriber_id uuid references public.business_alert_subscribers (id) on delete set null,
  invited_by text not null default 'baruch',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint business_alert_invites_card_check check (lead_id is not null or buyer_id is not null),
  constraint business_alert_invites_channel_check check (channel in ('whatsapp', 'email')),
  constraint business_alert_invites_status_check check (status in ('sent', 'opened', 'joined', 'expired', 'superseded')),
  constraint business_alert_invites_code_check check (short_code ~ '^[A-Za-z0-9]{7}$')
);

create index if not exists business_alert_invites_lead_idx
  on public.business_alert_invites (lead_id, sent_at desc);
create index if not exists business_alert_invites_buyer_idx
  on public.business_alert_invites (buyer_id, sent_at desc);

alter table public.business_alert_invites enable row level security;
revoke all on public.business_alert_invites from public, anon, authenticated;
grant select, insert, update on public.business_alert_invites to service_role;

alter table public.business_alert_signup_attempts
  drop constraint if exists business_alert_signup_attempts_kind_check;
alter table public.business_alert_signup_attempts
  add constraint business_alert_signup_attempts_kind_check
  check (kind = any (array['signup', 'unsubscribe', 'visit', 'send', 'update', 'invite_resolve']));

comment on table public.business_alert_invites is
  'Staff invites from a lead or buyer card. token_hash is sha256 of the secret. No anon access.';

commit;
