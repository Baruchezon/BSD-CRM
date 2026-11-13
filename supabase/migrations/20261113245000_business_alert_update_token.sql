-- Duplicate signup returns a short-lived update token instead of rewriting the row.
-- Apply after 20261113240000. Do not edit the earlier alert migrations.
-- Rollback: supabase/migrations/rollback_20261113245000_business_alert_update_token.sql

begin;

create table if not exists public.business_alert_update_nonces (
  nonce text primary key,
  subscriber_id uuid not null references public.business_alert_subscribers (id),
  email_matched boolean not null default false,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists business_alert_update_nonces_subscriber_idx
  on public.business_alert_update_nonces (subscriber_id, created_at desc);

alter table public.business_alert_update_nonces enable row level security;
revoke all on public.business_alert_update_nonces from public, anon, authenticated;
grant select, insert, update on public.business_alert_update_nonces to service_role;

create table if not exists public.business_alert_subscriber_history (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.business_alert_subscribers (id),
  at timestamptz not null default now(),
  action text not null,
  actor text not null default 'self_update',
  previous jsonb not null default '{}'::jsonb,
  next jsonb not null default '{}'::jsonb,
  constraint business_alert_subscriber_history_action_check
    check (action in ('update', 'confirm', 'reactivate'))
);

alter table public.business_alert_subscriber_history enable row level security;
revoke all on public.business_alert_subscriber_history from public, anon, authenticated;
grant select, insert on public.business_alert_subscriber_history to service_role;

alter table public.business_alert_signup_attempts
  add column if not exists subscriber_id uuid;

alter table public.business_alert_signup_attempts
  drop constraint if exists business_alert_signup_attempts_kind_check;
alter table public.business_alert_signup_attempts
  add constraint business_alert_signup_attempts_kind_check
  check (kind = any (array['signup', 'unsubscribe', 'visit', 'send', 'update']));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_consent_method_check;
alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_consent_method_check
  check (consent_method is null or consent_method in ('form', 'verbal_call', 'whatsapp_reply', 'written', 'self_update'));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_email_method_check;
alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_email_method_check
  check (consent_email_method is null or consent_email_method in ('verbal_call', 'whatsapp_reply', 'written', 'form', 'self_update'));

alter table public.business_alert_subscribers
  drop constraint if exists business_alert_subscribers_whatsapp_method_check;
alter table public.business_alert_subscribers
  add constraint business_alert_subscribers_whatsapp_method_check
  check (consent_whatsapp_method is null or consent_whatsapp_method in ('verbal_call', 'whatsapp_reply', 'written', 'form', 'self_update'));

commit;
