-- Applied live 20.10.2026 via MCP (migration site_content_topic_suggestions_20261020). Additive only.
create table if not exists public.site_content_topic_suggestions(
  id uuid primary key default gen_random_uuid(), title text not null, angle text, keyword text, why text,
  batch_id uuid not null, round int, created_by uuid, created_at timestamptz not null default now(),
  used_article_id uuid references public.site_content(id) on delete set null);
create index if not exists site_content_topic_suggestions_batch_idx on public.site_content_topic_suggestions(batch_id);
create index if not exists site_content_topic_suggestions_created_idx on public.site_content_topic_suggestions(created_at desc);
alter table public.site_content_topic_suggestions enable row level security;
revoke all on public.site_content_topic_suggestions from anon, authenticated;
grant all on public.site_content_topic_suggestions to service_role;
create table if not exists public.site_content_studio_selftest(token text primary key, created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '2 hours');
alter table public.site_content_studio_selftest enable row level security;
revoke all on public.site_content_studio_selftest from anon, authenticated;
grant all on public.site_content_studio_selftest to service_role;
