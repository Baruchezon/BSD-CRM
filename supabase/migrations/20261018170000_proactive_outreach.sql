-- פניות יזומות (18.10.2026). Additive only: no drops, no updates of existing rows.
-- Staff (CRM) write the base tables under the same business-access rule as matches.
-- The seller portal never reads those tables. It reads the two views below, which
-- have no phone/email columns. Emergency app rollback is the git commit before this
-- change; leave these tables in place.
begin;

create table public.business_outreach (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  contact_name text not null check (char_length(btrim(contact_name)) between 1 and 160),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 160),
  company_notes text check (company_notes is null or char_length(company_notes) <= 4000),
  channel text not null check (channel in ('טלפון','וואטסאפ','מייל','לינקדאין','אחר')),
  reason text check (reason is null or char_length(reason) <= 4000),
  status text not null default 'פנינו' check (status in (
    'פנינו','לא ענה','יחזור','ממתינים לתשובה','ביקש חומר','נשלח חומר','שאלות',
    'נקבעה פגישה','מעוניין — העבר לקונה','לא מעוניין'
  )),
  next_step text check (next_step is null or char_length(next_step) <= 500),
  next_step_at date,
  hidden_from_owner boolean not null default false,
  converted_lead_id uuid references public.leads(id) on delete set null,
  converted_match_id uuid references public.matches(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_outreach_business_time on public.business_outreach (business_id, updated_at desc);

create table public.business_outreach_events (
  id uuid primary key default gen_random_uuid(),
  outreach_id uuid not null references public.business_outreach(id) on delete cascade,
  occurred_on date not null default (timezone('Asia/Jerusalem', now()))::date,
  stage text not null check (stage in (
    'פנינו','לא ענה','יחזור','ממתינים לתשובה','ביקש חומר','נשלח חומר','שאלות',
    'נקבעה פגישה','מעוניין — העבר לקונה','לא מעוניין'
  )),
  note text check (note is null or char_length(note) <= 4000),
  visible_to_owner boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index business_outreach_events_outreach_time on public.business_outreach_events (outreach_id, occurred_on desc, created_at desc);

create or replace function public.business_outreach_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists business_outreach_touch on public.business_outreach;
create trigger business_outreach_touch
  before update on public.business_outreach
  for each row execute function public.business_outreach_touch();

revoke all on function public.business_outreach_touch() from public, anon, authenticated;

alter table public.business_outreach enable row level security;
alter table public.business_outreach_events enable row level security;

drop policy if exists business_outreach_staff_select on public.business_outreach;
create policy business_outreach_staff_select on public.business_outreach
  for select to authenticated
  using (public.has_full_business_access(business_id, auth.uid()));

drop policy if exists business_outreach_staff_insert on public.business_outreach;
create policy business_outreach_staff_insert on public.business_outreach
  for insert to authenticated
  with check (public.has_full_business_access(business_id, auth.uid()));

drop policy if exists business_outreach_staff_update on public.business_outreach;
create policy business_outreach_staff_update on public.business_outreach
  for update to authenticated
  using (public.has_full_business_access(business_id, auth.uid()))
  with check (public.has_full_business_access(business_id, auth.uid()));

drop policy if exists business_outreach_events_staff_select on public.business_outreach_events;
create policy business_outreach_events_staff_select on public.business_outreach_events
  for select to authenticated
  using (
    exists (
      select 1 from public.business_outreach o
      where o.id = outreach_id and public.has_full_business_access(o.business_id, auth.uid())
    )
  );

drop policy if exists business_outreach_events_staff_insert on public.business_outreach_events;
create policy business_outreach_events_staff_insert on public.business_outreach_events
  for insert to authenticated
  with check (
    exists (
      select 1 from public.business_outreach o
      where o.id = outreach_id and public.has_full_business_access(o.business_id, auth.uid())
    )
  );

drop policy if exists business_outreach_events_staff_update on public.business_outreach_events;
create policy business_outreach_events_staff_update on public.business_outreach_events
  for update to authenticated
  using (
    exists (
      select 1 from public.business_outreach o
      where o.id = outreach_id and public.has_full_business_access(o.business_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.business_outreach o
      where o.id = outreach_id and public.has_full_business_access(o.business_id, auth.uid())
    )
  );

revoke all on public.business_outreach, public.business_outreach_events from public, anon, authenticated;
grant select, insert, update on public.business_outreach, public.business_outreach_events to authenticated;
grant all on public.business_outreach, public.business_outreach_events to service_role;

-- Portal projection. Phone, email and company notes are not columns here, so they
-- cannot be returned. Hidden outreaches and notes the staff marked private are omitted.
create or replace view public.seller_portal_outreach
with (security_invoker = true) as
select
  o.id,
  o.business_id,
  o.contact_name,
  o.channel,
  o.reason,
  o.status,
  o.next_step,
  o.next_step_at,
  o.updated_at,
  o.created_at
from public.business_outreach o
where o.hidden_from_owner = false;

create or replace view public.seller_portal_outreach_events
with (security_invoker = true) as
select
  e.id,
  e.outreach_id,
  o.business_id,
  e.occurred_on,
  e.stage,
  e.note,
  true as visible_to_owner
from public.business_outreach_events e
join public.business_outreach o on o.id = e.outreach_id
where e.visible_to_owner = true
  and o.hidden_from_owner = false;

revoke all on public.seller_portal_outreach, public.seller_portal_outreach_events from public, anon, authenticated;
grant select on public.seller_portal_outreach, public.seller_portal_outreach_events to service_role;

comment on table public.business_outreach is 'Proactive outreach to people who are not registered buyers. Staff only. Portal uses seller_portal_outreach.';
comment on column public.business_outreach.hidden_from_owner is 'When true, the whole outreach is omitted from the seller portal.';
comment on column public.business_outreach_events.visible_to_owner is 'When false, this timeline note stays off the seller portal. Default on.';

commit;
