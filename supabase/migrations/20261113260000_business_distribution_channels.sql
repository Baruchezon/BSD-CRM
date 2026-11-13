-- Per-business distribution channels. Unchecking stops a channel. Nothing is deleted.
-- marketing_service_active is only read. This file does not change that column.
-- Rollback: supabase/migrations/rollback_20261113260000_business_distribution_channels.sql

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'distribution_agent') then
    create role distribution_agent nologin;
  end if;
end $$;

alter table public.businesses
  add column if not exists media_drive_folder_url text;

comment on column public.businesses.media_drive_folder_url is
  'Optional Google Drive folder of images for distribution. Not a marketing flag.';

create table if not exists public.business_distribution_channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  channel text not null,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by text,
  status text not null default 'pending',
  handled_at timestamptz,
  handled_by_agent text,
  notes text,
  updated_at timestamptz not null default now(),
  constraint business_distribution_channels_channel_check
    check (channel in ('facebook', 'instagram', 'website', 'email_alerts', 'vip', 'whatsapp')),
  constraint business_distribution_channels_status_check
    check (status in ('pending', 'in_progress', 'done', 'stopped')),
  constraint business_distribution_channels_business_channel_key
    unique (business_id, channel)
);

create table if not exists public.business_distribution_channel_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  channel text not null,
  at timestamptz not null default now(),
  actor text,
  previous jsonb not null default '{}'::jsonb,
  next jsonb not null default '{}'::jsonb
);

alter table public.business_distribution_channels enable row level security;
alter table public.business_distribution_channel_history enable row level security;

revoke all on public.business_distribution_channels from public, anon, authenticated, service_role;
revoke all on public.business_distribution_channel_history from public, anon, authenticated, service_role;
grant select, insert, update on public.business_distribution_channels to service_role;
grant select, insert on public.business_distribution_channel_history to service_role;

create or replace function public.business_distribution_require_staff()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role in ('admin', 'manager')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.business_distribution_list(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.business_distribution_require_staff();
  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c.channel)
    from public.business_distribution_channels c
    where c.business_id = p_business_id
  ), '[]'::jsonb);
end;
$$;

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

create or replace function public.business_distribution_facebook_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.enabled_at), '[]'::jsonb)
    from (
      select
        b.business_number,
        case
          when nullif(btrim(coalesce(b.anon_display_name, '')), '') is null then 'הזדמנות עסקית'
          when b.anon_display_name = b.internal_name then 'הזדמנות עסקית'
          else b.anon_display_name
        end as anonymous_title,
        b.category,
        b.subcategory,
        b.region,
        c.enabled_at,
        b.media_drive_folder_url
      from public.business_distribution_channels c
      join public.businesses b on b.id = c.business_id
      where c.channel = 'facebook'
        and c.enabled is true
        and c.status = 'pending'
    ) x
  );
end;
$$;

create or replace function public.business_distribution_facebook_update(
  p_business_id uuid,
  p_status text,
  p_notes text,
  p_actor text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prev public.business_distribution_channels%rowtype;
  v_status text := btrim(coalesce(p_status, ''));
  v_next jsonb;
begin
  if v_status not in ('in_progress', 'done') then
    raise exception 'status' using errcode = '22023';
  end if;
  select * into v_prev
  from public.business_distribution_channels
  where business_id = p_business_id and channel = 'facebook' and enabled is true;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  update public.business_distribution_channels
  set status = v_status,
      notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes),
      handled_at = now(),
      handled_by_agent = nullif(btrim(coalesce(p_actor, '')), ''),
      updated_at = now()
  where business_id = p_business_id and channel = 'facebook';
  select to_jsonb(c) into v_next
  from public.business_distribution_channels c
  where c.business_id = p_business_id and c.channel = 'facebook';
  insert into public.business_distribution_channel_history (business_id, channel, actor, previous, next)
  values (p_business_id, 'facebook', nullif(btrim(coalesce(p_actor, '')), ''), to_jsonb(v_prev), v_next);
  return v_next;
end;
$$;

revoke all on function public.business_distribution_require_staff() from public, anon, authenticated;
revoke all on function public.business_distribution_list(uuid) from public, anon, authenticated;
revoke all on function public.business_distribution_set(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.business_distribution_facebook_queue() from public, anon, authenticated, distribution_agent;
revoke all on function public.business_distribution_facebook_update(uuid, text, text, text) from public, anon, authenticated, distribution_agent;

grant execute on function public.business_distribution_list(uuid) to service_role, authenticated;
grant execute on function public.business_distribution_set(uuid, text, boolean, text) to service_role, authenticated;
grant execute on function public.business_distribution_facebook_queue() to service_role, distribution_agent;
grant execute on function public.business_distribution_facebook_update(uuid, text, text, text) to service_role, distribution_agent;

-- Website is not a second flag. The הפצה checkbox updates public_listing_active,
-- so set_public_listing_published_at and the anon-identifier guard still run.
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
$$;

create table if not exists public.business_distribution_notify_log (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  event text not null,
  business_id uuid,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_distribution_notify_log_event_check check (event in ('checked', 'unchecked')),
  constraint business_distribution_notify_log_status_check check (status in ('pending', 'logged', 'sent', 'failed'))
);

alter table public.business_distribution_notify_log enable row level security;
revoke all on public.business_distribution_notify_log from public, anon, authenticated;
grant select, insert, update on public.business_distribution_notify_log to service_role;

create or replace function public.business_distribution_enqueue_notify(
  p_channel text,
  p_event text,
  p_business_id uuid,
  p_actor text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_payload jsonb;
  v_log uuid;
  v_secret text := null;
  v_url text := 'https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/distribution-channel-notify';
begin
  if current_setting('bsd.skip_distribution_notify', true) = 'on' then
    return;
  end if;

  select jsonb_build_object(
    'event', p_event,
    'channel', p_channel,
    'business_number', b.business_number,
    'anonymous_title', coalesce(
      nullif(btrim(coalesce(b.anonymous_name, '')), ''),
      nullif(btrim(coalesce(b.anon_display_name, '')), ''),
      nullif(btrim(coalesce(b.category, '')), ''),
      'הזדמנות עסקית'
    ),
    'category', b.category,
    'region', b.region,
    'changed_at', to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'changed_by', coalesce(nullif(btrim(coalesce(p_actor, '')), ''), nullif(current_setting('bsd.distribution_actor', true), ''), current_user),
    'drive_folder_url', b.media_drive_folder_url
  )
  into v_payload
  from public.businesses b
  where b.id = p_business_id;

  insert into public.business_distribution_notify_log (channel, event, business_id, payload)
  values (p_channel, p_event, p_business_id, coalesce(v_payload, '{}'::jsonb))
  returning id into v_log;

  v_payload := v_payload || jsonb_build_object('log_id', v_log);

  begin
    if to_regnamespace('net') is not null and to_regclass('vault.decrypted_secrets') is not null then
      select decrypted_secret into v_secret
      from vault.decrypted_secrets
      where name = 'DISTRIBUTION_NOTIFY_SECRET'
      limit 1;
    end if;
    if to_regnamespace('net') is not null and v_secret is not null then
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-distribution-secret', v_secret
        ),
        body := v_payload,
        timeout_milliseconds := 5000
      );
    end if;
  exception when others then
    update public.business_distribution_notify_log
    set last_error = sqlerrm, updated_at = now()
    where id = v_log;
  end;
exception when others then
  return;
end;
$$;

create or replace function public.business_distribution_notify_facebook()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event text;
begin
  if tg_op = 'UPDATE' and new.enabled is not distinct from old.enabled then
    return new;
  end if;
  if new.channel is distinct from 'facebook' then
    return new;
  end if;
  v_event := case when new.enabled is true then 'checked' else 'unchecked' end;
  perform public.business_distribution_enqueue_notify(new.channel, v_event, new.business_id, new.enabled_by);
  return new;
end;
$$;

drop trigger if exists trg_business_distribution_facebook_notify on public.business_distribution_channels;
create trigger trg_business_distribution_facebook_notify
after insert or update of enabled, status on public.business_distribution_channels
for each row
execute function public.business_distribution_notify_facebook();

create or replace function public.business_distribution_notify_website()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event text;
begin
  if new.public_listing_active is not distinct from old.public_listing_active then
    return new;
  end if;
  v_event := case when new.public_listing_active is true then 'checked' else 'unchecked' end;
  perform public.business_distribution_enqueue_notify('website', v_event, new.id, current_setting('bsd.distribution_actor', true));
  return new;
end;
$$;

drop trigger if exists trg_business_distribution_website_notify on public.businesses;
create trigger trg_business_distribution_website_notify
after update of public_listing_active on public.businesses
for each row
when (old.public_listing_active is distinct from new.public_listing_active)
execute function public.business_distribution_notify_website();

create or replace function public.business_distribution_facebook_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.business_distribution_require_staff();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.business_number)
    from (
      select
        b.id,
        b.business_number,
        coalesce(c.enabled, false) as facebook_enabled,
        c.status as facebook_status,
        c.enabled_at,
        c.enabled_by
      from public.businesses b
      left join public.business_distribution_channels c
        on c.business_id = b.id and c.channel = 'facebook'
      where b.is_archived is not true
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.business_distribution_facebook_report() from public, anon, authenticated;
grant execute on function public.business_distribution_facebook_report() to service_role, authenticated;
revoke all on function public.business_distribution_enqueue_notify(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.business_distribution_notify_facebook() from public, anon, authenticated;
revoke all on function public.business_distribution_notify_website() from public, anon, authenticated;

-- Seed four facebook rows only. Do not write public_listing_active.
-- This insert does not call business_distribution_set, so marketing_service_active
-- does not block it. That guard stays on the card toggle only.
-- The session flag keeps the trigger from notifying.
select set_config('bsd.skip_distribution_notify', 'on', true);

insert into public.business_distribution_channels (
  business_id, channel, enabled, enabled_at, enabled_by, status, updated_at
)
select b.id, 'facebook', true, now(), 'seed', 'pending', now()
from public.businesses b
where b.business_number in (
  'BSD-B-2610-1109',
  'BSD-B-2607-1002',
  'BSD-B-2609-1077',
  'BSD-B-2610-1104'
)
on conflict (business_id, channel) do nothing;

commit;
