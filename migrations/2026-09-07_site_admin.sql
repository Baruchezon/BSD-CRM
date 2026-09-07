-- BSD Site Admin and Analytics
-- מיגרציה שאינה משנה את טבלת businesses הקיימת.
-- היא מוסיפה רק מודולי תוכן ואנליטיקה לניהול האתר.

create table if not exists public.site_content (
  id uuid primary key default gen_random_uuid(),
  content_type text not null default 'article' check (content_type in ('article','page')),
  status text not null default 'draft' check (status in ('draft','published')),
  title text not null,
  slug text not null unique,
  excerpt text,
  body_html text,
  seo_title text,
  seo_description text,
  focus_keyword text,
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_content_status_idx on public.site_content(status);
create index if not exists site_content_type_idx on public.site_content(content_type);
create index if not exists site_content_updated_idx on public.site_content(updated_at desc);

alter table public.site_content enable row level security;

drop policy if exists site_content_admin_manager_all on public.site_content;
create policy site_content_admin_manager_all
on public.site_content
for all
to authenticated
using (public.is_admin_or_manager(auth.uid()))
with check (public.is_admin_or_manager(auth.uid()));

grant select, insert, update, delete on public.site_content to authenticated;

create or replace function public.touch_site_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_site_content_touch on public.site_content;
create trigger trg_site_content_touch
before update on public.site_content
for each row execute function public.touch_site_content_updated_at();

create or replace view public.public_site_content as
select id, content_type, title, slug, excerpt, body_html, seo_title, seo_description, focus_keyword, published_at, updated_at
from public.site_content
where status = 'published';

grant select on public.public_site_content to anon, authenticated;

create table if not exists public.site_analytics_events (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  session_id text not null,
  event_name text not null,
  page_path text,
  page_title text,
  referrer_host text,
  business_id uuid references public.businesses(id) on delete set null,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  device_type text check (device_type is null or device_type in ('desktop','mobile','tablet','other')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists site_analytics_created_idx on public.site_analytics_events(created_at desc);
create index if not exists site_analytics_session_idx on public.site_analytics_events(session_id);
create index if not exists site_analytics_visitor_idx on public.site_analytics_events(visitor_id);
create index if not exists site_analytics_event_idx on public.site_analytics_events(event_name);
create index if not exists site_analytics_page_idx on public.site_analytics_events(page_path);
create index if not exists site_analytics_business_idx on public.site_analytics_events(business_id);

alter table public.site_analytics_events enable row level security;

drop policy if exists site_analytics_public_insert on public.site_analytics_events;
create policy site_analytics_public_insert
on public.site_analytics_events
for insert
to anon, authenticated
with check (
  char_length(visitor_id) between 6 and 80
  and char_length(session_id) between 6 and 80
  and char_length(event_name) between 1 and 60
  and (page_path is null or char_length(page_path) <= 300)
  and (page_title is null or char_length(page_title) <= 200)
  and (referrer_host is null or char_length(referrer_host) <= 180)
  and octet_length(metadata::text) <= 4096
);

drop policy if exists site_analytics_admin_manager_select on public.site_analytics_events;
create policy site_analytics_admin_manager_select
on public.site_analytics_events
for select
to authenticated
using (public.is_admin_or_manager(auth.uid()));

grant insert on public.site_analytics_events to anon, authenticated;
grant select on public.site_analytics_events to authenticated;

comment on table public.site_analytics_events is
'BSD first party site analytics. Do not store names, phone numbers, email addresses, form contents, passwords or other personal data in metadata.';
