-- 11.10.2026 (approved by Baruch): «מוכר עסק» / «קונה עסק» / «לא ידוע» badge on every lead
-- in «לידים» (manual and website) and in the lead card (leads-hub.html).
--
-- Why a new column: leads.type is NOT NULL, so a website lead whose form gave no clear
-- seller/buyer purpose is stored as type='buyer' only to satisfy the column. type alone
-- cannot tell «buyer» from «unknown». lead_side is the confirmed side; NULL = unknown.
--
-- ADDITIVE ONLY: two nullable columns + one CHECK, one log table for the backfill.
-- No existing column, row value, policy, grant, view or trigger is changed.
-- RLS: the columns live on public.leads and follow the existing leads policies.
-- Rollback: docs/lead-side-rollback.sql
alter table public.leads add column if not exists lead_side text;
alter table public.leads add column if not exists lead_side_source text;
alter table public.leads drop constraint if exists leads_lead_side_check;
alter table public.leads add constraint leads_lead_side_check
  check (lead_side is null or lead_side in ('seller','buyer'));
comment on column public.leads.lead_side is
  'Confirmed side of the lead: seller (מוכר עסק) / buyer (קונה עסק) / NULL (לא ידוע). Set by the website form (explicit purpose), the manual lead form, the lead card, or a click on the badge in «לידים». Never guessed from free text.';
comment on column public.leads.lead_side_source is
  'Where lead_side came from: website_form / manual_form / lead_card / badge / backfill:<signal>.';

-- Backfill log: exactly which rows the backfill below set, so it can be undone.
create table if not exists public.lead_side_backfill_log (
  lead_id uuid primary key,
  new_side text not null,
  signal text not null,
  lead_type text,
  lead_source text,
  backfilled_at timestamptz not null default now()
);
alter table public.lead_side_backfill_log enable row level security;
drop policy if exists lead_side_backfill_log_admin_read on public.lead_side_backfill_log;
create policy lead_side_backfill_log_admin_read on public.lead_side_backfill_log
  for select using (public.is_admin());
comment on table public.lead_side_backfill_log is
  'Rows whose leads.lead_side was filled by migration 20261011155351_leads_lead_side (reversible: see docs/lead-side-rollback.sql).';

-- Backfill, reliable signals only (non-archived rows whose lead_side is still NULL):
--  website_purpose: website lead whose form purpose was explicitly «למכור עסק» / «לקנות עסק»
--    (website_purpose_guess is built from that form field, never from the free-text message)
--    AND type agrees with it.
--  entered_by_person: lead typed in by a person - «פנייה ישירה לברוך», or «הזנה ידנית» with
--    «מוכר» (in the old manual form «קונה» was the default, so «קונה» there is NOT used).
with cand as (
  select l.id, l.type::text as lead_type, l.source,
    case
      when l.source ~* '(אתר|site123|website)'
           and regexp_replace(coalesce(l.website_purpose_guess,''), '\s*\(ניחוש\)\s*$', '') = 'מעוניין למכור עסק'
           and l.type = 'seller' then 'seller'
      when l.source ~* '(אתר|site123|website)'
           and regexp_replace(coalesce(l.website_purpose_guess,''), '\s*\(ניחוש\)\s*$', '') = 'מחפש לקנות עסק'
           and l.type = 'buyer' then 'buyer'
      when l.source = 'פנייה ישירה לברוך' and l.type in ('seller','buyer') then l.type::text
      when l.source = 'הזנה ידנית' and l.type = 'seller' then 'seller'
    end as side,
    case when l.source ~* '(אתר|site123|website)' then 'website_purpose' else 'entered_by_person' end as signal
  from public.leads l
  where not l.is_archived and l.lead_side is null
), logged as (
  insert into public.lead_side_backfill_log (lead_id, new_side, signal, lead_type, lead_source)
  select id, side, signal, lead_type, source from cand where side is not null
  on conflict (lead_id) do nothing
  returning lead_id, new_side, signal
)
update public.leads l
   set lead_side = g.new_side, lead_side_source = 'backfill:' || g.signal
  from logged g
 where l.id = g.lead_id and l.lead_side is null;
