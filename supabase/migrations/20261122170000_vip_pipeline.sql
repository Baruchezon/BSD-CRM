-- VIP pipeline, 22.11.2026 (plan items ג, ה, client_profile, weekly limit, approval requests).
-- Does NOT touch business_alert_subscribers (read only). Does not send anything.
-- Rollback: rollback_20261122170000_vip_pipeline.sql

-- backups of tables that get new columns / redefined functions
create table if not exists public.business_sale_files_backup_20261122 as select * from public.business_sale_files;
alter table public.business_sale_files_backup_20261122 enable row level security;

-- (ג) VIP approval of a file: only files with vip_approved_at may be attached to a VIP email
alter table public.business_sale_files
  add column if not exists vip_approved_at timestamptz,
  add column if not exists vip_approved_by text,
  add column if not exists vip_check jsonb,
  add column if not exists vip_file_sha256 text;

create or replace function public.vip_file_approve(p_file_id uuid, p_approver text, p_check jsonb, p_sha256 text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare f public.business_sale_files%rowtype;
begin
  select * into f from public.business_sale_files where id=p_file_id for update;
  if not found or f.deleted_at is not null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if coalesce(f.document_type,'') <> 'anonymous_summary' then return jsonb_build_object('ok',false,'error','not_anonymous_summary'); end if;
  if coalesce((p_check->>'truncation_ok')::boolean,false) is not true or coalesce((p_check->>'identifiers_ok')::boolean,false) is not true then
    return jsonb_build_object('ok',false,'error','checks_not_passed'); end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'error','bad_sha'); end if;
  if coalesce(trim(p_approver),'') = '' then return jsonb_build_object('ok',false,'error','approver_required'); end if;
  update public.business_sale_files set vip_approved_at=now(), vip_approved_by=p_approver, vip_check=p_check, vip_file_sha256=p_sha256 where id=p_file_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.vip_file_revoke(p_file_id uuid, p_by text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
begin
  update public.business_sale_files set vip_approved_at=null,
    vip_check=coalesce(vip_check,'{}'::jsonb)||jsonb_build_object('revoked_by',p_by,'revoked_at',now())
  where id=p_file_id;
  return jsonb_build_object('ok',found);
end $$;

-- client_profile stage: one row per subscriber, rebuilt before every draft and every send
create table if not exists public.vip_client_profiles (
  subscriber_id uuid primary key references public.business_alert_subscribers(id),
  lead_ids uuid[] not null default '{}',
  received_business_numbers text[] not null default '{}',
  sources jsonb not null default '{}'::jsonb,
  notes_text text,
  last_vip_email_at timestamptz,
  gmail_checked boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.vip_client_profiles enable row level security;

create or replace function public.vip_build_client_profile(p_subscriber_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare s public.business_alert_subscribers%rowtype; v_leads uuid[]; v_nums text[]; v_src jsonb; v_notes text; v_last timestamptz;
  n_sends int; n_anon int; n_match int; n_meet int; n_act int; n_drafts int;
begin
  select * into s from public.business_alert_subscribers where id=p_subscriber_id;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  -- link leads by explicit ids, email and phone9
  select coalesce(array_agg(distinct l.id),'{}') into v_leads from public.leads l
   where l.id in (s.lead_id, s.buyer_id, s.crm_lead_id)
      or (coalesce(s.email,'')<>'' and lower(trim(l.email))=lower(trim(s.email)))
      or (coalesce(s.phone9,'')<>'' and (right(regexp_replace(coalesce(l.phone,''),'\D','','g'),9)=s.phone9
                                      or right(regexp_replace(coalesce(l.phone2,''),'\D','','g'),9)=s.phone9));
  with nums as (
    select x.business_number n, 'sends' src from public.business_alert_sends x where x.subscriber_id=s.id and x.status<>'failed'
    union all select b.business_number, 'anon' from public.anon_distributions a join public.businesses b on b.id=a.business_id where a.buyer_id = any(v_leads)
    union all select b.business_number, 'matches' from public.matches m join public.businesses b on b.id=m.business_id where m.buyer_id = any(v_leads)
    union all select b.business_number, 'meetings' from public.match_meetings mm join public.businesses b on b.id=mm.business_id where mm.buyer_id = any(v_leads) and mm.deleted_at is null
    union all select unnest(d.business_numbers), 'drafts' from public.vip_email_drafts d where d.subscriber_id=s.id and d.status in ('approved','sending','sent')
    union all select trim(unnest(string_to_array(regexp_replace(coalesce(l.matched_business_numbers::text,''),'[{}"\[\] ]','','g'),','))), 'lead_matched' from public.leads l where l.id = any(v_leads)
  )
  select coalesce(array_agg(distinct n) filter (where coalesce(n,'')<>''),'{}'),
         jsonb_object_agg(src, cnt) into v_nums, v_src
  from (select n, src, count(*) over (partition by src) cnt from nums) z;
  select coalesce(string_agg(t,' | '),'') into v_notes from (
    select s.looking_for t union all select s.notes union all select s.manager_notes
    union all select concat_ws(' ', l.notes, l.intake_customer_wants, l.intake_important_details, l.meeting_summary, l.intake_conversation_summary) from public.leads l where l.id = any(v_leads)
    union all select concat_ws(' ', m.buyer_response, m.notes, m.stopped_reason) from public.matches m where m.buyer_id = any(v_leads)
    union all select concat_ws(' ', al.buyer_response, al.note) from public.match_activity_log al join public.matches m on m.id=al.match_id where m.buyer_id = any(v_leads) and al.deleted_at is null
    union all select concat_ws(' ', mm.summary_text, mm.decisions, mm.notes) from public.match_meetings mm where mm.buyer_id = any(v_leads) and mm.deleted_at is null
  ) q where coalesce(trim(t),'')<>'';
  select max(sent_at) into v_last from public.vip_email_drafts where subscriber_id=s.id and status in ('sending','sent');
  insert into public.vip_client_profiles(subscriber_id,lead_ids,received_business_numbers,sources,notes_text,last_vip_email_at,updated_at)
  values (s.id, v_leads, v_nums, coalesce(v_src,'{}'::jsonb), left(v_notes,8000), v_last, now())
  on conflict (subscriber_id) do update set lead_ids=excluded.lead_ids, received_business_numbers=excluded.received_business_numbers,
    sources=excluded.sources, notes_text=excluded.notes_text, last_vip_email_at=excluded.last_vip_email_at, updated_at=now();
  return jsonb_build_object('ok',true,'lead_ids',v_leads,'received',v_nums,'sources',coalesce(v_src,'{}'::jsonb),
    'notes_text',left(v_notes,8000),'last_vip_email_at',v_last,'gmail_checked',false);
end $$;

-- approval requests to Yossi (the approver). Written for every new draft; relayed to Yossi by the parent agent / a routine.
create table if not exists public.vip_approval_requests (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references public.vip_email_drafts(id),
  subscriber_id uuid not null,
  approver text not null default 'יוסי (סמנכ"ל)',
  summary text,
  flags text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','relayed','approved','rejected','expired')),
  created_at timestamptz not null default now(),
  relayed_at timestamptz, relayed_by text,
  decided_at timestamptz, decided_by text, decision_note text
);
alter table public.vip_approval_requests enable row level security;

create or replace function public.vip_drafts_request_approval() returns trigger
language plpgsql security definer set search_path to 'pg_catalog','public' as $$
begin
  insert into public.vip_approval_requests(draft_id,subscriber_id,summary,flags)
  values (new.id,new.subscriber_id,
          new.process||' · '||array_to_string(new.business_numbers,', ')||' · '||new.subject, new.flags)
  on conflict (draft_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_vip_drafts_request_approval on public.vip_email_drafts;
create trigger trg_vip_drafts_request_approval after insert on public.vip_email_drafts
  for each row when (new.status='draft') execute function public.vip_drafts_request_approval();

-- keep the request in step with the approval decision
create or replace function public.vip_drafts_sync_request() returns trigger
language plpgsql security definer set search_path to 'pg_catalog','public' as $$
begin
  if new.status in ('approved','rejected') and old.status is distinct from new.status then
    update public.vip_approval_requests set status=new.status, decided_at=now(), decided_by=new.reviewed_by, decision_note=new.review_note
     where draft_id=new.id and status in ('pending','relayed');
  end if;
  return new;
end $$;
drop trigger if exists trg_vip_drafts_sync_request on public.vip_email_drafts;
create trigger trg_vip_drafts_sync_request after update of status on public.vip_email_drafts
  for each row execute function public.vip_drafts_sync_request();

-- (ה) Process B queue: new business and transition to all_authorized
create table if not exists public.vip_match_queue (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  reason text not null check (reason in ('created','all_authorized','manual')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  result jsonb
);
alter table public.vip_match_queue enable row level security;
create index if not exists vip_match_queue_open on public.vip_match_queue(created_at) where processed_at is null;

create or replace function public.vip_enqueue_business() returns trigger
language plpgsql security definer set search_path to 'pg_catalog','public' as $$
begin
  begin
    if tg_op='INSERT' then
      insert into public.vip_match_queue(business_id,reason) values (new.id,'created');
    elsif new.distribution_status='all_authorized' and old.distribution_status is distinct from 'all_authorized' then
      insert into public.vip_match_queue(business_id,reason) values (new.id,'all_authorized');
    end if;
  exception when others then
    raise warning 'vip_enqueue_business: %', sqlerrm;   -- never block a business write
  end;
  return new;
end $$;
drop trigger if exists trg_vip_enqueue_business on public.businesses;
create trigger trg_vip_enqueue_business after insert or update of distribution_status on public.businesses
  for each row execute function public.vip_enqueue_business();

-- eligibility + flags for a business (holds: a business not visible in public_business_listings is held)
create or replace function public.vip_business_status(p_business_id uuid)
returns jsonb language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select jsonb_build_object(
    'business_number', b.business_number,
    'eligible', (b.public_listing_active and b.anon_card_active and b.listing_status='active' and not coalesce(b.is_archived,false)
                 and b.distribution_status in ('all_authorized','selective')
                 and exists(select 1 from public.public_business_listings p where p.business_number=b.business_number)),
    'held', not exists(select 1 from public.public_business_listings p where p.business_number=b.business_number),
    'flags', to_jsonb(array_remove(array[
        case when b.distribution_status='selective' then 'selective' end,
        case when coalesce(b.agreement_status,'')<>'יש הסכם חתום' then 'no_signed_agreement' end,
        case when b.asking_price is null or b.asking_price<=0 then 'no_price' end], null)))
  from public.businesses b where b.id=p_business_id;
$$;

-- single-use run tokens for the draft builder (manual/test runs; only the sha256 is stored)
create table if not exists public.vip_digest_run_tokens (
  token_hash text primary key,
  scope jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.vip_digest_run_tokens enable row level security;
create or replace function public.vip_digest_use_token(p_token text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare r public.vip_digest_run_tokens%rowtype;
begin
  update public.vip_digest_run_tokens set used_at=now()
   where token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex') and used_at is null and expires_at>now()
  returning * into r;
  if not found then return jsonb_build_object('ok',false); end if;
  return jsonb_build_object('ok',true,'scope',r.scope);
end $$;

-- shared assets (signature logo used inline as cid:logo.png when a draft has no own copy)
create table if not exists public.vip_assets (name text primary key, b64 text not null, sha256 text not null, updated_at timestamptz not null default now());
alter table public.vip_assets enable row level security;

-- claim v2: + max 3 businesses, + 1 email per client per 7 days, + no resend via any channel (client profile),
--           + only VIP-approved files, returns files to attach and the shared logo.
create or replace function public.vip_draft_claim(p_draft_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare d public.vip_email_drafts%rowtype; s public.business_alert_subscribers%rowtype; g record; v_to text; v_dup text[]; b text;
  prof jsonb; v_files jsonb; v_bad int;
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
  if coalesce(array_length(d.business_numbers,1),0) not between 1 and 3 then
    return jsonb_build_object('ok',false,'error','businesses_count'); end if;
  if exists(select 1 from public.vip_email_drafts x where x.subscriber_id=d.subscriber_id and x.id<>d.id
            and x.status in ('sending','sent') and x.sent_at > now()-interval '7 days') then
    return jsonb_build_object('ok',false,'error','weekly_limit'); end if;
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
  prof := public.vip_build_client_profile(d.subscriber_id);
  select array_agg(n) into v_dup from jsonb_array_elements_text(prof->'received') n where n = any(d.business_numbers);
  if v_dup is not null then return jsonb_build_object('ok',false,'error','already_received_other_channel','businesses',v_dup); end if;
  select count(*) into v_bad from unnest(d.file_ids) fid left join public.business_sale_files f on f.id=fid
   where f.id is null or f.deleted_at is not null or f.vip_approved_at is null or f.vip_file_sha256 is null;
  if v_bad>0 then return jsonb_build_object('ok',false,'error','file_not_vip_approved'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'storage_path',f.storage_path,'file_name',f.file_name,'sha256',f.vip_file_sha256,'business_id',f.business_id)),'[]')
    into v_files from public.business_sale_files f where f.id = any(d.file_ids);
  foreach b in array d.business_numbers loop
    insert into public.business_alert_sends (subscriber_id,business_number,match_pct,channel,created_by,status,draft_id,subject,recipient_email,
      html_sha256,body_ref,content_source,client_profile,match_reason,approved_by,approved_at,provider,file_id,file_name)
    values (d.subscriber_id,b,coalesce((d.match_reasons->b->>'score')::int,100),'email','vip_draft_send','reserved',d.id,d.subject,v_to,d.html_sha256,'vip_email_drafts:'||d.id,
      d.content_source,d.client_profile,coalesce(d.match_reasons->b->>'text',d.match_reasons->>b),d.reviewed_by,d.reviewed_at,'resend',
      (select (e->>'id')::uuid from jsonb_array_elements(v_files) e join public.businesses bb on bb.id=(e->>'business_id')::uuid where bb.business_number=b limit 1),
      (select e->>'file_name' from jsonb_array_elements(v_files) e join public.businesses bb on bb.id=(e->>'business_id')::uuid where bb.business_number=b limit 1));
  end loop;
  update public.vip_email_drafts set status='sending', send_token_used_at=now(), sent_to=v_to where id=p_draft_id;
  return jsonb_build_object('ok',true,'to',v_to,'subject',d.subject,'html',d.html,'text',d.text_body,
    'unsubscribe_url',d.unsubscribe_url,'logo_b64',coalesce(d.inline_logo_b64,(select a.b64 from public.vip_assets a where a.name='signature_logo')),
    'html_sha256',d.html_sha256,'is_test',s.is_test,'files',v_files);
end $$;

-- finish v2: anon_distributions records the attached file when there is one
create or replace function public.vip_draft_finish(p_draft_id uuid, p_ok boolean, p_resend_id text, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare d public.vip_email_drafts%rowtype; s public.business_alert_subscribers%rowtype; b text; v_bid uuid; v_fid uuid; n int := 0;
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
      select f.id into v_fid from public.business_sale_files f where f.id = any(d.file_ids) and f.business_id=v_bid limit 1;
      if v_bid is not null then
        insert into public.anon_distributions (business_id,anon_file_id,buyer_id,sender_user_id,subject,message,channel,delivery_status,anon_file_source,
          distribution_type,summary_snapshot,sent_at)
        values (v_bid,v_fid,d.buyer_lead_id,'9f4accb4-e10d-4a54-a10b-61768f9e29c0',d.subject,
          'VIP email ('||case when v_fid is null then 'card text, no file' else 'VIP-approved file' end||'). draft '||d.id||' · sha256 '||d.html_sha256||' · resend '||coalesce(p_resend_id,''),
          'email','sent',case when v_fid is null then null else 'sale_file' end,'primary',
          coalesce(d.match_reasons->b->>'text',d.match_reasons->>b),now());
        n := n+1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok',true,'anon_distributions',n);
end $$;

revoke all on function public.vip_file_approve(uuid,text,jsonb,text), public.vip_file_revoke(uuid,text), public.vip_build_client_profile(uuid),
  public.vip_business_status(uuid), public.vip_digest_use_token(text), public.vip_draft_claim(uuid,text), public.vip_draft_finish(uuid,boolean,text,text),
  public.vip_enqueue_business(), public.vip_drafts_request_approval(), public.vip_drafts_sync_request() from public, anon, authenticated;
grant execute on function public.vip_file_approve(uuid,text,jsonb,text), public.vip_file_revoke(uuid,text), public.vip_build_client_profile(uuid),
  public.vip_business_status(uuid), public.vip_digest_use_token(text), public.vip_draft_claim(uuid,text), public.vip_draft_finish(uuid,boolean,text,text) to service_role;
