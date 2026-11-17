-- BSD CRM: Agent digital business cards
-- Isolated addition. Apply only after testing this migration on staging.
-- Private card rows are never exposed to anonymous users.
create table if not exists public.agent_digital_cards (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  public_token uuid not null unique default gen_random_uuid(),
  full_name text not null,
  job_title text not null default '',
  company_name text not null default 'BSD Business Brokers Israel',
  phone_mobile text not null default '',
  phone_office text not null default '',
  whatsapp_number text not null default '',
  email text not null default '',
  website_url text not null default '',
  facebook_url text not null default '',
  instagram_url text not null default '',
  photo_url text not null default '',
  logo_url text not null default '',
  description text not null default '',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_card_name_length check (char_length(full_name) between 2 and 120),
  constraint agent_card_field_lengths check (
    char_length(job_title)<=120 and char_length(company_name)<=180 and
    char_length(phone_mobile)<=35 and char_length(phone_office)<=35 and
    char_length(whatsapp_number)<=35 and char_length(email)<=200 and
    char_length(website_url)<=500 and char_length(facebook_url)<=500 and
    char_length(instagram_url)<=500 and char_length(photo_url)<=800 and
    char_length(logo_url)<=800 and char_length(description)<=500)
);
create index if not exists idx_agent_cards_owner on public.agent_digital_cards(owner_user_id);
create index if not exists idx_agent_cards_live on public.agent_digital_cards(public_token) where is_published;
alter table public.agent_digital_cards enable row level security;
revoke all on table public.agent_digital_cards from public, anon, authenticated;
grant select, insert, delete on table public.agent_digital_cards to authenticated;
-- Prevent changes to immutable ownership and unguessable public token.
grant update (
  full_name, job_title, company_name, phone_mobile, phone_office,
  whatsapp_number, email, website_url, facebook_url, instagram_url,
  photo_url, logo_url, description, is_published, updated_at
) on table public.agent_digital_cards to authenticated;

create policy agent_cards_read on public.agent_digital_cards for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.status::text='active'
    and p.role::text in ('admin','manager','agent','agent_authorized')
    and (owner_user_id=(select auth.uid()) or p.role::text='admin'))
);
create policy agent_cards_insert on public.agent_digital_cards for insert to authenticated
with check (
  exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.status::text='active'
    and p.role::text in ('admin','manager','agent','agent_authorized')
    and (owner_user_id=(select auth.uid()) or p.role::text='admin'))
);
create policy agent_cards_update on public.agent_digital_cards for update to authenticated
using (
  exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.status::text='active'
    and p.role::text in ('admin','manager','agent','agent_authorized')
    and (owner_user_id=(select auth.uid()) or p.role::text='admin'))
)
with check (
  exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.status::text='active'
    and p.role::text in ('admin','manager','agent','agent_authorized')
    and (owner_user_id=(select auth.uid()) or p.role::text='admin'))
);
create policy agent_cards_delete on public.agent_digital_cards for delete to authenticated
using (
  exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.status::text='active'
    and p.role::text in ('admin','manager','agent','agent_authorized')
    and (owner_user_id=(select auth.uid()) or p.role::text='admin'))
);

-- Public images only, never private CRM files.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('agent-card-assets','agent-card-assets',true,3145728,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy agent_card_images_add on storage.objects for insert to authenticated
with check (bucket_id='agent-card-assets' and
 (storage.foldername(name))[1]=(select auth.uid())::text and
 exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.status::text='active'
   and p.role::text in ('admin','manager','agent','agent_authorized')));
create policy agent_card_images_read_own on storage.objects for select to authenticated
using (bucket_id='agent-card-assets' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy agent_card_images_remove_own on storage.objects for delete to authenticated
using (bucket_id='agent-card-assets' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- The public card is ONLY exposed by the dedicated Edge Function, which
-- reads explicitly whitelisted fields after checking is_published=true.
-- Never grant SELECT on this table to anon, or embed service credentials in HTML.