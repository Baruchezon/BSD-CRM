-- «כניסות לאתר» on «בשבוע האחרון».
-- site_entries = count(distinct session_id) of page_view events in
-- site_analytics_events over the same 7-day window. A repeat visit is another
-- session and counts. site_visitors stays count(distinct visitor_id). Every
-- other column is unchanged. Real counts only. This job sends nothing.
-- Rollback: supabase/migrations/rollback_20261023040000_seller_portal_site_entries.sql
-- Pre-change rows: public.seller_portal_weekly_stats_backup_20261023
-- After apply: select public.refresh_seller_portal_weekly_stats(true);

alter table public.seller_portal_weekly_stats
  add column if not exists site_entries integer not null default 0;

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
    select visitor_id, session_id, lower(page_path) as p
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
      (select count(distinct session_id) from ev)::int as se,
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
    business_id, site_visitors, site_entries, for_sale_views, for_sale_visitors,
    business_views, business_visitors,
    facebook_group_posts, facebook_group_members, facebook_impressions,
    facebook_scope, facebook_posts,
    window_start, window_end, computed_at
  )
  select
    biz.id, tot.sv, tot.se, tot.fv, tot.fvis,
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
    site_entries = excluded.site_entries,
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
