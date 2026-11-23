-- Exercises both agent roles without granting permanent creation permissions.
begin;
create temp table origin_test_ids as select
 (select id from public.profiles where role='agent' and status='active' order by id limit 1) regular,
 (select id from public.profiles where role='agent_authorized' and status='active' order by id limit 1) authorized,
 (select id from public.profiles where role='admin' and status='active' limit 1) admin,
 gen_random_uuid() lead,gen_random_uuid() business;
grant select on origin_test_ids to authenticated;
create function pg_temp.origin_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'origin regression: %',label; end if; end $$;
select pg_temp.origin_assert(regular is not null and authorized is not null and admin is not null,'test users exist') from origin_test_ids;
update public.profiles set can_create_buyers=true,can_create_businesses=true where id=(select regular from origin_test_ids);
select set_config('request.jwt.claim.sub',regular::text,true) from origin_test_ids;
set local role authenticated;
insert into public.leads(id,type,full_name,source,created_by,handled_by,referred_by_agent_id,referred_by_agent_name,dedupe_override_reason)
 select lead,'buyer','בדיקת מקור '||lead,'facebook',admin,admin,authorized,'שם מזויף','בדיקה בתוך טרנזקציה שמתבטלת' from origin_test_ids;
select pg_temp.origin_assert((select referred_by_agent_id=t.regular and referred_by_agent_name is not null and created_by=t.regular and origin_entered_by_id=t.regular from public.leads where id=t.lead),'regular agent attribution overrides a forged payload') from origin_test_ids t;
update public.leads set source='טלפון',referred_by_agent_id=null,referred_by_agent_name=null where id=(select lead from origin_test_ids);
select pg_temp.origin_assert((select referred_by_agent_id=t.regular and original_source='facebook' from public.leads where id=t.lead),'routine edits preserve first agent and channel') from origin_test_ids t;
reset role;
select set_config('request.jwt.claim.sub',admin::text,true) from origin_test_ids;
update public.leads set handled_by=(select admin from origin_test_ids) where id=(select lead from origin_test_ids);
insert into public.businesses(id,internal_name,seller_id,created_by,handled_by)
 select business,'בדיקת מקור עסק '||business,lead,admin,admin from origin_test_ids;
select pg_temp.origin_assert((select referred_by_agent_id=t.regular and origin_entered_by_id=t.regular and original_source='facebook' from public.businesses where id=t.business),'lead conversion preserves referring agent despite admin transfer') from origin_test_ids t;
select set_config('request.jwt.claim.sub','',true);
insert into public.leads(type,full_name,source,dedupe_override_reason) values('buyer','בדיקת פייסבוק '||gen_random_uuid(),'facebook','בדיקה בתוך טרנזקציה שמתבטלת');
insert into public.businesses(internal_name,source,handled_by) select 'בדיקת מקור קיים '||business,'facebook',regular from origin_test_ids;
select set_config('request.jwt.claim.sub',regular::text,true) from origin_test_ids;
set local role authenticated;
update public.businesses set origin_entered_by_id=(select authorized from origin_test_ids),origin_entered_by_name='שם מזויף' where internal_name=(select 'בדיקת מקור קיים '||business from origin_test_ids);
select pg_temp.origin_assert((select origin_entered_by_id is null and origin_entered_by_name is null from public.businesses where internal_name='בדיקת מקור קיים '||t.business),'unknown creator cannot be forged on an existing record') from origin_test_ids t;
reset role;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin
  insert into public.leads(type,full_name) values('buyer','מקור חסר '||gen_random_uuid());
  raise exception 'origin regression: a new untraceable record was accepted';
 exception when check_violation then null; end;
end $$;
rollback;
