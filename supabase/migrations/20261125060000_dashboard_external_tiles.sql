-- 25.11.2026: 4 dashboard tiles on app.html (VIP / valuation calculator / seller portal / site visitors 7d).
-- Read-only, admin/manager only. Test rows (is_test) and archived rows are excluded everywhere.

create or replace function public.dashboard_external_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_manager_or_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'vip', (select count(*) from business_alert_subscribers
             where coalesce(is_test,false) = false and archived_at is null and status = 'active'),
    'valuation', (select count(distinct coalesce(visitor_key, id::text)) from valuation_requests
                   where coalesce(is_test,false) = false and coalesce(is_archived,false) = false),
    'valuation_requests', (select count(*) from valuation_requests
                   where coalesce(is_test,false) = false and coalesce(is_archived,false) = false),
    'portal', (select count(distinct s.account_id) from seller_portal_sessions s
                where coalesce(s.preview,false) = false),
    'site_visitors_7d', (select count(distinct visitor_id) from site_analytics_events
                          where created_at > now() - interval '7 days'),
    'site_sessions_7d', (select count(distinct session_id) from site_analytics_events
                          where created_at > now() - interval '7 days'),
    'site_pageviews_7d', (select count(*) from site_analytics_events
                           where created_at > now() - interval '7 days' and event_name = 'page_view')
  );
end;
$$;

create or replace function public.dashboard_external_list(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if not public.is_manager_or_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_kind = 'vip' then
    select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into r from (
      select jsonb_build_object(
        'id', s.id,
        'name', trim(coalesce(s.first_name,'') || ' ' || coalesce(s.last_name,'')),
        'phone', s.phone, 'email', s.email,
        'created_at', s.created_at,
        'status', s.status,
        'looking_for', s.looking_for,
        'regions', s.regions,
        'budget_min', s.budget_min, 'budget_max', s.budget_max,
        'source', coalesce(s.signup_channel, s.source),
        'last_sent_at', (select max(x.sent_at) from business_alert_sends x where x.subscriber_id = s.id)
      ) x
      from business_alert_subscribers s
      where coalesce(s.is_test,false) = false and s.archived_at is null and s.status = 'active'
    ) t;

  elsif p_kind = 'valuation' then
    select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into r from (
      select jsonb_build_object(
        'id', v.id, 'request_number', v.request_number,
        'created_at', v.created_at,
        'name', v.contact_name, 'phone', v.contact_phone, 'email', v.contact_email, 'city', v.contact_city,
        'sector', coalesce(v.sector_label, v.sector),
        'profit', v.profit, 'value_low', v.value_low, 'value_high', v.value_high,
        'attempt_no', v.visitor_attempt_no, 'device', v.device_type
      ) x
      from valuation_requests v
      where coalesce(v.is_test,false) = false and coalesce(v.is_archived,false) = false
    ) t;

  elsif p_kind = 'portal' then
    select coalesce(jsonb_agg(x order by x->>'last_login' desc nulls last), '[]'::jsonb) into r from (
      select jsonb_build_object(
        'account_id', a.id,
        'business', b.internal_name, 'business_number', b.business_number, 'business_id', b.id,
        'name', b.owner_name, 'phone', b.owner_phone, 'email', b.owner_email,
        'first_login', min(s.created_at), 'last_login', max(coalesce(s.last_activity_at, s.created_at)),
        'logins', count(s.id), 'active_minutes', round(coalesce(sum(s.active_seconds),0) / 60.0),
        'status', a.status
      ) x
      from seller_portal_accounts a
      join seller_portal_sessions s on s.account_id = a.id and coalesce(s.preview,false) = false
      left join businesses b on b.id = a.business_id
      group by a.id, b.id
    ) t;

  elsif p_kind = 'site' then
    select jsonb_build_object(
      'days', (select coalesce(jsonb_agg(d order by d->>'day' desc), '[]'::jsonb) from (
        select jsonb_build_object('day', (created_at at time zone 'Asia/Jerusalem')::date,
                 'visitors', count(distinct visitor_id), 'sessions', count(distinct session_id),
                 'pageviews', count(*) filter (where event_name = 'page_view'),
                 'leads', count(*) filter (where event_name in ('form_submit','lead_submit','alerts_signup'))) d
        from site_analytics_events where created_at > now() - interval '7 days'
        group by (created_at at time zone 'Asia/Jerusalem')::date) a),
      'pages', (select coalesce(jsonb_agg(p order by (p->>'views')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('path', page_path, 'title', max(page_title), 'views', count(*), 'visitors', count(distinct visitor_id)) p
        from site_analytics_events where created_at > now() - interval '7 days' and event_name = 'page_view'
        group by page_path order by count(*) desc limit 15) b),
      'sources', (select coalesce(jsonb_agg(q order by (q->>'visitors')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('source', coalesce(nullif(referrer_host,''), 'כניסה ישירה'), 'visitors', count(distinct visitor_id)) q
        from site_analytics_events where created_at > now() - interval '7 days'
        group by coalesce(nullif(referrer_host,''), 'כניסה ישירה') order by count(distinct visitor_id) desc limit 10) c),
      'devices', (select coalesce(jsonb_object_agg(coalesce(device_type,'לא ידוע'), n), '{}'::jsonb) from (
        select device_type, count(distinct visitor_id) n from site_analytics_events
        where created_at > now() - interval '7 days' group by device_type) e)
    ) into r;
  else
    raise exception 'unknown kind %', p_kind;
  end if;
  return r;
end;
$$;

revoke all on function public.dashboard_external_counts() from public, anon;
revoke all on function public.dashboard_external_list(text) from public, anon;
grant execute on function public.dashboard_external_counts() to authenticated;
grant execute on function public.dashboard_external_list(text) to authenticated;
