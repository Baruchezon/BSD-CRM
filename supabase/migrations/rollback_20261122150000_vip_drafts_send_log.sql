-- Rollback for 20261122150000_vip_drafts_send_log. Keeps all rows that were logged.
create or replace function public.business_alert_sends_history(p_subscriber_id uuid)
returns jsonb language sql stable security definer set search_path to 'pg_catalog','public' as $function$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.sent_at desc), '[]'::jsonb)
  from (select d.business_number,
      (select b.internal_name from public.businesses b where b.business_number = d.business_number order by b.internal_name limit 1) as internal_name,
      d.sent_at, d.channel, d.match_pct, d.opened_at, d.replied_at
    from public.business_alert_sends d where d.subscriber_id = p_subscriber_id) x;
$function$;
update public.vip_draft_send_control set enabled=false;
drop function if exists public.vip_draft_claim(uuid,text);
drop function if exists public.vip_draft_finish(uuid,boolean,text,text);
drop function if exists public.vip_draft_approve(uuid,text,text,text);
-- Only if no draft was ever sent (otherwise keep the tables and columns as history):
-- drop table public.vip_email_drafts; drop table public.vip_draft_send_control;
-- alter table public.business_alert_sends drop column draft_id, drop column subject, ... (new columns only)
