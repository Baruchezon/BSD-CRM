-- Transactional security regression. Uses two existing active authorized agents.
-- Every test record and permission change is rolled back; no messages are sent.
begin;
create temp table agent_security_test_ids as select
 (select id from public.profiles where role='agent_authorized' and status='active' order by id limit 1) a,
 (select id from public.profiles where role='agent_authorized' and status='active' order by id offset 1 limit 1) b,
 (select id from public.profiles where role='admin' and status='active' limit 1) admin,
 gen_random_uuid() lead_a,gen_random_uuid() lead_b,gen_random_uuid() biz,
 gen_random_uuid() match_a,gen_random_uuid() match_b;
grant select on agent_security_test_ids to authenticated;
create function pg_temp.agent_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'security regression: %',label; end if; end $$;
select pg_temp.agent_assert(a is not null and b is not null and admin is not null,'test identities exist') from agent_security_test_ids;
insert into public.leads(id,type,full_name,source,created_by,handled_by)
 select lead_a,'buyer','בדיקת הרשאות '||lead_a,'security_test',a,a from agent_security_test_ids
 union all select lead_b,'buyer','בדיקת הרשאות '||lead_b,'security_test',b,b from agent_security_test_ids;
insert into public.businesses(id,internal_name,anon_display_name,source,created_by,handled_by,distribution_status,anon_summary,anon_card_active,is_archived)
 select biz,'שם עסק חסוי לבדיקת הרשאות '||biz,'עסק אנונימי לבדיקה','security_test',admin,admin,'all_authorized','תקציר אנונימי לבדיקה',true,false from agent_security_test_ids;
insert into public.matches(id,business_id,buyer_id,created_by,status)
 select match_a,biz,lead_a,a,'התאמה חדשה' from agent_security_test_ids
 union all select match_b,biz,lead_b,b,'התאמה חדשה' from agent_security_test_ids;
insert into public.record_notes(table_name,record_id,note_text,author_id)
 select 'matches',match_a,'הערה פרטית של סוכן א',a from agent_security_test_ids
 union all select 'matches',match_b,'הערה פרטית של סוכן ב',b from agent_security_test_ids;

select set_config('request.jwt.claim.sub',a::text,true) from agent_security_test_ids;
set local role authenticated;
select pg_temp.agent_assert((select count(*)=1 from public.leads where id in (t.lead_a,t.lead_b)),'only own buyers visible') from agent_security_test_ids t;
select pg_temp.agent_assert((select count(*)=0 from public.businesses where id=t.biz),'anonymous business cannot be read from full table') from agent_security_test_ids t;
select pg_temp.agent_assert(public.get_business_access_level(biz,a)='anonymous','anonymous distribution works') from agent_security_test_ids;
select pg_temp.agent_assert((select count(*)=1 from public.matches where id in(t.match_a,t.match_b)),'only own matches visible') from agent_security_test_ids t;
select pg_temp.agent_assert((select count(*)=1 from public.record_notes where table_name='matches' and record_id in(t.match_a,t.match_b)),'only own notes visible') from agent_security_test_ids t;
update public.matches set status='ממתין לתגובה' where id=(select match_a from agent_security_test_ids);
select pg_temp.agent_assert((select status='ממתין לתגובה' from public.matches where id=t.match_a),'own match can be updated') from agent_security_test_ids t;
do $$ begin
 begin
  insert into public.matches(business_id,buyer_id,created_by,status) select biz,lead_b,a,'התאמה חדשה' from agent_security_test_ids;
  raise exception 'security regression: forged foreign buyer accepted';
 exception when insufficient_privilege then null; end;
 begin
  update public.profiles set role='admin' where id=auth.uid();
  raise exception 'security regression: self promotion accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.business_access_grants(business_id,granted_to,granted_by,access_level)
 select biz,a,admin,'full' from agent_security_test_ids;
set local role authenticated;
select pg_temp.agent_assert((select count(*)=1 from public.businesses where id=t.biz),'specific full grant opens the business') from agent_security_test_ids t;
select pg_temp.agent_assert((select count(*)=1 from public.matches where id in(t.match_a,t.match_b)),'full business grant does not open other matches') from agent_security_test_ids t;
select pg_temp.agent_assert((select count(*)=1 from public.leads where id in(t.lead_a,t.lead_b)),'full business grant does not open other buyers') from agent_security_test_ids t;
do $$ begin
 begin
  insert into public.business_access_grants(business_id,granted_to,granted_by,access_level) select biz,b,a,'full' from agent_security_test_ids;
  raise exception 'security regression: recipient regranted access';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.business_access_grants set revoked_at=now() where business_id=(select biz from agent_security_test_ids);
set local role authenticated;
select pg_temp.agent_assert((select count(*)=0 from public.businesses where id=t.biz),'revocation removes full access') from agent_security_test_ids t;
select pg_temp.agent_assert((select referred_by_agent_id=t.a from public.leads where id=t.lead_a),'original referring agent is stored') from agent_security_test_ids t;
reset role;
select set_config('request.jwt.claim.sub',admin::text,true) from agent_security_test_ids;
set local role authenticated;
select pg_temp.agent_assert((select count(*)=2 from public.matches where id in(t.match_a,t.match_b)),'admin sees both agents matches') from agent_security_test_ids t;
select pg_temp.agent_assert((select count(*)=2 from public.record_notes where table_name='matches' and record_id in(t.match_a,t.match_b)),'admin sees both agents notes') from agent_security_test_ids t;
reset role;
rollback;
