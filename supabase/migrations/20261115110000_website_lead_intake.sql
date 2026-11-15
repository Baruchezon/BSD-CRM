-- 15.11.2026 lead audit, stage 2 (approved by Baruch 15.11 08:28 via Roman).
-- Structured CRM intake for website-lead. Additive only.
-- Rollback: rollback_20261115110000_website_lead_intake.sql
alter table public.leads
  add column if not exists business_id uuid references public.businesses(id) on delete set null,
  add column if not exists source_page text,
  add column if not exists source_src text,
  add column if not exists website_inquiry_kind text;

alter table public.leads drop constraint if exists leads_website_inquiry_kind_chk;
alter table public.leads add constraint leads_website_inquiry_kind_chk check (
  website_inquiry_kind is null or website_inquiry_kind in
  ('seller','buyer','mixed','partner','training','question','other','unknown'));

create index if not exists leads_business_id_idx on public.leads (business_id) where business_id is not null;

comment on column public.leads.business_id is 'Business the website inquiry was about (from the form or matched by business number/name).';
comment on column public.leads.source_page is 'Website page the form was sent from (payload field «page»).';
comment on column public.leads.source_src is 'Website source tag (payload field «src», e.g. seller-journey, invite).';
comment on column public.leads.website_inquiry_kind is 'What the form purpose really was; question/other are not buyers even though leads.type must be set.';

-- One row per website form submission, including ones attached to an existing client.
create table if not exists public.website_lead_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid references public.leads(id) on delete set null,
  attached_existing boolean not null default false,
  is_test boolean not null default false,
  kind text,
  purposes text[],
  business_id uuid references public.businesses(id) on delete set null,
  business_number text,
  listing_title text,
  page text,
  src text,
  utm text,
  referrer text,
  language text,
  email_status text check (email_status is null or email_status in ('sent','failed','skipped_test')),
  email_at timestamptz,
  email_error text,
  email_id text
);
create index if not exists website_lead_submissions_lead_idx on public.website_lead_submissions (lead_id, created_at desc);
alter table public.website_lead_submissions enable row level security;
revoke all on public.website_lead_submissions from anon, authenticated;
grant select on public.website_lead_submissions to authenticated;
drop policy if exists website_lead_submissions_staff_read on public.website_lead_submissions;
create policy website_lead_submissions_staff_read on public.website_lead_submissions
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager')));

-- Same phone normalization as bsd_enforce_lead_dedupe (which service_role skips).
-- Test submissions only match is_test leads, real ones never match is_test leads.
create or replace function public.website_lead_find_by_phone9(p_phone9 text, p_is_test boolean default false)
returns table (id uuid, full_name text, client_number text, email text, notes text, type text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select l.id, coalesce(l.full_name, trim(coalesce(l.first_name,'')||' '||coalesce(l.last_name,''))),
         l.client_number, l.email, l.notes, l.type::text
  from public.leads l
  where l.is_archived = false
    and length(coalesce(p_phone9,'')) = 9
    and (right(regexp_replace(coalesce(l.phone,''),'\D','','g'),9) = p_phone9
      or right(regexp_replace(coalesce(l.phone2,''),'\D','','g'),9) = p_phone9)
    and ((coalesce(l.source,'') = 'is_test') = coalesce(p_is_test,false))
  order by (l.type = 'seller') asc, l.updated_at desc nulls last
  limit 1
$$;
revoke all on function public.website_lead_find_by_phone9(text, boolean) from public, anon, authenticated;
grant execute on function public.website_lead_find_by_phone9(text, boolean) to service_role;
