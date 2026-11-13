-- Stored alert matches. Scoring runs in the edge function, which reuses the
-- smart-match taxonomy. sending_enabled stays false until Baruch turns it on.
-- Rollback: supabase/migrations/rollback_20261113143000_business_alert_matches.sql

begin;

alter table public.business_alert_subscribers
  add column if not exists looking_for text;

comment on column public.business_alert_subscribers.looking_for is
  'Free text from the website form or a WhatsApp signup link: what they want, budget words, exclusions.';

create table if not exists public.business_alert_match_settings (
  id boolean primary key default true check (id),
  budget_low_ratio numeric not null default 0.70 check (budget_low_ratio > 0 and budget_low_ratio <= 1),
  budget_high_ratio numeric not null default 1.30 check (budget_high_ratio >= 1 and budget_high_ratio <= 3),
  min_score integer not null default 60 check (min_score between 1 and 100),
  sector_weight integer not null default 50 check (sector_weight between 1 and 80),
  budget_weight integer not null default 30 check (budget_weight between 1 and 80),
  location_weight integer not null default 20 check (location_weight between 1 and 80),
  sending_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.business_alert_match_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.business_alert_match_settings enable row level security;
revoke all on public.business_alert_match_settings from public, anon, authenticated;
grant select, update on public.business_alert_match_settings to service_role;

comment on table public.business_alert_match_settings is
  'Alert match bounds. sending_enabled is false until Baruch approves sending.';

create table if not exists public.business_alert_matches (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.business_alert_subscribers(id),
  business_id uuid not null references public.businesses(id),
  score integer not null,
  sector_points integer not null,
  budget_points integer not null,
  location_points integer not null,
  eligible boolean not null,
  sendable boolean not null,
  block_reason text,
  breakdown jsonb not null,
  public_card jsonb not null,
  computed_at timestamptz not null default now(),
  unique (subscriber_id, business_id)
);

create index if not exists business_alert_matches_business_idx
  on public.business_alert_matches (business_id, score desc);
create index if not exists business_alert_matches_subscriber_idx
  on public.business_alert_matches (subscriber_id, score desc);

alter table public.business_alert_matches enable row level security;
revoke all on public.business_alert_matches from public, anon, authenticated;
grant select, insert, update on public.business_alert_matches to service_role;

comment on table public.business_alert_matches is
  'Every scored subscriber/business pair, with the points breakdown. Rows are not deleted. sendable is false while sending_enabled is false or a gate blocks the pair.';

commit;
