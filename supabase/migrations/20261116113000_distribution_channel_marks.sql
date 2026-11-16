-- 16.11.2026 (Baruch 10:57, approved): every distribution channel is a plain checkbox mark in the CRM,
-- including vip and whatsapp. Only business_distribution_set is replaced: the 'channel_paused' refusal
-- for vip/whatsapp is removed. Staff check (admin/manager), website rule, upsert and history row are unchanged.
-- Marking is inert: verified 16.11.2026 that nothing reads these rows except the list/report/facebook-queue
-- functions, the only trigger is the facebook-only notify (Adam), no cron job and no edge function other than
-- distribution-channel-notify touches the table. vip_send_enabled / sending_enabled / dry_run /
-- request_details_enabled and WhatsApp 077 / Meta are not touched.
-- Rollback: supabase/migrations/rollback_20261116113000_distribution_channel_marks.sql

begin;

create or replace function public.business_distribution_set(
  p_business_id uuid,
  p_channel text,
  p_enabled boolean,
  p_actor text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_channel text := btrim(coalesce(p_channel, ''));
  v_prev public.business_distribution_channels%rowtype;
  v_next jsonb;
begin
  perform public.business_distribution_require_staff();
  if v_channel not in ('facebook', 'instagram', 'website', 'email_alerts', 'vip', 'whatsapp') then
    raise exception 'channel' using errcode = '22023';
  end if;
  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'business not found' using errcode = 'P0002';
  end if;

  if v_channel = 'website' then
    raise exception 'website uses public_listing_active' using errcode = '22023';
  end if;

  select * into v_prev
  from public.business_distribution_channels
  where business_id = p_business_id and channel = v_channel;

  if p_enabled is true and v_prev.enabled is true then
    return to_jsonb(v_prev);
  end if;

  insert into public.business_distribution_channels (
    business_id, channel, enabled, enabled_at, enabled_by, status, updated_at
  ) values (
    p_business_id, v_channel, p_enabled is true,
    case when p_enabled is true then now() else null end,
    case when p_enabled is true then nullif(btrim(coalesce(p_actor, '')), '') else null end,
    case when p_enabled is true then 'pending' else 'stopped' end,
    now()
  )
  on conflict (business_id, channel) do update
  set enabled = excluded.enabled,
      enabled_at = case when excluded.enabled then now() else business_distribution_channels.enabled_at end,
      enabled_by = case when excluded.enabled then excluded.enabled_by else business_distribution_channels.enabled_by end,
      status = case when excluded.enabled then 'pending' else 'stopped' end,
      updated_at = now();

  select to_jsonb(c) into v_next
  from public.business_distribution_channels c
  where c.business_id = p_business_id and c.channel = v_channel;

  insert into public.business_distribution_channel_history (business_id, channel, actor, previous, next)
  values (
    p_business_id,
    v_channel,
    nullif(btrim(coalesce(p_actor, '')), ''),
    case when v_prev.id is null then '{}'::jsonb else to_jsonb(v_prev) end,
    v_next
  );

  return v_next;
end;
$$;

revoke all on function public.business_distribution_set(uuid, text, boolean, text) from public, anon;
grant execute on function public.business_distribution_set(uuid, text, boolean, text) to service_role, authenticated;

commit;
