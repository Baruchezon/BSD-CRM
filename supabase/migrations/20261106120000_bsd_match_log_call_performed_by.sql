-- Seller portal: remember who logged a match call.
-- Additive. Rollback: re-apply supabase/migrations/20261020120000_add_bsd_match_log_call.sql
-- (that version inserts into match_activity_log without performed_by).
-- created_by is optional. The portal reads profiles.full_name for performed_by, else created_by.

alter table public.match_activity_log
  add column if not exists created_by uuid references public.profiles(id);

comment on column public.match_activity_log.created_by is
  'Staff profile that created the row, when recorded. The seller portal shows full_name only.';

create or replace function public.bsd_match_log_call(p_match uuid, p_call_at timestamptz, p_topic text, p_shared text, p_buyer_response text, p_follow_up date, p_visible boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m record; v_id uuid; v_desc text; v_lead jsonb;
begin
  if p_visible is null then raise exception 'p_visible is required (true = shown to the business owner)'; end if;
  if coalesce(trim(p_topic),'')='' and coalesce(trim(p_shared),'')='' and coalesce(trim(p_buyer_response),'')='' then raise exception 'empty call'; end if;
  select id, buyer_id, business_id, counterparty_type into m from matches where id=p_match;
  if m.id is null then return jsonb_build_object('ok',false,'reason','match_not_found'); end if;
  v_desc := trim(coalesce(p_topic,''));
  if coalesce(trim(p_shared),'')<>'' then v_desc := v_desc || E'\nמה מסרנו: ' || trim(p_shared); end if;
  insert into match_activity_log(match_id, occurred_at, action_type, description, buyer_response, follow_up_date, visible_to_client, performed_by)
  values (m.id, coalesce(p_call_at, now()), 'שיחה', v_desc, nullif(trim(coalesce(p_buyer_response,'')),''), p_follow_up, p_visible, auth.uid())
  returning id into v_id;
  -- Same call also updates the buyer's lead (existing RPC, unchanged): last_call_at / next_call_due.
  if m.buyer_id is not null then v_lead := bsd_lead_log_call(m.buyer_id::text, coalesce(p_call_at, now()), p_follow_up, null); end if;
  return jsonb_build_object('ok',true,'activity_id',v_id,'match_id',m.id,'business_id',m.business_id,'lead',v_lead);
end $$;

revoke all on function public.bsd_match_log_call(uuid,timestamptz,text,text,text,date,boolean) from public, anon, authenticated;
grant execute on function public.bsd_match_log_call(uuid,timestamptz,text,text,text,date,boolean) to service_role;
