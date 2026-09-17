-- BSD VIP Clients
-- Preview branch only. Do not apply to production before full QA.
-- Security model: VIP tables have RLS enabled and NO direct anon/authenticated policies.
-- Access is performed only through the vip-api Edge Function using service role after
-- custom VIP-session validation or CRM admin/manager validation.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.vip_accounts (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null unique references public.leads(id) on delete restrict,
  username text not null unique,
  password_hash text not null,
  status text not null default 'active' check (status in ('active','blocked','deleted')),
  must_change_password boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  login_count integer not null default 0,
  blocked_at timestamptz,
  blocked_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null
);

create index if not exists vip_accounts_status_idx on public.vip_accounts(status);
create index if not exists vip_accounts_buyer_idx on public.vip_accounts(buyer_id);

create table if not exists public.vip_sessions (
  id uuid primary key default gen_random_uuid(),
  vip_account_id uuid not null references public.vip_accounts(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip_hint text,
  active_seconds integer not null default 0 check (active_seconds between 0 and 86400)
);

create index if not exists vip_sessions_account_idx on public.vip_sessions(vip_account_id);
create index if not exists vip_sessions_expiry_idx on public.vip_sessions(expires_at);

create table if not exists public.vip_login_attempts (
  id bigserial primary key,
  username text not null,
  ip_hash text not null,
  success boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists vip_login_attempts_guard_idx
  on public.vip_login_attempts(username, ip_hash, attempted_at desc);

create index if not exists vip_login_attempts_cleanup_idx
  on public.vip_login_attempts(attempted_at);

create table if not exists public.vip_business_publications (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default false,
  anonymous_file_id uuid references public.business_sale_files(id) on delete set null,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint vip_publication_requires_file check (not enabled or anonymous_file_id is not null)
);

create table if not exists public.vip_interests (
  vip_account_id uuid not null references public.vip_accounts(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  interested boolean not null default true,
  first_marked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (vip_account_id, business_id)
);

create index if not exists vip_interests_business_idx on public.vip_interests(business_id);

create table if not exists public.vip_inquiries (
  id uuid primary key default gen_random_uuid(),
  vip_account_id uuid not null references public.vip_accounts(id) on delete cascade,
  buyer_id uuid not null references public.leads(id) on delete restrict,
  business_id uuid references public.businesses(id) on delete set null,
  name_snapshot text not null,
  phone_snapshot text not null,
  message text,
  source text not null default 'BSD VIP',
  status text not null default 'new' check (status in ('new','handled','closed')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null
);

create index if not exists vip_inquiries_created_idx on public.vip_inquiries(created_at desc);
create index if not exists vip_inquiries_buyer_idx on public.vip_inquiries(buyer_id);
create index if not exists vip_inquiries_business_idx on public.vip_inquiries(business_id);

create table if not exists public.vip_activity_events (
  id uuid primary key default gen_random_uuid(),
  vip_account_id uuid not null references public.vip_accounts(id) on delete cascade,
  session_id uuid references public.vip_sessions(id) on delete set null,
  event_type text not null,
  business_id uuid references public.businesses(id) on delete set null,
  file_id uuid references public.business_sale_files(id) on delete set null,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vip_activity_account_created_idx on public.vip_activity_events(vip_account_id, created_at desc);
create index if not exists vip_activity_business_idx on public.vip_activity_events(business_id);
create index if not exists vip_activity_type_idx on public.vip_activity_events(event_type);

create table if not exists public.vip_admin_audit (
  id uuid primary key default gen_random_uuid(),
  vip_account_id uuid references public.vip_accounts(id) on delete set null,
  buyer_id uuid references public.leads(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  action text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vip_admin_audit_created_idx on public.vip_admin_audit(created_at desc);

-- Prevent an internal/confidential sale file from ever being selected for VIP.
create or replace function public.vip_validate_anonymous_file()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.business_sale_files%rowtype;
begin
  if new.anonymous_file_id is null then
    if new.enabled then
      raise exception 'VIP publication requires an approved anonymous file';
    end if;
    return new;
  end if;

  select * into f
  from public.business_sale_files
  where id = new.anonymous_file_id;

  if not found then
    raise exception 'Anonymous file not found';
  end if;

  if f.business_id <> new.business_id then
    raise exception 'Anonymous file belongs to a different business';
  end if;

  if f.status <> 'active' then
    raise exception 'Anonymous file is not active';
  end if;

  if f.confidentiality_level <> 1 then
    raise exception 'Only confidentiality level 1 files may be published to VIP';
  end if;

  if coalesce(f.document_type, '') <> 'anonymous_summary' then
    raise exception 'Only document_type anonymous_summary may be published to VIP';
  end if;

  return new;
end;
$$;

revoke all on function public.vip_validate_anonymous_file() from public;

drop trigger if exists trg_vip_validate_anonymous_file on public.vip_business_publications;
create trigger trg_vip_validate_anonymous_file
before insert or update on public.vip_business_publications
for each row execute function public.vip_validate_anonymous_file();

create or replace function public.vip_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_vip_accounts_touch on public.vip_accounts;
create trigger trg_vip_accounts_touch before update on public.vip_accounts
for each row execute function public.vip_touch_updated_at();

drop trigger if exists trg_vip_publications_touch on public.vip_business_publications;
create trigger trg_vip_publications_touch before update on public.vip_business_publications
for each row execute function public.vip_touch_updated_at();

drop trigger if exists trg_vip_interests_touch on public.vip_interests;
create trigger trg_vip_interests_touch before update on public.vip_interests
for each row execute function public.vip_touch_updated_at();

-- Harden direct database access. The Edge Function uses service role and bypasses RLS.
alter table public.vip_accounts enable row level security;
alter table public.vip_sessions enable row level security;
alter table public.vip_login_attempts enable row level security;
alter table public.vip_business_publications enable row level security;
alter table public.vip_interests enable row level security;
alter table public.vip_inquiries enable row level security;
alter table public.vip_activity_events enable row level security;
alter table public.vip_admin_audit enable row level security;

revoke all on public.vip_accounts from anon, authenticated;
revoke all on public.vip_sessions from anon, authenticated;
revoke all on public.vip_login_attempts from anon, authenticated;
revoke all on public.vip_business_publications from anon, authenticated;
revoke all on public.vip_interests from anon, authenticated;
revoke all on public.vip_inquiries from anon, authenticated;
revoke all on public.vip_activity_events from anon, authenticated;
revoke all on public.vip_admin_audit from anon, authenticated;

comment on table public.vip_accounts is 'BSD VIP buyer accounts. Password hashes only; plaintext passwords are never stored.';
comment on table public.vip_login_attempts is 'Rate-limit audit for VIP login. Stores username plus one-way hash of network address, never the raw address.';
comment on table public.vip_business_publications is 'Explicit allow-list of businesses published to VIP. File must be active anonymous_summary with confidentiality_level=1.';
comment on table public.vip_activity_events is 'Business-significant VIP events only. Never store passwords or confidential business data in metadata.';
