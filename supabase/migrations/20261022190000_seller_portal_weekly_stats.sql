-- «בשבוע האחרון» and «פרסומי מדיה» for the seller portal.
-- Real counts only. This job computes rows; it sends nothing and reminds no one.
-- Rollback: supabase/migrations/rollback_20261022190000_seller_portal_weekly_stats.sql
--
-- Site numbers come from site_analytics_events (www.bsd-bbi.co.il). business_id on
-- that table is empty, so a business page is matched by its BSD-B number in the URL.
--
-- Facebook is not queried. Adam's posting log (the CSV on the distribution machine;
-- columns business, datetime, group, url, members, status, set_id) must be synced
-- into public.business_facebook_posts before the portal can show it. Upsert on
-- source_key = business || '|' || datetime || '|' || coalesce(url, group).
-- Read datetime as Asia/Jerusalem. Set business_id from businesses.business_number
-- when it matches. Brand rows (BSD-brand-*) stay unattached and are not shown.
-- Only status whose first word is active or published is counted.
--
-- impressions is nullable on purpose. Leave it null until Adam types a real Meta
-- number for that post. Do not store 0 for "unknown". The portal hides the
-- impressions metric and the column unless the value is greater than 0.
-- Keep the number on this table; do not add a second impressions table.
--
-- After a sync, or after filling impressions:
--   select public.refresh_seller_portal_weekly_stats(true);
-- The daily cron is a no-op until the last run is at least 70 hours old.

create table if not exists public.business_facebook_posts (
  id uuid primary key default gen_random_uuid(),
  business_number text not null,
  business_id uuid references public.businesses(id) on delete set null,
  posted_at timestamptz not null,
  platform text not null default 'facebook',
  group_name text not null,
  post_url text,
  member_count integer not null check (member_count >= 0),
  status text not null,
  set_id text,
  impressions integer check (impressions >= 0),
  source_key text not null unique,
  synced_at timestamptz not null default now()
);
create index if not exists business_facebook_posts_biz_idx
  on public.business_facebook_posts (business_id, posted_at);
alter table public.business_facebook_posts enable row level security;
drop policy if exists bfp_staff_all on public.business_facebook_posts;
create policy bfp_staff_all on public.business_facebook_posts
  for all to authenticated
  using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

create table if not exists public.seller_portal_weekly_stats (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  site_visitors integer not null default 0,
  for_sale_views integer not null default 0,
  for_sale_visitors integer not null default 0,
  business_views integer not null default 0,
  business_visitors integer not null default 0,
  facebook_group_posts integer not null default 0,
  facebook_group_members integer not null default 0,
  facebook_impressions integer check (facebook_impressions >= 0),
  facebook_scope text not null default 'none' check (facebook_scope in ('none', 'week', 'latest')),
  facebook_posts jsonb not null default '[]'::jsonb,
  window_start timestamptz not null,
  window_end timestamptz not null,
  computed_at timestamptz not null default now()
);
alter table public.seller_portal_weekly_stats enable row level security;

create or replace function public.refresh_seller_portal_weekly_stats(force boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  t_end timestamptz := now();
  t_start timestamptz := now() - interval '7 days';
begin
  if not force and exists (
    select 1 from seller_portal_weekly_stats
    where computed_at > now() - interval '70 hours'
  ) then
    return 0;
  end if;

  with ev as (
    select visitor_id, lower(page_path) as p
    from site_analytics_events
    where event_name = 'page_view'
      and created_at >= t_start
      and created_at < t_end
  ), fs as (
    select * from ev
    where p like '/%d7%a2%d7%a1%d7%a7%d7%99%d7%9d-%d7%9c%d7%9e%d7%9b%d7%99%d7%a8%d7%94/%'
       or p like '/en/businesses-for-sale/%'
  ), tot as (
    select
      (select count(distinct visitor_id) from ev)::int as sv,
      (select count(*) from fs)::int as fv,
      (select count(distinct visitor_id) from fs)::int as fvis
  ), biz as (
    select distinct b.id, lower(b.business_number) as bn
    from seller_portal_accounts a
    join businesses b on b.id = a.business_id
    where a.status = 'active'
      and b.business_number is not null
  )
  insert into seller_portal_weekly_stats as s (
    business_id, site_visitors, for_sale_views, for_sale_visitors,
    business_views, business_visitors,
    facebook_group_posts, facebook_group_members, facebook_impressions,
    facebook_scope, facebook_posts,
    window_start, window_end, computed_at
  )
  select
    biz.id, tot.sv, tot.fv, tot.fvis,
    (select count(*) from ev where ev.p like '%' || biz.bn || '%')::int,
    (select count(distinct visitor_id) from ev where ev.p like '%' || biz.bn || '%')::int,
    coalesce(fb.posts, 0),
    coalesce(fb.members, 0),
    fb.impressions,
    coalesce(fb.scope, 'none'),
    coalesce(fb.items, '[]'::jsonb),
    t_start, t_end, t_end
  from biz
  cross join tot
  left join lateral (
    with qual as (
      select
        f.platform, f.group_name, f.status, f.member_count, f.impressions, f.posted_at,
        (f.posted_at at time zone 'Asia/Jerusalem')::date as posted_on
      from business_facebook_posts f
      where f.business_id = biz.id
        and split_part(lower(btrim(f.status)), ' ', 1) in ('active', 'published')
    ), week as (
      select * from qual where posted_at >= t_start and posted_at < t_end
    ), chosen as (
      select w.*, 'week'::text as scope from week w
      union all
      select q.*, 'latest'::text
      from qual q
      where not exists (select 1 from week)
        and q.posted_on = (select max(q2.posted_on) from qual q2)
    )
    select
      (select c.scope from chosen c limit 1) as scope,
      count(*)::int as posts,
      coalesce(sum(member_count), 0)::int as members,
      case when count(impressions) = 0 then null else sum(impressions)::int end as impressions,
      coalesce(jsonb_agg(jsonb_build_object(
        'platform', platform,
        'group_name', group_name,
        'posted_on', posted_on,
        'status', status,
        'member_count', member_count,
        'impressions', impressions
      ) order by posted_at), '[]'::jsonb) as items
    from chosen
  ) fb on true
  on conflict (business_id) do update set
    site_visitors = excluded.site_visitors,
    for_sale_views = excluded.for_sale_views,
    for_sale_visitors = excluded.for_sale_visitors,
    business_views = excluded.business_views,
    business_visitors = excluded.business_visitors,
    facebook_group_posts = excluded.facebook_group_posts,
    facebook_group_members = excluded.facebook_group_members,
    facebook_impressions = excluded.facebook_impressions,
    facebook_scope = excluded.facebook_scope,
    facebook_posts = excluded.facebook_posts,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    computed_at = excluded.computed_at;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.refresh_seller_portal_weekly_stats(boolean) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'seller-portal-weekly-stats';
select cron.schedule(
  'seller-portal-weekly-stats',
  '0 3 * * *',
  $$select public.refresh_seller_portal_weekly_stats(false)$$
);
select public.refresh_seller_portal_weekly_stats(true);
