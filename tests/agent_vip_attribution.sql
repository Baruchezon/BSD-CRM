begin;
create temp table vip_security_test_ids as select
 (select id from public.profiles where role='agent_authorized' and status='active' order by id limit 1) a,
 (select id from public.profiles where role='agent_authorized' and status='active' order by id offset 1 limit 1) b,
 gen_random_uuid() lead,gen_random_uuid() subscriber,gen_random_uuid() forwarded,
 gen_random_uuid() invite,gen_random_uuid() competing,gen_random_uuid() forwarding;
create function pg_temp.vip_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'VIP security regression: %',label; end if; end $$;
insert into public.leads(id,type,full_name,email,source,created_by,handled_by,dedupe_override_reason)
 select lead,'buyer','בדיקת VIP '||lead,subscriber||'@example.com','security_test',a,a,'בדיקה בתוך טרנזקציה שמתבטלת' from vip_security_test_ids;
insert into public.business_alert_subscribers(id,first_name,last_name,phone,email,status,source,created_at,is_test,consent_email,consent_whatsapp,consent_general)
 select subscriber,'בדיקה',subscriber::text,'',subscriber||'@example.com','pending_consent','website',now(),true,false,false,false from vip_security_test_ids
 union all select forwarded,'בדיקה',forwarded::text,'',forwarded||'@example.com','pending_consent','website',now(),true,false,false,false from vip_security_test_ids;
insert into public.business_alert_invites(id,buyer_id,channel,token,token_hash,prefill,status,sent_at,expires_at,invited_by,created_by)
 select invite,lead,'whatsapp',invite::text,invite::text,jsonb_build_object('email',subscriber||'@example.com'),'sent',now()-interval '1 minute',now()+interval '1 day','agent',a from vip_security_test_ids
 union all select competing,lead,'whatsapp',competing::text,competing::text,jsonb_build_object('email',subscriber||'@example.com'),'sent',now()-interval '1 minute',now()+interval '1 day','agent',b from vip_security_test_ids
 union all select forwarding,lead,'whatsapp',forwarding::text,forwarding::text,jsonb_build_object('email',subscriber||'@example.com'),'sent',now()-interval '1 minute',now()+interval '1 day','agent',a from vip_security_test_ids;
select public.business_alert_complete_invite(invite,subscriber,true) from vip_security_test_ids;
select pg_temp.vip_assert((select owner_id=t.a and referred_by_agent_id=t.a and crm_lead_id=t.lead from public.business_alert_subscribers where id=t.subscriber),'new invite is attributed and linked to its agent') from vip_security_test_ids t;
select pg_temp.vip_assert((select count(*)=1 from public.business_alert_agent_subscriber_ids(t.a) id where id=t.subscriber),'referring agent sees their new subscriber') from vip_security_test_ids t;
select pg_temp.vip_assert((select count(*)=0 from public.business_alert_agent_subscriber_ids(t.b) id where id=t.subscriber),'another agent cannot see subscriber') from vip_security_test_ids t;
select public.business_alert_complete_invite(competing,subscriber,false) from vip_security_test_ids;
select pg_temp.vip_assert((select owner_id=t.a and referred_by_agent_id=t.a from public.business_alert_subscribers where id=t.subscriber),'repeat invite cannot steal original attribution') from vip_security_test_ids t;
select public.business_alert_complete_invite(forwarding,forwarded,true) from vip_security_test_ids;
select pg_temp.vip_assert((select owner_id=t.a and crm_lead_id is null and buyer_id is null from public.business_alert_subscribers where id=t.forwarded),'forwarded link cannot attach a different person to the original buyer card') from vip_security_test_ids t;
do $$ declare actor uuid; begin
 select a into actor from vip_security_test_ids;
 begin
  perform public.business_alert_staff_add(actor,jsonb_build_object('p_consent_email',true));
  raise exception 'VIP security regression: consent without evidence accepted';
 exception when invalid_parameter_value then null; end;
end $$;
rollback;
