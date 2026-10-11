-- Minimal local mirror of the production objects the WhatsApp migration touches (definitions copied from
-- production on 11.10.2026, read-only). Used ONLY by run-db-test.sh against a throwaway local Postgres.
create extension if not exists pgcrypto;
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create or replace function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create type public.user_role as enum ('admin','manager','broker','user','viewer','agent_authorized','agent');
create type public.lead_type as enum ('buyer','seller','partner');
create table public.profiles (id uuid primary key, role public.user_role not null, status text not null default 'active', full_name text, can_send_agreement boolean);
create table public.leads (id uuid primary key default gen_random_uuid(), type public.lead_type, full_name text, first_name text, phone text, phone2 text,
  created_by uuid, handled_by uuid, is_archived boolean default false, client_number int, agreement_status text default 'אין הסכם', agreement_number text,
  agreement_pdf_path text, agreement_pdf_uploaded_at timestamptz, agreement_pdf_uploaded_by uuid, agreement_sent boolean, agreement_signed boolean, agreement_signed_date date, updated_at timestamptz);
create table public.businesses (id uuid primary key default gen_random_uuid(), owner_name text, internal_name text, owner_phone text, created_by uuid, handled_by uuid,
  is_archived boolean default false, business_number int, agreement_status text default 'אין הסכם', agreement_number text, agreement_pdf_path text,
  agreement_pdf_uploaded_at timestamptz, agreement_pdf_uploaded_by uuid, updated_at timestamptz);
create table public.brokers (id uuid primary key default gen_random_uuid(), full_name text, first_name text, phone text, created_by uuid, handled_by uuid,
  is_archived boolean default false, agreement_status text default 'אין הסכם', agreement_number text, agreement_pdf_path text,
  agreement_pdf_uploaded_at timestamptz, agreement_pdf_uploaded_by uuid, updated_at timestamptz);
create table public.business_access_grants (business_id uuid, granted_to uuid, active boolean, access_level text);
create table public.lead_access_grants (lead_id uuid, granted_to uuid, active boolean, scopes text[]);
create table public.activity_log (id uuid primary key default gen_random_uuid(), user_id uuid, action_type text, entity_type text, entity_id uuid, old_value jsonb, new_value jsonb, created_at timestamptz default now());

-- production whatsapp_messages (0 rows) with its checks and policies
create table public.whatsapp_messages (id uuid not null default gen_random_uuid() primary key, event_kind text not null check (event_kind in ('inbound_message','outbound_attempt')),
  lead_id uuid references public.leads(id), phone_e164 text not null, raw_phone_input text, direction text not null check (direction in ('inbound','outbound')),
  message_type text not null, message_text text, template_name text, client_request_id uuid, provider_message_id text, status text not null,
  attempt_number int not null default 1, error_code text, error_message text, sent_at timestamptz, delivered_at timestamptz, read_at timestamptz, failed_at timestamptz,
  uncertain_at timestamptz, ambiguous_match boolean not null default false, candidate_lead_ids jsonb,
  processing_status text not null default 'pending' check (processing_status in ('pending','claimed','done','failed')), processing_claimed_at timestamptz,
  processing_attempts int not null default 0, last_processing_error text, processed_at timestamptz, created_at timestamptz not null default now(), received_at timestamptz);
alter table public.whatsapp_messages add constraint whatsapp_messages_message_type_check check (message_type in ('template','free_text','auto_night_reply'));
alter table public.whatsapp_messages enable row level security;
create policy whatsapp_messages_select on public.whatsapp_messages for select to public using (
  (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])))
  or (exists (select 1 from public.leads l where l.id = whatsapp_messages.lead_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))));
create table public.whatsapp_send_log (id uuid primary key default gen_random_uuid(), entity_type text not null check (entity_type in ('lead','business','training_lead')),
  entity_id uuid not null, template_key text, message_text text not null, phone_snapshot text, opened_by uuid not null references public.profiles(id),
  opened_at timestamptz not null default now(), confirmed_sent boolean not null default false, confirmed_by uuid references public.profiles(id), confirmed_at timestamptz, created_at timestamptz not null default now());

create or replace function public.safe_uuid(p_text text) returns uuid language plpgsql immutable as $$ begin return p_text::uuid; exception when others then return null; end $$;
create or replace function public.is_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
create or replace function public.is_admin_or_manager(uid uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles where id = uid and role in ('admin','manager')) $$;
create or replace function public.is_manager_or_admin() returns boolean language sql stable security definer as $$ select public.is_admin_or_manager(auth.uid()) $$;
create or replace function public.is_active_user() returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active') $$;
create or replace function public.is_viewer_only() returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'viewer') $$;
create or replace function public.is_broker_viewer() returns boolean language sql stable security definer as $$ select false $$;
create or replace function public.has_full_business_access(biz_id uuid, uid uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles p where p.id = uid and p.role in ('admin','manager'))
  or exists (select 1 from businesses b where b.id = biz_id and (b.created_by = uid or b.handled_by = uid))
  or exists (select 1 from business_access_grants g where g.business_id = biz_id and g.granted_to = uid and g.active and g.access_level = 'full') $$;
create or replace function public.has_lead_view_access(p_lead_id uuid) returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select is_admin() or exists (select 1 from leads l where l.id = p_lead_id and l.created_by = auth.uid())
  or exists (select 1 from lead_access_grants g where g.lead_id = p_lead_id and g.granted_to = auth.uid() and g.active and 'view_card' = any(g.scopes)) $$;
create or replace function public.has_agreement_record_access(p_table_name text, p_record_id uuid, uid uuid) returns boolean language sql stable security definer as $$
  select is_admin_or_manager(uid) or (p_table_name = 'businesses' and has_full_business_access(p_record_id, uid))
  or (p_table_name = 'leads' and exists (select 1 from leads l where l.id = p_record_id and (l.created_by = uid or l.handled_by = uid)))
  or (p_table_name = 'brokers' and is_broker_viewer()) $$;
create or replace function public.save_manual_signed_agreement(p_table_name text, p_record_id uuid, p_path text, p_uploaded_by uuid) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_table_name not in ('businesses','leads','brokers') then raise exception 'טבלה לא נתמכת: %', p_table_name; end if;
  if not has_agreement_record_access(p_table_name, p_record_id, auth.uid()) then raise exception 'אין הרשאה לעדכן הסכם עבור רשומה זו'; end if;
  if p_table_name = 'businesses' then update businesses set agreement_pdf_path = p_path, agreement_pdf_uploaded_at = now(), agreement_pdf_uploaded_by = p_uploaded_by,
      agreement_status = case when agreement_status = 'יש הסכם חתום' then agreement_status else 'יש הסכם חתום' end where id = p_record_id;
  elsif p_table_name = 'leads' then update leads set agreement_pdf_path = p_path, agreement_pdf_uploaded_at = now(), agreement_pdf_uploaded_by = p_uploaded_by,
      agreement_status = case when agreement_status = 'יש הסכם חתום' then agreement_status else 'יש הסכם חתום' end where id = p_record_id;
  elsif p_table_name = 'brokers' then update brokers set agreement_pdf_path = p_path, agreement_pdf_uploaded_at = now(), agreement_pdf_uploaded_by = p_uploaded_by,
      agreement_status = case when agreement_status = 'יש הסכם חתום' then agreement_status else 'יש הסכם חתום' end where id = p_record_id;
  end if;
end; $$;
create or replace function public.enforce_signed_agreement_state() returns trigger language plpgsql set search_path to '' as $$
begin
  if nullif(new.agreement_pdf_path, '') is not null and (tg_op = 'INSERT' or nullif(old.agreement_pdf_path, '') is null) then
    new.agreement_status := 'יש הסכם חתום';
    if tg_table_name = 'leads' then new.agreement_sent := true; new.agreement_signed := true; new.agreement_signed_date := coalesce(new.agreement_signed_date, current_date); end if;
    return new;
  end if;
  return new;
end; $$;
create trigger trg_enforce_signed_b before insert or update on public.businesses for each row execute function public.enforce_signed_agreement_state();
create trigger trg_enforce_signed_l before insert or update on public.leads for each row execute function public.enforce_signed_agreement_state();
-- production storage policies relevant here (permissive "any active user may read business-files")
create policy storage_select on storage.objects for select to public using (bucket_id = 'business-files' and public.is_active_user());
create policy storage_insert on storage.objects for insert to public with check (bucket_id = 'business-files' and public.is_active_user() and not public.is_viewer_only());
