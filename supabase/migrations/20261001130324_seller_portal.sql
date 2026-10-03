-- Additive only. Apply to isolated staging first. No production execution.
begin;
create table public.seller_portal_accounts (
 id uuid primary key default gen_random_uuid(), business_id uuid unique references public.businesses(id) on delete set null,
 username text not null unique check(username ~ '^[1-9][0-9]{4}$'), password_hash text not null,
 status text not null default 'active' check(status in ('active','blocked','archived','deleted')),
 must_change_password boolean not null default true, temporary_expires_at timestamptz,
 client_update text, client_updated_at timestamptz, created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now()
);
create table public.seller_portal_sessions (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.seller_portal_accounts(id),
 token_hash text not null unique, created_at timestamptz not null default now(), last_activity_at timestamptz not null default now(),
 active_seconds integer not null default 0 check(active_seconds>=0), last_activity_measure_at timestamptz not null default now(),
 expires_at timestamptz not null, revoked_at timestamptz
);
create table public.seller_portal_events (
 id uuid primary key default gen_random_uuid(), account_id uuid references public.seller_portal_accounts(id),
 event_type text not null, session_id uuid references public.seller_portal_sessions(id),
 page text check(page in ('home','documents','matches','reports','business')), duration_seconds integer not null default 0 check(duration_seconds between 0 and 90), meta_file_id uuid references public.business_file_meta(id) on delete set null, file_id uuid references public.business_sale_files(id) on delete set null, actor_id uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now()
);
create index seller_portal_events_account_time on public.seller_portal_events(account_id,created_at);
create table public.seller_portal_requests (
 id uuid primary key default gen_random_uuid(), account_id uuid references public.seller_portal_accounts(id),
 kind text not null check(kind in ('username','password','message')), requester_name text not null, business_name text not null,
 phone text not null, message text, status text not null default 'new' check(status in ('new','handled')), created_at timestamptz not null default now()
);
create table public.seller_portal_rate_limits (key_hash text primary key, window_start timestamptz not null default now(), attempts integer not null default 0);
create table public.seller_portal_match_permissions (
 match_id uuid primary key references public.matches(id) on delete cascade, visible boolean not null default false,
 disclose_identity boolean not null default false, client_status text not null,
 approved_by uuid references public.profiles(id) on delete set null, approved_at timestamptz not null default now()
);
alter table public.business_file_meta add column portal_visible boolean not null default false;
alter table public.business_file_meta add column portal_kind text not null default 'document';
alter table public.business_sale_files add column portal_visible boolean not null default false;
alter table public.business_sale_files add column portal_kind text not null default 'document' check(portal_kind in ('document','advertising'));
alter table public.business_sale_files add column portal_period_from date;
alter table public.business_sale_files add column portal_period_to date;
-- No direct Data API access, even for CRM users. The dedicated API checks admin/seller on each action.
alter table public.seller_portal_accounts enable row level security;
alter table public.seller_portal_sessions enable row level security;
alter table public.seller_portal_events enable row level security;
alter table public.seller_portal_requests enable row level security;
alter table public.seller_portal_rate_limits enable row level security;
alter table public.seller_portal_match_permissions enable row level security;
revoke all on public.seller_portal_accounts,public.seller_portal_sessions,public.seller_portal_events,public.seller_portal_requests,public.seller_portal_rate_limits,public.seller_portal_match_permissions from public,anon,authenticated;
grant all on public.seller_portal_accounts,public.seller_portal_sessions,public.seller_portal_events,public.seller_portal_requests,public.seller_portal_rate_limits,public.seller_portal_match_permissions to service_role;
-- Atomic reservation prevents concurrent requests from bypassing rate limits.
create function public.seller_portal_take_attempt(p_key text,p_max integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 insert into public.seller_portal_rate_limits(key_hash,attempts) values(p_key,1)
 on conflict(key_hash) do update set attempts=case when seller_portal_rate_limits.window_start < now()-interval '15 minutes' then 1 else seller_portal_rate_limits.attempts+1 end,
 window_start=case when seller_portal_rate_limits.window_start < now()-interval '15 minutes' then now() else seller_portal_rate_limits.window_start end
 returning attempts into n;
 return n<=p_max;
end $$;
revoke all on function public.seller_portal_take_attempt(text,integer) from public,anon,authenticated;
grant execute on function public.seller_portal_take_attempt(text,integer) to service_role;
create function public.seller_portal_account_gate() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status='active' and not exists(select 1 from public.businesses b where b.id=new.business_id and not b.is_archived and b.agreement_status='יש הסכם חתום') then
 raise exception 'Seller portal requires an active business with signed agreement'; end if;
 return new;
end $$;
revoke all on function public.seller_portal_account_gate() from public,anon,authenticated;
create trigger seller_portal_account_gate before insert or update on public.seller_portal_accounts for each row execute function public.seller_portal_account_gate();
-- Targeted trigger only updates portal tables; restoring the business does not automatically enable access.
create schema if not exists seller_portal_private;
revoke all on schema seller_portal_private from public,anon,authenticated;
create function seller_portal_private.archive_gate() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='DELETE' then
 update public.seller_portal_accounts set status='blocked' where business_id=old.id and status<>'deleted';
 update public.seller_portal_sessions set revoked_at=now() where account_id in (select id from public.seller_portal_accounts where business_id=old.id) and revoked_at is null;
 insert into public.seller_portal_events(account_id,event_type) select id,'business_deleted_access_revoked' from public.seller_portal_accounts where business_id=old.id;
 return old;
 end if;
 if new.is_archived then
 update public.seller_portal_accounts set status='archived' where business_id=new.id and status<>'deleted';
 elsif new.agreement_status is distinct from 'יש הסכם חתום' then
 update public.seller_portal_accounts set status='blocked' where business_id=new.id and status='active';
 end if;
 if new.is_archived or new.agreement_status is distinct from 'יש הסכם חתום' then
 update public.seller_portal_sessions set revoked_at=now() where account_id in (select id from public.seller_portal_accounts where business_id=new.id) and revoked_at is null;
 insert into public.seller_portal_events(account_id,event_type) select id,'business_access_revoked' from public.seller_portal_accounts where business_id=new.id;
 end if;
 return new;
end $$;
revoke all on function seller_portal_private.archive_gate() from public,anon,authenticated;
create trigger seller_portal_delete_gate before delete on public.businesses for each row execute function seller_portal_private.archive_gate();
create trigger seller_portal_archive_gate after update of is_archived,agreement_status on public.businesses for each row execute function seller_portal_private.archive_gate();
-- Existing CRM RLS remains unchanged. Agents cannot set portal visibility by REST.
create function public.seller_portal_file_approval_gate() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (TG_OP='INSERT' and new.portal_visible) or (TG_OP='UPDATE' and (new.portal_visible is distinct from old.portal_visible or new.portal_kind is distinct from old.portal_kind)) then
 if current_user not in ('postgres','service_role') and not exists(select 1 from public.profiles where id=auth.uid() and status='active' and role in ('admin','manager')) then raise exception 'Manager approval required'; end if;
 end if; return new;
end $$;
revoke all on function public.seller_portal_file_approval_gate() from public,anon,authenticated;
create trigger seller_portal_file_approval_gate before insert or update on public.business_sale_files for each row execute function public.seller_portal_file_approval_gate();
create trigger seller_portal_attachment_approval_gate before insert or update on public.business_file_meta for each row execute function public.seller_portal_file_approval_gate();
-- Only authenticated API calls may record activity. Elapsed server time bounds
-- the duration, and a locked session prevents double counting across tabs.
create function public.seller_portal_record_activity(p_session uuid,p_account uuid,p_page text,p_seconds integer,p_kind text) returns integer
language plpgsql security invoker set search_path='' as $$
declare last_measure timestamptz; delta integer; stamp timestamptz:=clock_timestamp();
begin
 if p_page is null or p_kind is null or p_seconds is null or p_page not in ('home','documents','matches','reports','business') or p_kind not in ('page_view','heartbeat') or p_seconds not between 0 and 90 then raise exception 'Invalid activity'; end if;
 select s.last_activity_measure_at into last_measure from public.seller_portal_sessions s
 join public.seller_portal_accounts a on a.id=s.account_id join public.businesses b on b.id=a.business_id
 where s.id=p_session and s.account_id=p_account and s.revoked_at is null and s.expires_at>stamp and s.last_activity_at>stamp-interval '30 minutes'
 and a.status='active' and not b.is_archived and b.agreement_status='יש הסכם חתום' for update of s;
 if not found then raise exception 'Invalid session'; end if;
 delta:=greatest(0,least(p_seconds,90,floor(extract(epoch from stamp-last_measure))::integer));
 if p_seconds>0 then update public.seller_portal_sessions set active_seconds=active_seconds+delta,last_activity_measure_at=stamp where id=p_session; end if;
 if p_kind='page_view' or delta>0 then
 insert into public.seller_portal_events(account_id,session_id,event_type,page,duration_seconds) values(p_account,p_session,p_kind,p_page,delta);
 end if;
 return delta;
end $$;
revoke all on function public.seller_portal_record_activity(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.seller_portal_record_activity(uuid,uuid,text,integer,text) to service_role;
commit;

