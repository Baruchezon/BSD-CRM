-- Seller portal v2 (04.10.2026, approved by the owner). Additive only.
-- 1. Extra files that BSD uploads to one business portal (images, Office files, ...).
--    Storage path is always "{business_id}/seller-portal-extra/{id}.{ext}" in the
--    private business-files bucket. Access only through seller-portal-api
--    (service_role); no grants to anon/authenticated.
-- 2. Download/view tracking for those files (seller_portal_events.extra_file_id).
-- No existing row is modified. Rollback: docs/seller-portal-v2-rollback.sql.
begin;
create table public.seller_portal_files (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 storage_path text not null unique,
 file_name text not null check (char_length(file_name) between 1 and 200),
 mime_type text not null,
 size_bytes bigint check (size_bytes is null or size_bytes between 0 and 20971520),
 status text not null default 'pending' check (status in ('pending','active','deleted')),
 uploaded_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 deleted_at timestamptz
);
create index seller_portal_files_business on public.seller_portal_files(business_id, status);
alter table public.seller_portal_files enable row level security;
revoke all on public.seller_portal_files from public, anon, authenticated;
grant all on public.seller_portal_files to service_role;
alter table public.seller_portal_events add column extra_file_id uuid references public.seller_portal_files(id) on delete set null;
create index seller_portal_events_type_time on public.seller_portal_events(event_type, created_at);
commit;
