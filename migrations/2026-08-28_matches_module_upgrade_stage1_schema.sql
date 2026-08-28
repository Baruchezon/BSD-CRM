-- Stage 1 of the matches-module upgrade: additive schema only.
-- Adds the fields required by the new active matches workspace, without
-- touching, renaming, or deleting any existing column, row, or table.
-- No data is migrated in this file — that is stage 2, after status mapping
-- is approved.

-- 1) New fields on matches: מקור ההתאמה, סוג חומר/תאריך שנשלח, מי עדכן לאחרונה
alter table public.matches
  add column if not exists match_source text,
  add column if not exists material_type text,
  add column if not exists material_sent_at timestamptz,
  add column if not exists updated_by uuid references public.profiles(id);

comment on column public.matches.match_source is 'מקור ההתאמה - how this match originated (e.g. ידני, הפצה אנונימית, פנייה יזומה)';
comment on column public.matches.material_type is 'סוג החומר שהועבר לקונה לאחרונה - kept in sync from anon_distributions when material is sent';
comment on column public.matches.material_sent_at is 'תאריך העברת המידע לקונה - last time material was sent for this match';
comment on column public.matches.updated_by is 'מי עדכן את ההתאמה לאחרונה';

-- Auto-populate updated_by on every update, isolated to this table only
-- (does not touch the shared trg_touch_and_log used by other tables).
create or replace function public.trg_matches_set_updated_by()
returns trigger
language plpgsql
security definer
as $$
begin
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end;
$$;

drop trigger if exists trg_matches_set_updated_by on public.matches;
create trigger trg_matches_set_updated_by
  before update on public.matches
  for each row execute function public.trg_matches_set_updated_by();

-- 2) New chronological activity/follow-up log per match (section ד).
-- Distinct from match_status_history (which only tracks status changes) -
-- this tracks every follow-up action, buyer response, and note.
create table if not exists public.match_activity_log (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  action_type text,
  description text,
  buyer_response text,
  note text,
  follow_up_date date,
  attached_file_id uuid references public.business_sale_files(id),
  performed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  delete_reason text
);

comment on table public.match_activity_log is 'טבלת מעקב כרונולוגית לכל התאמה - סעיף ד. מחיקה היא רכה בלבד (deleted_at/deleted_by), הרשומה לעולם לא נמחקת פיזית.';

create index if not exists idx_match_activity_log_match_id on public.match_activity_log(match_id);
create index if not exists idx_match_activity_log_follow_up on public.match_activity_log(follow_up_date) where deleted_at is null;

-- touch updated_at/updated_by on edits, mirroring the matches table's own pattern
create or replace function public.trg_match_activity_log_touch()
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

drop trigger if exists trg_match_activity_log_touch on public.match_activity_log;
create trigger trg_match_activity_log_touch
  before update on public.match_activity_log
  for each row execute function public.trg_match_activity_log_touch();

-- RLS: mirror the exact same access model already used by match_status_history
-- (admin/manager, full business access, or the buyer's own creator/handler).
alter table public.match_activity_log enable row level security;

create policy mal_select on public.match_activity_log
  for select
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_activity_log.match_id
        and (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
          or public.has_full_business_access(m.business_id, auth.uid())
          or exists (select 1 from public.leads l where l.id = m.buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
        )
    )
  );

create policy mal_insert on public.match_activity_log
  for insert
  with check (
    public.is_active_user() and not public.is_viewer_only()
    and exists (
      select 1 from public.matches m
      where m.id = match_activity_log.match_id
        and (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
          or public.has_full_business_access(m.business_id, auth.uid())
          or exists (select 1 from public.leads l where l.id = m.buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
        )
    )
  );

create policy mal_update on public.match_activity_log
  for update
  using (
    public.is_active_user() and not public.is_viewer_only()
    and exists (
      select 1 from public.matches m
      where m.id = match_activity_log.match_id
        and (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
          or public.has_full_business_access(m.business_id, auth.uid())
          or exists (select 1 from public.leads l where l.id = m.buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
        )
    )
  );

-- No delete policy on purpose: deletion must always go through the app's
-- soft-delete (UPDATE deleted_at/deleted_by/delete_reason), never a real DELETE.
