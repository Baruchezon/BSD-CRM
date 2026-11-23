begin;

alter table public.matches add column if not exists vip_email_sent_at timestamptz;

-- Keep the send log as the source of truth, including multi-business emails.
create or replace function public.business_alert_vip_delivery_history(
  p_sort text default 'date',
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('admin', 'manager')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return (
    with deliveries as (
      select d.id, d.business_number, d.channel, d.sent_at, d.match_pct,
             d.resend_id, s.id as subscriber_id,
             coalesce(nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), 'נרשם') as buyer_name,
             coalesce(nullif(b.internal_name, ''), nullif(b.anon_display_name, ''), d.business_number) as business_name
      from public.business_alert_sends d
      join public.business_alert_subscribers s on s.id = d.subscriber_id
      left join public.businesses b on b.business_number = d.business_number
      where d.status = 'sent' and s.is_test is not true
    ), page as (
      select *, row_number() over (
        order by case when p_sort = 'business' then business_name end,
                 case when p_sort = 'buyer' then buyer_name end,
                 sent_at desc, id desc
      ) as ordering
      from deliveries
      order by ordering
      limit 50 offset greatest(0, coalesce(p_offset, 0))
    )
    select jsonb_build_object(
      'total_deliveries', (select count(*) from deliveries),
      'total_messages', (select count(distinct (subscriber_id, channel, coalesce(nullif(resend_id, ''), id::text))) from deliveries),
      'deliveries', coalesce(
        (select jsonb_agg(to_jsonb(page) - 'ordering' - 'resend_id' - 'subscriber_id' order by ordering) from page),
        '[]'::jsonb
      )
    )
  );
end;
$$;

revoke all on function public.business_alert_vip_delivery_history(text, integer) from public, anon, authenticated;
grant execute on function public.business_alert_vip_delivery_history(text, integer) to authenticated;

create or replace function public.record_vip_email_match(
  p_subscriber_id uuid, p_business_number text, p_sent_at timestamptz, p_score numeric
) returns void
language sql security definer set search_path = ''
as $$
  insert into public.matches as existing (
    buyer_id, business_id, current_handler, created_by, status, status_changed_at,
    match_percent, match_source, last_action, last_action_at, vip_email_sent_at
  )
  select l.id, b.id, coalesce(l.handled_by, l.created_by), l.created_by,
         'מידע ראשוני נשלח', p_sent_at, nullif(p_score, 0), 'דיוור VIP',
         'נשלח ללקוח VIP באימייל', p_sent_at, p_sent_at
  from public.business_alert_subscribers s
  join public.leads l on l.id = coalesce(s.crm_lead_id, s.buyer_id, s.lead_id)
  join public.businesses b on b.business_number = p_business_number
  where s.id = p_subscriber_id and s.is_test is not true
    and l.type = 'buyer' and l.is_archived is not true
  on conflict (buyer_id, business_id) do update
    set vip_email_sent_at = excluded.vip_email_sent_at
    where existing.vip_email_sent_at is null or existing.vip_email_sent_at < excluded.vip_email_sent_at;
$$;

revoke all on function public.record_vip_email_match(uuid, text, timestamptz, numeric) from public, anon, authenticated;

create or replace function public.sync_vip_email_match_on_send()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.record_vip_email_match(new.subscriber_id, new.business_number, new.sent_at, new.match_pct);
  return new;
end;
$$;

revoke all on function public.sync_vip_email_match_on_send() from public, anon, authenticated;

drop trigger if exists trg_sync_vip_email_match_on_send on public.business_alert_sends;
create trigger trg_sync_vip_email_match_on_send
after insert or update of status on public.business_alert_sends
for each row when (new.status = 'sent' and new.channel = 'email')
execute function public.sync_vip_email_match_on_send();

-- Reflect existing sends without redispatching messages or changing existing match stages.
do $$
begin
  perform public.record_vip_email_match(d.subscriber_id, d.business_number, d.sent_at, d.match_pct)
  from public.business_alert_sends d
  where d.status = 'sent' and d.channel = 'email';
end;
$$;

commit;
