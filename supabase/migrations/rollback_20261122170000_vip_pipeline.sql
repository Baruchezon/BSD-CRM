-- Rollback for 20261122170000_vip_pipeline.sql. Keeps all tables, columns and rows (no history deleted).
drop trigger if exists trg_vip_enqueue_business on public.businesses;
drop trigger if exists trg_vip_drafts_request_approval on public.vip_email_drafts;
drop trigger if exists trg_vip_drafts_sync_request on public.vip_email_drafts;
drop function if exists public.vip_enqueue_business();
drop function if exists public.vip_drafts_request_approval();
drop function if exists public.vip_drafts_sync_request();
drop function if exists public.vip_file_approve(uuid,text,jsonb,text);
drop function if exists public.vip_file_revoke(uuid,text);
drop function if exists public.vip_build_client_profile(uuid);
drop function if exists public.vip_business_status(uuid);
drop function if exists public.vip_digest_use_token(text);
update public.vip_draft_send_control set enabled=false where id;
-- restore claim/finish v1
create or replace function public.vip_draft_claim(p_draft_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare d public.vip_email_drafts%rowtype; s public.business_alert_subscribers%rowtype; g record; v_to text; v_dup text[]; b text;
begin
  if not coalesce((select enabled from public.vip_draft_send_control where id), false) then
    return jsonb_build_object('ok',false,'error','send_disabled'); end if;
  select * into d from public.vip_email_drafts where id=p_draft_id for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if d.status <> 'approved' then return jsonb_build_object('ok',false,'error','status_'||d.status); end if;
  if d.send_token_hash is null or d.send_token_used_at is not null or d.send_token_expires_at < now()
     or encode(digest(coalesce(p_token,''),'sha256'),'hex') <> d.send_token_hash then
    return jsonb_build_object('ok',false,'error','bad_token'); end if;
  if encode(digest(d.html,'sha256'),'hex') <> d.html_sha256 then
    return jsonb_build_object('ok',false,'error','sha_mismatch'); end if;
  select * into s from public.business_alert_subscribers where id=d.subscriber_id;
  if s.is_test then
    v_to := 'delivered@resend.dev';   -- test rows never reach a person
  else
    select * into g from public.business_alert_gate_send(d.subscriber_id,'email','manual',null,null);
    if not g.allowed then
      update public.vip_email_drafts set error='gate_'||g.reason where id=p_draft_id;
      return jsonb_build_object('ok',false,'error','gate_'||g.reason); end if;
    v_to := s.email;
  end if;
  select array_agg(x.business_number) into v_dup from public.business_alert_sends x
   where x.subscriber_id=d.subscriber_id and x.business_number = any(d.business_numbers);
  if v_dup is not null then return jsonb_build_object('ok',false,'error','already_sent','businesses',v_dup); end if;
  foreach b in array d.business_numbers loop
    insert into public.business_alert_sends (subscriber_id,business_number,match_pct,channel,created_by,status,draft_id,subject,recipient_email,
      html_sha256,body_ref,content_source,client_profile,match_reason,approved_by,approved_at,provider)
    values (d.subscriber_id,b,100,'email','vip_draft_send','reserved',d.id,d.subject,v_to,d.html_sha256,'vip_email_drafts:'||d.id,
      d.content_source,d.client_profile,d.match_reasons->>b,d.reviewed_by,d.reviewed_at,'resend');
  end loop;
  update public.vip_email_drafts set status='sending', send_token_used_at=now(), sent_to=v_to where id=p_draft_id;
  return jsonb_build_object('ok',true,'to',v_to,'subject',d.subject,'html',d.html,'text',d.text_body,
    'unsubscribe_url',d.unsubscribe_url,'logo_b64',d.inline_logo_b64,'html_sha256',d.html_sha256,'is_test',s.is_test);
end $$;

-- finish: records provider id; logs anon_distributions (also for text-only sends)
create or replace function public.vip_draft_finish(p_draft_id uuid, p_ok boolean, p_resend_id text, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare d public.vip_email_drafts%rowtype; s public.business_alert_subscribers%rowtype; b text; v_bid uuid; n int := 0;
begin
  select * into d from public.vip_email_drafts where id=p_draft_id for update;
  if not found or d.status <> 'sending' then return jsonb_build_object('ok',false,'error','not_sending'); end if;
  select * into s from public.business_alert_subscribers where id=d.subscriber_id;
  update public.business_alert_sends set status = case when p_ok then 'sent' else 'failed' end, resend_id=p_resend_id, sent_at=now(),
    handled_at = case when p_ok then now() end, handled_by = case when p_ok then 'vip_draft_send' end
   where draft_id=p_draft_id;
  update public.vip_email_drafts set status = case when p_ok then 'sent' else 'failed' end, sent_at = case when p_ok then now() end,
    resend_id=p_resend_id, error=p_error where id=p_draft_id;
  if p_ok and not s.is_test and d.buyer_lead_id is not null then
    foreach b in array d.business_numbers loop
      select id into v_bid from public.businesses where business_number=b limit 1;
      if v_bid is not null then
        insert into public.anon_distributions (business_id,buyer_id,sender_user_id,subject,message,channel,delivery_status,anon_file_source,
          distribution_type,summary_snapshot,sent_at)
        values (v_bid,d.buyer_lead_id,'9f4accb4-e10d-4a54-a10b-61768f9e29c0',d.subject,
          'VIP email (card text, no file). draft '||d.id||' · sha256 '||d.html_sha256||' · resend '||coalesce(p_resend_id,''),
          'email','sent',null,'primary',d.match_reasons->>b,now());
        n := n+1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok',true,'anon_distributions',n);
end $$;


revoke all on function public.vip_draft_claim(uuid,text), public.vip_draft_finish(uuid,boolean,text,text) from public, anon, authenticated;
grant execute on function public.vip_draft_claim(uuid,text), public.vip_draft_finish(uuid,boolean,text,text) to service_role;
