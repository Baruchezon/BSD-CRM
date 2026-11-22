-- VIP file staging (22.11.2026): sanctioned route to put Yossi-approved anonymous teasers into Storage.
-- Why: the Supabase MCP can write rows but cannot upload Storage bytes. The bytes are staged here (base64-decoded
-- by execute_sql, one file per call, ~510 KB of SQL each), and the edge function vip-file-stage-upload, running
-- inside Supabase with its own SUPABASE_SERVICE_ROLE_KEY, uploads them to business-files, creates the
-- business_sale_files row (new version in the existing anonymous-summary group, portal_visible=false) and calls
-- vip_file_approve. No account credentials, no minted JWTs, no hand-written storage.objects rows.
-- Auth: same pattern as bsd-alert-digest run tokens: single-use token, only its sha256 stored, 10 min expiry.
-- The token is created and posted by vip_file_stage_dispatch() inside the DB (pg_net), so it never leaves Postgres.
-- Additive only. No change to business_alert_subscribers, sending switches, dispatch_auth, vip_draft_send_control or cron.

create table if not exists public.vip_file_staging (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  base_file_id uuid not null references public.business_sale_files(id),  -- current anon summary whose version group gets the new version
  file_name text not null check (file_name ~ '\.pdf$'),
  content bytea not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  approved_by text not null check (btrim(approved_by) <> ''),
  approved_at timestamptz not null,
  vip_check jsonb not null,
  status text not null default 'pending' check (status in ('pending','uploading','uploaded','failed','cancelled')),
  attempts int not null default 0,
  error text,
  storage_path text,
  sale_file_id uuid references public.business_sale_files(id),
  claimed_at timestamptz,
  uploaded_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vip_file_staging_sha_matches check (encode(extensions.digest(content, 'sha256'), 'hex') = sha256),
  constraint vip_file_staging_is_pdf check (substring(content from 1 for 5) = '\x255044462d'::bytea),
  constraint vip_file_staging_size check (octet_length(content) between 1024 and 10485760),
  constraint vip_file_staging_checks_passed check (
    coalesce((vip_check->>'truncation_ok')::boolean, false) and coalesce((vip_check->>'identifiers_ok')::boolean, false)),
  constraint vip_file_staging_once unique (business_id, sha256)
);
alter table public.vip_file_staging enable row level security;
revoke all on public.vip_file_staging from public, anon, authenticated;

create table if not exists public.vip_file_stage_run_tokens (
  token_hash text primary key,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by text,
  net_request_id bigint,
  created_at timestamptz not null default now()
);
alter table public.vip_file_stage_run_tokens enable row level security;
revoke all on public.vip_file_stage_run_tokens from public, anon, authenticated;

-- single use, like vip_digest_use_token
create or replace function public.vip_file_stage_use_token(p_token text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
begin
  update public.vip_file_stage_run_tokens set used_at=now()
   where token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex') and used_at is null and expires_at>now();
  return jsonb_build_object('ok', found);
end $$;

-- claims one row: pending, or 'uploading' left stale for >15 min (crash recovery; the storage_path is kept, so a retry
-- reuses the same object path). Returns the bytes as base64.
create or replace function public.vip_file_stage_claim_next()
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare r public.vip_file_staging%rowtype;
begin
  select * into r from public.vip_file_staging
   where status='pending' or (status='uploading' and claimed_at < now() - interval '15 minutes')
   order by created_at limit 1 for update skip locked;
  if not found then return jsonb_build_object('ok',true,'done',true); end if;
  if r.attempts >= 3 then
    update public.vip_file_staging set status='failed', error=coalesce(error,'')||' max_attempts', updated_at=now() where id=r.id;
    return jsonb_build_object('ok',true,'skipped',r.id);
  end if;
  update public.vip_file_staging set status='uploading', attempts=attempts+1, claimed_at=now(), updated_at=now(),
    storage_path=coalesce(storage_path, business_id::text||'/sale-file/anonymous_summary/'
      ||(extract(epoch from clock_timestamp())*1000)::bigint::text||'_'||substr(md5(gen_random_uuid()::text),1,6)||'.pdf')
   where id=r.id returning * into r;
  return jsonb_build_object('ok',true,'id',r.id,'business_id',r.business_id,'file_name',r.file_name,'sha256',r.sha256,
    'size',octet_length(r.content),'storage_path',r.storage_path,'b64',encode(r.content,'base64'));
end $$;

-- 'failed' rows are not retried automatically; after a fix: update ... set status='pending' where id=...
-- after the upload: checks the object exists with the right size, then (atomically) adds the new version row and
-- the VIP approval. Any failure rolls back the inner block and marks the staging row failed.
create or replace function public.vip_file_stage_finish(p_id uuid, p_ok boolean, p_error text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare r public.vip_file_staging%rowtype; b public.business_sale_files%rowtype; v_size bigint; v_fid uuid; v_ver int; v_ap jsonb;
begin
  select * into r from public.vip_file_staging where id=p_id for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if r.status='uploaded' then return jsonb_build_object('ok',true,'already',true,'sale_file_id',r.sale_file_id); end if;
  if r.status<>'uploading' then return jsonb_build_object('ok',false,'error','bad_status:'||r.status); end if;
  if not p_ok then
    update public.vip_file_staging set status='failed', error=left(coalesce(p_error,'upload_failed'),500), updated_at=now() where id=p_id;
    return jsonb_build_object('ok',false,'error',coalesce(p_error,'upload_failed'));
  end if;
  begin
    select (o.metadata->>'size')::bigint into v_size from storage.objects o where o.bucket_id='business-files' and o.name=r.storage_path;
    if v_size is null then raise exception 'object_missing'; end if;
    if v_size <> octet_length(r.content) then raise exception 'object_size_mismatch:%<>%', v_size, octet_length(r.content); end if;
    select * into b from public.business_sale_files where id=r.base_file_id for update;
    if not found or b.business_id<>r.business_id or b.deleted_at is not null or b.status<>'active'
       or coalesce(b.document_type,'')<>'anonymous_summary' then raise exception 'bad_base_file'; end if;
    update public.business_sale_files set version_group_id=coalesce(version_group_id,id) where id=b.id and version_group_id is null;
    b.version_group_id := coalesce(b.version_group_id, b.id);
    select coalesce(max(version_number),1)+1 into v_ver from public.business_sale_files where version_group_id=b.version_group_id;
    insert into public.business_sale_files(business_id,file_name,storage_path,file_type,file_size,category,document_type,
      confidentiality_level,source,status,portal_kind,portal_visible,uploaded_by,version_group_id,version_number)
    values (r.business_id,r.file_name,r.storage_path,'application/pdf',octet_length(r.content),'exec_summary','anonymous_summary',
      1,'manual_upload','active','document',false,null,b.version_group_id,v_ver)
    returning id into v_fid;
    v_ap := public.vip_file_approve(v_fid, r.approved_by,
      r.vip_check || jsonb_build_object('staging_id',r.id,'approved_at',r.approved_at,'storage_size_ok',true), r.sha256);
    if not coalesce((v_ap->>'ok')::boolean,false) then raise exception 'approve_failed:%', v_ap->>'error'; end if;
    update public.vip_file_staging set status='uploaded', sale_file_id=v_fid, uploaded_at=now(), error=null, updated_at=now() where id=p_id;
    return jsonb_build_object('ok',true,'sale_file_id',v_fid,'version_number',v_ver,'version_group_id',b.version_group_id);
  exception when others then
    update public.vip_file_staging set status='failed', error=left(sqlerrm,500), updated_at=now() where id=p_id;
    return jsonb_build_object('ok',false,'error',sqlerrm);
  end;
end $$;

-- the trigger we run from SQL: issues a single-use token (hash stored) and posts it to the function via pg_net.
create or replace function public.vip_file_stage_dispatch(p_by text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare v_tok text; v_req bigint; v_n int;
begin
  if coalesce(btrim(p_by),'')='' then return jsonb_build_object('ok',false,'error','by_required'); end if;
  select count(*) into v_n from public.vip_file_staging where status in ('pending','uploading');
  if v_n=0 then return jsonb_build_object('ok',true,'pending',0); end if;
  v_tok := encode(gen_random_bytes(32),'hex');
  insert into public.vip_file_stage_run_tokens(token_hash,expires_at,created_by)
    values (encode(digest(v_tok,'sha256'),'hex'), now()+interval '10 minutes', p_by);
  select net.http_post(
    url := 'https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/vip-file-stage-upload',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('run_token', v_tok),
    timeout_milliseconds := 120000) into v_req;
  update public.vip_file_stage_run_tokens set net_request_id=v_req where token_hash=encode(digest(v_tok,'sha256'),'hex');
  return jsonb_build_object('ok',true,'pending',v_n,'net_request_id',v_req);
end $$;

revoke all on function public.vip_file_stage_use_token(text), public.vip_file_stage_claim_next(),
  public.vip_file_stage_finish(uuid,boolean,text), public.vip_file_stage_dispatch(text) from public, anon, authenticated;
grant execute on function public.vip_file_stage_use_token(text), public.vip_file_stage_claim_next(),
  public.vip_file_stage_finish(uuid,boolean,text) to service_role;
-- vip_file_stage_dispatch: no grant; only the postgres owner (execute_sql / migration) can run it.
