-- Seller portal hardening (03.10.2026). Additive. Apply after
-- 20261001130324_seller_portal.sql, to an isolated test database first.
begin;
-- One-time activation link replaces the temporary password sent in WhatsApp.
alter table public.seller_portal_accounts add column activation_token_hash text unique;
alter table public.seller_portal_accounts add column activation_expires_at timestamptz;
-- Activity history survives session pruning.
alter table public.seller_portal_events drop constraint seller_portal_events_session_id_fkey;
alter table public.seller_portal_events add constraint seller_portal_events_session_id_fkey foreign key (session_id) references public.seller_portal_sessions(id) on delete set null;
create index seller_portal_rate_limits_window on public.seller_portal_rate_limits(window_start);
create index seller_portal_sessions_expiry on public.seller_portal_sessions(expires_at);
create index seller_portal_sessions_account on public.seller_portal_sessions(account_id);

-- Read-only check used by the global failed-login ceiling.
create function public.seller_portal_attempts_exceeded(p_key text,p_max integer) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.seller_portal_rate_limits r where r.key_hash=p_key and r.window_start>=now()-interval '15 minutes' and r.attempts>=p_max);
$$;
revoke all on function public.seller_portal_attempts_exceeded(text,integer) from public,anon,authenticated;
grant execute on function public.seller_portal_attempts_exceeded(text,integer) to service_role;

-- Atomic single-use activation: the token row is consumed in the same UPDATE
-- that sets the password, so a second (or concurrent) use finds nothing.
create function public.seller_portal_activate(p_token_hash text,p_password_hash text,p_session_hash text,p_session_expires timestamptz)
returns table(account_id uuid,username text) language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_user text;
begin
 update public.seller_portal_accounts a set password_hash=p_password_hash,must_change_password=false,temporary_expires_at=null,activation_token_hash=null,activation_expires_at=null
 where a.activation_token_hash=p_token_hash and a.activation_expires_at>now() and a.status='active'
 and exists(select 1 from public.businesses b where b.id=a.business_id and not b.is_archived and b.agreement_status='יש הסכם חתום')
 returning a.id,a.username into v_id,v_user;
 if v_id is null then return; end if;
 update public.seller_portal_sessions set revoked_at=now() where seller_portal_sessions.account_id=v_id and revoked_at is null;
 insert into public.seller_portal_sessions(account_id,token_hash,expires_at) values(v_id,p_session_hash,p_session_expires);
 insert into public.seller_portal_events(account_id,event_type) values(v_id,'activated');
 insert into public.seller_portal_events(account_id,event_type) values(v_id,'login');
 account_id:=v_id; username:=v_user; return next;
end $$;
revoke all on function public.seller_portal_activate(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.seller_portal_activate(text,text,text,timestamptz) to service_role;

-- Housekeeping, called opportunistically by the API (about 2% of logins).
-- Keeps audit events (logins, downloads, admin actions); trims only noise.
create function public.seller_portal_prune() returns void language plpgsql security invoker set search_path='' as $$
begin
 delete from public.seller_portal_rate_limits where window_start<now()-interval '1 day';
 delete from public.seller_portal_sessions where coalesce(revoked_at,expires_at)<now()-interval '90 days';
 delete from public.seller_portal_events where event_type in ('heartbeat','page_view') and created_at<now()-interval '400 days';
 update public.seller_portal_accounts set activation_token_hash=null,activation_expires_at=null where activation_expires_at<now()-interval '7 days';
end $$;
revoke all on function public.seller_portal_prune() from public,anon,authenticated;
grant execute on function public.seller_portal_prune() to service_role;
commit;
