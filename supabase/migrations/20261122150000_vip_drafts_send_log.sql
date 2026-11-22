-- VIP email drafts + approved-send + full send log (plan items ד, ו; 22.11.2026)
-- Additive only. No change to business_alert_subscribers, sending_enabled, dry_run, dispatch_auth or cron.
create table if not exists public.business_alert_sends_backup_20261122 as select * from public.business_alert_sends;
create table if not exists public.anon_distributions_backup_20261122 as select * from public.anon_distributions;
alter table public.business_alert_sends_backup_20261122 enable row level security;
alter table public.anon_distributions_backup_20261122 enable row level security;

-- (ד) full logging columns
alter table public.business_alert_sends
  add column if not exists draft_id uuid,
  add column if not exists subject text,
  add column if not exists recipient_email text,
  add column if not exists html_sha256 text,
  add column if not exists body_ref text,
  add column if not exists file_id uuid,
  add column if not exists file_name text,
  add column if not exists content_source text,
  add column if not exists client_profile text,
  add column if not exists match_reason text,
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists provider text,
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by text;

-- (א/ו) drafts awaiting approval
create table if not exists public.vip_email_drafts (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.business_alert_subscribers(id),
  buyer_lead_id uuid references public.leads(id),
  process text not null default 'A_new_subscriber' check (process in ('A_new_subscriber','B_new_business','manual')),
  business_numbers text[] not null,
  match_reasons jsonb not null default '{}'::jsonb,
  content_source text not null default 'card_text' check (content_source in ('card_text','anon_file','mixed')),
  file_ids uuid[] not null default '{}',
  subject text not null,
  html text not null,
  text_body text,
  html_sha256 text not null,
  unsubscribe_url text,
  inline_logo_b64 text,
  client_profile text,
  status text not null default 'draft' check (status in ('draft','approved','rejected','sending','sent','failed')),
  flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  send_token_hash text,
  send_token_expires_at timestamptz,
  send_token_used_at timestamptz,
  sent_at timestamptz,
  sent_to text,
  resend_id text,
  error text,
  constraint vip_email_drafts_sha_ok check (html_sha256 = encode(extensions.digest(html, 'sha256'), 'hex'))
);
alter table public.vip_email_drafts enable row level security;
revoke all on public.vip_email_drafts from anon, authenticated;

create table if not exists public.vip_draft_send_control (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.vip_draft_send_control (id, enabled) values (true, false) on conflict do nothing;
alter table public.vip_draft_send_control enable row level security;
revoke all on public.vip_draft_send_control from anon, authenticated;

-- approve: freezes the exact html (sha) and issues a single-use send token (hash only stored)
create or replace function public.vip_draft_approve(p_draft_id uuid, p_approver text, p_token_hash text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare d public.vip_email_drafts%rowtype;
begin
  select * into d from public.vip_email_drafts where id = p_draft_id for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if d.status not in ('draft','approved') then return jsonb_build_object('ok',false,'error','status_'||d.status); end if;
  update public.vip_email_drafts set status='approved', reviewed_by=p_approver, reviewed_at=now(), review_note=p_note,
    send_token_hash=p_token_hash, send_token_expires_at=now()+interval '2 hours', send_token_used_at=null
  where id=p_draft_id;
  return jsonb_build_object('ok',true,'html_sha256',d.html_sha256);
end $$;

-- claim: single use; checks switch, token, sha, gate, no business resent; reserves send rows
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

revoke all on function public.vip_draft_approve(uuid,text,text,text), public.vip_draft_claim(uuid,text), public.vip_draft_finish(uuid,boolean,text,text) from public, anon, authenticated;
grant execute on function public.vip_draft_approve(uuid,text,text,text), public.vip_draft_claim(uuid,text), public.vip_draft_finish(uuid,boolean,text,text) to service_role;

-- (ד) history on the subscriber card now includes the new columns
create or replace function public.business_alert_sends_history(p_subscriber_id uuid)
returns jsonb language sql stable security definer set search_path to 'pg_catalog','public' as $function$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.sent_at desc), '[]'::jsonb)
  from (
    select d.business_number,
      (select b.internal_name from public.businesses b where b.business_number = d.business_number order by b.internal_name limit 1) as internal_name,
      d.sent_at, d.channel, d.match_pct, d.opened_at, d.replied_at,
      d.status, d.created_by, d.subject, d.recipient_email, d.content_source, d.file_name, d.approved_by, d.approved_at,
      d.resend_id, d.html_sha256, d.draft_id, d.handled_at
    from public.business_alert_sends d
    where d.subscriber_id = p_subscriber_id
  ) x;
$function$;
