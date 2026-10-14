-- 14.10.2026 (approved by Baruch): call-recording summaries as lead documents.
-- ADDITIVE ONLY. No existing column, policy, or function is rewritten.
-- Rollback: docs/call-summary-rollback.sql
-- Files live in the existing bucket business-files under leads/<lead_id>/.

create table if not exists public.lead_documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  buyer_id uuid references public.leads(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  phone_call_id uuid references public.phone_calls(id) on delete set null,
  category text not null default 'קובץ הקלטה',
  display_name text,
  storage_path text,
  mime_type text,
  file_size bigint,
  created_by uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.lead_documents is
  'Documents attached to a lead. Admin-only RLS (public.is_admin). Call-summary PDFs are stored in business-files at leads/<lead_id>/.';

create index if not exists lead_documents_lead_id_idx on public.lead_documents (lead_id) where deleted_at is null;
create index if not exists lead_documents_buyer_id_idx on public.lead_documents (buyer_id) where deleted_at is null;
create index if not exists lead_documents_business_id_idx on public.lead_documents (business_id) where deleted_at is null;
create index if not exists lead_documents_phone_call_id_idx on public.lead_documents (phone_call_id) where deleted_at is null;

alter table public.lead_documents enable row level security;
revoke all on public.lead_documents from public, anon;
grant select, insert, update, delete on public.lead_documents to authenticated;
grant all on public.lead_documents to service_role;

drop policy if exists lead_documents_admin_select on public.lead_documents;
create policy lead_documents_admin_select on public.lead_documents
  for select to authenticated using (public.is_admin());
drop policy if exists lead_documents_admin_insert on public.lead_documents;
create policy lead_documents_admin_insert on public.lead_documents
  for insert to authenticated with check (public.is_admin());
drop policy if exists lead_documents_admin_update on public.lead_documents;
create policy lead_documents_admin_update on public.lead_documents
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists lead_documents_admin_delete on public.lead_documents;
create policy lead_documents_admin_delete on public.lead_documents
  for delete to authenticated using (public.is_admin());

alter table public.phone_calls
  add column if not exists summary_status text not null default 'none',
  add column if not exists summary_doc_id uuid,
  add column if not exists transcript text,
  add column if not exists summary_attempts integer not null default 0;

alter table public.phone_calls drop constraint if exists phone_calls_summary_doc_id_fkey;
alter table public.phone_calls
  add constraint phone_calls_summary_doc_id_fkey
  foreign key (summary_doc_id) references public.lead_documents(id) on delete set null;

alter table public.phone_calls drop constraint if exists phone_calls_summary_status_check;
alter table public.phone_calls
  add constraint phone_calls_summary_status_check
  check (summary_status in ('none', 'queued', 'processing', 'done', 'error'));

comment on column public.phone_calls.summary_status is
  'none | queued | processing | done | error. Set to queued when an answered call has an available recording.';
comment on column public.phone_calls.summary_doc_id is 'lead_documents row of the summary PDF.';
comment on column public.phone_calls.transcript is 'Hebrew Whisper transcript. A retry reuses it and does not transcribe again.';
comment on column public.phone_calls.summary_attempts is 'Claims by exm-call-summary. The third failure sets summary_status to error.';

create index if not exists phone_calls_summary_queue_idx
  on public.phone_calls (started_at)
  where summary_status in ('queued', 'processing');

-- Answered calls whose recording is already available enter the queue once.
update public.phone_calls
   set summary_status = 'queued'
 where recording_status = 'available'
   and answered is true
   and summary_status = 'none';

create or replace function public.bsd_queue_call_summary()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.recording_status = 'available'
     and new.answered is true
     and new.summary_status = 'none' then
    new.summary_status := 'queued';
  end if;
  return new;
end;
$$;

drop trigger if exists phone_calls_queue_summary on public.phone_calls;
create trigger phone_calls_queue_summary
  before insert or update of recording_status, answered, summary_status
  on public.phone_calls
  for each row
  execute function public.bsd_queue_call_summary();

-- Claim one or two queued calls. Stale processing rows are returned to the queue
-- without counting another attempt. Execute is limited to service_role.
create or replace function public.bsd_claim_call_summary(p_limit integer default 1)
returns setof public.phone_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := greatest(1, least(coalesce(p_limit, 1), 2));
begin
  update public.phone_calls
     set summary_status = case when summary_attempts >= 3 then 'error' else 'queued' end,
         last_error = coalesce(last_error, 'stale processing recovered'),
         updated_at = now()
   where summary_status = 'processing'
     and updated_at < now() - interval '20 minutes';

  return query
  with picked as (
    select c.id
      from public.phone_calls c
     where c.summary_status = 'queued'
       and c.summary_attempts < 3
       and c.is_test = false
       and c.lead_id is not null
     order by c.started_at
     limit n
     for update skip locked
  )
  update public.phone_calls p
     set summary_status = 'processing',
         summary_attempts = p.summary_attempts + 1,
         updated_at = now()
    from picked
   where p.id = picked.id
  returning p.*;
end;
$$;

revoke all on function public.bsd_claim_call_summary(integer) from public, anon, authenticated;
grant execute on function public.bsd_claim_call_summary(integer) to service_role;

-- leads/<lead_id>/ is admin-only. Restrictive policies close the broad
-- storage_select / storage_insert policies for this prefix. Service role bypasses RLS.
drop policy if exists business_files_leads_admin_all on storage.objects;
create policy business_files_leads_admin_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'business-files'
    and (storage.foldername(name))[1] = 'leads'
    and public.is_admin()
  )
  with check (
    bucket_id = 'business-files'
    and (storage.foldername(name))[1] = 'leads'
    and public.is_admin()
  );

drop policy if exists business_files_leads_restrict_select on storage.objects;
create policy business_files_leads_restrict_select on storage.objects
  as restrictive for select to public
  using (
    bucket_id <> 'business-files'
    or (storage.foldername(name))[1] is distinct from 'leads'
    or public.is_admin()
  );

drop policy if exists business_files_leads_restrict_insert on storage.objects;
create policy business_files_leads_restrict_insert on storage.objects
  as restrictive for insert to public
  with check (
    bucket_id <> 'business-files'
    or (storage.foldername(name))[1] is distinct from 'leads'
    or public.is_admin()
  );

drop policy if exists business_files_leads_restrict_update on storage.objects;
create policy business_files_leads_restrict_update on storage.objects
  as restrictive for update to public
  using (
    bucket_id <> 'business-files'
    or (storage.foldername(name))[1] is distinct from 'leads'
    or public.is_admin()
  )
  with check (
    bucket_id <> 'business-files'
    or (storage.foldername(name))[1] is distinct from 'leads'
    or public.is_admin()
  );

drop policy if exists business_files_leads_restrict_delete on storage.objects;
create policy business_files_leads_restrict_delete on storage.objects
  as restrictive for delete to public
  using (
    bucket_id <> 'business-files'
    or (storage.foldername(name))[1] is distinct from 'leads'
    or public.is_admin()
  );

-- Every 10 minutes. The token stays in vault; this file does not contain it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'bsd-exm-call-summary-10min') then
    perform cron.unschedule('bsd-exm-call-summary-10min');
  end if;
end $$;

select cron.schedule(
  'bsd-exm-call-summary-10min',
  '*/10 * * * *',
  $$select net.http_post(
      url:='https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/exm-call-summary',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'X-BSD-Token',(select decrypted_secret from vault.decrypted_secrets where name='EXM_WEBHOOK_TOKEN' limit 1)
      ),
      body:='{"limit":1}'::jsonb,
      timeout_milliseconds:=180000
    )$$
);
