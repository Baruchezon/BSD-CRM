\set ON_ERROR_STOP on
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

create table public.profiles (id uuid primary key);
create table public.leads (id uuid primary key);
create table public.businesses (id uuid primary key);
create table public.business_sale_files (
  id uuid primary key,
  business_id uuid not null references public.businesses(id),
  status text not null default 'active',
  confidentiality_level smallint not null default 2,
  document_type text
);

\i migrations/2026-09-17_vip_clients.sql

insert into public.profiles(id) values ('00000000-0000-0000-0000-000000000001');
insert into public.leads(id) values ('00000000-0000-0000-0000-000000000010');
insert into public.businesses(id) values
('00000000-0000-0000-0000-000000000020'),
('00000000-0000-0000-0000-000000000021');

insert into public.business_sale_files(id,business_id,status,confidentiality_level,document_type) values
('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020','active',1,'anonymous_summary'),
('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000020','active',2,'internal_full_summary'),
('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000021','active',1,'anonymous_summary');

insert into public.vip_accounts(buyer_id,username,password_hash,created_by)
values ('00000000-0000-0000-0000-000000000010','VIP0010','hash','00000000-0000-0000-0000-000000000001');

insert into public.vip_business_publications(business_id,enabled,anonymous_file_id,published_by)
values ('00000000-0000-0000-0000-000000000020',true,'00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001');

DO $$
BEGIN
  BEGIN
    update public.vip_business_publications
      set anonymous_file_id='00000000-0000-0000-0000-000000000031'
      where business_id='00000000-0000-0000-0000-000000000020';
    raise exception 'unsafe confidential document was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'unsafe confidential document was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    update public.vip_business_publications
      set anonymous_file_id='00000000-0000-0000-0000-000000000032'
      where business_id='00000000-0000-0000-0000-000000000020';
    raise exception 'cross-business document was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'cross-business document was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    insert into public.vip_business_publications(business_id,enabled,anonymous_file_id)
    values ('00000000-0000-0000-0000-000000000021',true,null);
    raise exception 'enabled publication without document was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'enabled publication without document was accepted' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE enabled_count integer;
DECLARE rls_count integer;
DECLARE anon_priv boolean;
BEGIN
  select count(*) into enabled_count from public.vip_business_publications where enabled=true;
  if enabled_count <> 1 then raise exception 'expected exactly one safe enabled publication, got %', enabled_count; end if;

  select count(*) into rls_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('vip_accounts','vip_sessions','vip_login_attempts','vip_business_publications','vip_interests','vip_inquiries','vip_activity_events','vip_admin_audit')
    and c.relrowsecurity=true;
  if rls_count <> 8 then raise exception 'RLS not enabled on every VIP table: %', rls_count; end if;

  select has_table_privilege('anon','public.vip_accounts','SELECT') into anon_priv;
  if anon_priv then raise exception 'anon unexpectedly has SELECT on vip_accounts'; end if;
  select has_table_privilege('authenticated','public.vip_accounts','SELECT') into anon_priv;
  if anon_priv then raise exception 'authenticated unexpectedly has SELECT on vip_accounts'; end if;
  select has_table_privilege('anon','public.vip_login_attempts','SELECT') into anon_priv;
  if anon_priv then raise exception 'anon unexpectedly has SELECT on vip_login_attempts'; end if;
END $$;

select 'VIP migration safety tests passed' as result;
