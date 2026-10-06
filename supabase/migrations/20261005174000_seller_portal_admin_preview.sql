-- Admin preview sessions (view-as-owner). Additive. Apply before using «צפייה כבעל העסק».
-- A preview session is a management QA view. It must not add active time or activity events.
begin;
alter table public.seller_portal_sessions add column if not exists preview boolean not null default false;
alter table public.seller_portal_sessions add column if not exists actor_id uuid references public.profiles(id) on delete set null;

create or replace function public.seller_portal_record_activity(p_session uuid,p_account uuid,p_page text,p_seconds integer,p_kind text) returns integer
language plpgsql security invoker set search_path='' as $$
declare last_measure timestamptz; delta integer; stamp timestamptz:=clock_timestamp();
begin
 if p_page is null or p_kind is null or p_seconds is null or p_page not in ('home','documents','matches','reports','business') or p_kind not in ('page_view','heartbeat') or p_seconds not between 0 and 90 then raise exception 'Invalid activity'; end if;
 -- Preview sessions are admin QA. Return without writing events or active_seconds.
 if exists (select 1 from public.seller_portal_sessions s where s.id=p_session and s.account_id=p_account and s.preview) then return 0; end if;
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
