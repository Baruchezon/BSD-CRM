-- Stage 7 of the matches-module upgrade: full professional client-facing
-- activity report module (הפקת דוח ללקוח), per his detailed instruction
-- of 28.08.2026. Purely additive - no existing column, row, or table is
-- touched, changed, or removed.

-- 1) Note classification (section ג): every activity-log entry can be
-- marked as safe to show a client, or internal-only. Defaults to internal
-- (false) so nothing is client-visible by accident.
alter table public.match_activity_log
  add column if not exists visible_to_client boolean not null default false;

comment on column public.match_activity_log.visible_to_client is 'האם פעולה/הערה זו מותרת להצגה ללקוח (בעל העסק) בדוח - ברירת מחדל: לא (פנימי)';

-- 2) Editable, versioned client reports per business (sections ד-ט).
-- One row per draft/final report. `snapshot` freezes the exact data used
-- to build/edit the report at generation time (section ט - a later change
-- to a match must never silently alter an already-generated report).
-- Finalizing (generating the PDF) links to the existing business_sale_files
-- row via sale_file_id - no parallel PDF/versioning mechanism.
create table if not exists public.business_client_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null default 'דוח פעילות והתאמות',
  period_from date,
  period_to date,
  status text not null default 'draft' check (status in ('draft','final')),
  version_number integer,
  version_group_id uuid,
  snapshot jsonb not null default '{}'::jsonb,
  sale_file_id uuid references public.business_sale_files(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id)
);

comment on table public.business_client_reports is 'דוחות פעילות מקצועיים ללקוח (בעל עסק) - טיוטה ניתנת לעריכה, גרסה סופית מקושרת ל-PDF שנשמר ב-business_sale_files. מחיקה רכה בלבד.';

create index if not exists idx_business_client_reports_business_id on public.business_client_reports(business_id) where deleted_at is null;

create or replace function public.trg_business_client_reports_touch()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), old.updated_by);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_business_client_reports_touch on public.business_client_reports;
create trigger trg_business_client_reports_touch
  before update on public.business_client_reports
  for each row execute function public.trg_business_client_reports_touch();

-- RLS: same access model as the business itself (only someone with full
-- business access, or admin/manager, may see/create/edit/delete reports
-- for that business) - per section י.
alter table public.business_client_reports enable row level security;

create policy bcr_select on public.business_client_reports
  for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
    or public.has_full_business_access(business_id, auth.uid())
  );

create policy bcr_insert on public.business_client_reports
  for insert
  with check (
    public.is_active_user() and not public.is_viewer_only()
    and (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
      or public.has_full_business_access(business_id, auth.uid())
    )
  );

create policy bcr_update on public.business_client_reports
  for update
  using (
    public.is_active_user() and not public.is_viewer_only()
    and (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
      or public.has_full_business_access(business_id, auth.uid())
    )
  );

-- Real DELETE is intentionally not offered - deletion is soft (UPDATE
-- deleted_at/deleted_by), same convention as match_activity_log.

-- 3) Allow the new 'client_report' document type on the existing shared
-- business_sale_files table - the finalized PDF for a client report is
-- stored there like every other generated document, no new file table.
alter table public.business_sale_files
  drop constraint business_sale_files_document_type_check;

alter table public.business_sale_files
  add constraint business_sale_files_document_type_check
  check (document_type is null or document_type = any (array[
    'short_summary'::text, 'internal_full_summary'::text,
    'anonymous_summary'::text, 'activity_report'::text, 'client_report'::text
  ]));

