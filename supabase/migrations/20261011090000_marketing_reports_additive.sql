-- Weekly marketing reports in the seller portal (spec /workspace/bsd-reports/eldad-portal-reports-spec.md §2 G4, 10.10.2026).
-- ADDITIVE ONLY: one partial unique index, three new nullable/defaulted columns, one new table, one new guard trigger.
-- No existing row, column, constraint, policy or function is changed. Rollback: docs/marketing-reports-rollback.sql.
-- Approved in writing by Baruch 11.10.2026 06:44; applied to production 11.10.2026 via apply_migration (name marketing_reports_additive).

-- 1) one row per business / period / version for marketing reports (0 advertising rows exist today, so it builds without conflicts)
create unique index if not exists bsf_marketing_report_uniq on public.business_sale_files
  (business_id, portal_period_from, portal_period_to, version_number)
  where portal_kind='advertising' and document_type='activity_report' and deleted_at is null;

-- 2) marketing-service flag (replaces the "who is in the plan" heuristic)
alter table public.businesses add column if not exists marketing_service_active boolean not null default false,
  add column if not exists marketing_service_since date;

-- 3) bot permission flag
alter table public.profiles add column if not exists can_publish_marketing_reports boolean not null default false;

-- 3b) guard: profiles_update_self_or_admin lets every CRM user update his own profile row, so without this
--     trigger any user could grant himself the publish permission. Only the service role (or a DB superuser
--     running an approved script) may change this flag.
create or replace function public.protect_marketing_publish_flag() returns trigger
 language plpgsql set search_path to '' as $$
begin
 if (TG_OP='INSERT' and new.can_publish_marketing_reports)
    or (TG_OP='UPDATE' and new.can_publish_marketing_reports is distinct from old.can_publish_marketing_reports) then
  if coalesce(auth.role(),'')<>'service_role' and current_user not in ('postgres','supabase_admin','service_role') then
   raise exception 'can_publish_marketing_reports can only be changed by the service role';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists trg_protect_marketing_publish_flag on public.profiles;
create trigger trg_protect_marketing_publish_flag before insert or update on public.profiles
 for each row execute function public.protect_marketing_publish_flag();

-- 4) run status mirror for the CRM status screen (marketing-reports.html), written only by the publish/verify actions (service role)
create table if not exists public.marketing_report_runs(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  period_from date not null, period_to date not null, report_type text not null default 'weekly',
  sale_file_id uuid references public.business_sale_files(id) on delete set null,
  sha256 text, pdf_status text, portal_status text,
  checks jsonb, last_verified_at timestamptz, last_error text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(business_id, period_from, period_to, report_type));
alter table public.marketing_report_runs enable row level security;
do $$begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='marketing_report_runs' and policyname='mrr_admin_manager_select') then
  create policy mrr_admin_manager_select on public.marketing_report_runs for select using (public.is_manager_or_admin());
 end if;
end$$;
-- no insert/update/delete policies: written by the edge function (service role) only
revoke all on public.marketing_report_runs from anon;
revoke insert, update, delete, truncate on public.marketing_report_runs from authenticated;
