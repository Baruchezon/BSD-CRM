-- Rollback for 20261014220000_lead_documents_call_summary.
-- Additive objects only. Does not delete storage objects under business-files/leads/.
-- Run by hand if the feature must be removed. Do not run as part of a deploy.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bsd-exm-call-summary-10min') then
    perform cron.unschedule('bsd-exm-call-summary-10min');
  end if;
end $$;

drop trigger if exists phone_calls_queue_summary on public.phone_calls;
drop function if exists public.bsd_queue_call_summary();
drop function if exists public.bsd_claim_call_summary(integer);

drop policy if exists business_files_leads_admin_all on storage.objects;
drop policy if exists business_files_leads_restrict_select on storage.objects;
drop policy if exists business_files_leads_restrict_insert on storage.objects;
drop policy if exists business_files_leads_restrict_update on storage.objects;
drop policy if exists business_files_leads_restrict_delete on storage.objects;

alter table public.phone_calls drop constraint if exists phone_calls_summary_doc_id_fkey;
alter table public.phone_calls drop constraint if exists phone_calls_summary_status_check;
alter table public.phone_calls drop column if exists summary_doc_id;
alter table public.phone_calls drop column if exists summary_status;
alter table public.phone_calls drop column if exists transcript;
alter table public.phone_calls drop column if exists summary_attempts;

drop table if exists public.lead_documents;

-- Storage files at business-files/leads/<lead_id>/ are left in place.
-- Remove them from Storage only if the documents themselves should be destroyed.
-- The edge function exm-call-summary is not dropped by SQL; delete it in the Supabase dashboard if required.
