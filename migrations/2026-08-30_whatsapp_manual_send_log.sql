-- ============================================================
-- Manual WhatsApp template button — "שלח WhatsApp"
-- New table: whatsapp_send_log
-- Logs every "opened WhatsApp" action (never auto-marks as sent)
-- for leads (buyer/partner/seller), businesses (owner) and
-- training_leads (broker-training candidates).
-- Additive only. No existing table/column touched.
-- ============================================================

create table if not exists whatsapp_send_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('lead','business','training_lead')),
  entity_id uuid not null,
  template_key text,
  message_text text not null,
  phone_snapshot text,
  opened_by uuid not null references profiles(id),
  opened_at timestamptz not null default now(),
  confirmed_sent boolean not null default false,
  confirmed_by uuid references profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_send_log_entity
  on whatsapp_send_log(entity_type, entity_id, opened_at desc);

alter table whatsapp_send_log enable row level security;

-- Immutability trigger: once a row is created, only the
-- confirmation fields may ever change. Everything else
-- (entity_type/entity_id/template_key/message_text/phone_snapshot/
-- opened_by/opened_at) is a frozen record of what was actually opened.
create or replace function whatsapp_send_log_guard_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.entity_type    is distinct from old.entity_type
     or new.entity_id      is distinct from old.entity_id
     or new.template_key   is distinct from old.template_key
     or new.message_text   is distinct from old.message_text
     or new.phone_snapshot  is distinct from old.phone_snapshot
     or new.opened_by      is distinct from old.opened_by
     or new.opened_at      is distinct from old.opened_at
     or new.created_at     is distinct from old.created_at
  then
    raise exception 'whatsapp_send_log rows are append-only except confirmation fields';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_whatsapp_send_log_immutable on whatsapp_send_log;
create trigger trg_whatsapp_send_log_immutable
  before update on whatsapp_send_log
  for each row execute function whatsapp_send_log_guard_immutable();

-- Shared entity-access predicate, mirrors the exact SELECT rules
-- already enforced on leads/businesses/training_leads themselves,
-- so a person only ever sees WhatsApp-log rows for entities they
-- could already open.
create or replace function whatsapp_send_log_entity_access(p_entity_type text, p_entity_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    is_admin()
    or (
      p_entity_type = 'lead' and exists (
        select 1 from leads l
        where l.id = p_entity_id
        and (
          (l.type = 'seller' and (
            exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'manager')
            or l.created_by = auth.uid()
            or l.handled_by = auth.uid()
          ))
          or (l.type in ('buyer','partner') and (
            l.created_by = auth.uid()
            or has_lead_view_access(l.id)
          ))
        )
      )
    )
    or (
      p_entity_type = 'business' and exists (
        select 1 from businesses b
        where b.id = p_entity_id
        and (
          b.created_by = auth.uid()
          or b.handled_by = auth.uid()
          or has_full_business_access(b.id, auth.uid())
        )
      )
    );
    -- training_lead is intentionally NOT listed here: training_leads
    -- itself is admin-only (training_leads_admin_all), so only the
    -- is_admin() branch above ever grants access to those rows,
    -- matching the existing table's own access model exactly.
$$;

create policy whatsapp_send_log_select on whatsapp_send_log
  for select
  using (whatsapp_send_log_entity_access(entity_type, entity_id));

create policy whatsapp_send_log_insert on whatsapp_send_log
  for insert
  with check (
    is_active_user()
    and not is_viewer_only()
    and opened_by = auth.uid()
    and whatsapp_send_log_entity_access(entity_type, entity_id)
  );

create policy whatsapp_send_log_update on whatsapp_send_log
  for update
  using (
    is_active_user()
    and not is_viewer_only()
    and whatsapp_send_log_entity_access(entity_type, entity_id)
  )
  with check (
    is_active_user()
    and not is_viewer_only()
    and whatsapp_send_log_entity_access(entity_type, entity_id)
  );

-- No DELETE policy at all, by design — same pattern as
-- match_activity_log: a real DELETE returns 0 rows for everyone,
-- including admin. This is a message-open/send audit trail.

grant select, insert, update on whatsapp_send_log to authenticated;
grant execute on function whatsapp_send_log_entity_access(text, uuid) to authenticated;
