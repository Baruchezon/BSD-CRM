-- Rollback for 20261116110000_distribution_channel_toggles.sql.
-- Restores business_distribution_set exactly as it was live on 16.11.2026 10:5x (Asia/Jerusalem),
-- read with pg_get_functiondef before the change: switching ON requires marketing_service_active.
-- Channel rows and history written meanwhile are kept (nothing is deleted).

begin;

create or replace function public.business_distribution_set(p_business_id uuid, p_channel text, p_enabled boolean, p_actor text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_channel text := btrim(coalesce(p_channel, ''));
  v_marketing boolean;
  v_prev public.business_distribution_channels%rowtype;
  v_next jsonb;
begin
  perform public.business_distribution_require_staff();
  if v_channel not in ('facebook', 'instagram', 'website', 'email_alerts', 'vip', 'whatsapp') then
    raise exception 'channel' using errcode = '22023';
  end if;
  select b.marketing_service_active into v_marketing
  from public.businesses b
  where b.id = p_business_id;
  if not found then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  if p_enabled is true and v_marketing is not true then
    raise exception 'marketing_inactive' using errcode = '42501';
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
$function$;

commit;
