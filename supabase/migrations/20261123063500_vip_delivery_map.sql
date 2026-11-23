create or replace function public.business_alert_vip_delivery_map(
  p_business_number text default null,
  p_subscriber_id uuid default null,
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

  if p_business_number is not null and p_subscriber_id is not null then
    return (
      select jsonb_build_object('deliveries', coalesce(jsonb_agg(to_jsonb(d)
        order by d.sent_at desc nulls last, d.id desc), '[]'::jsonb))
      from (
        select d.id, d.sent_at, d.channel, d.match_pct, d.subject, d.file_name, d.recipient_email, d.match_reason
        from public.business_alert_sends d
        join public.business_alert_subscribers s on s.id = d.subscriber_id
        where d.subscriber_id = p_subscriber_id and d.business_number = p_business_number
          and d.status = 'sent' and d.channel = 'email'
          and nullif(btrim(d.resend_id), '') is not null and s.is_test is not true
        order by d.sent_at desc nulls last, d.id desc
        limit 50 offset greatest(0, coalesce(p_offset, 0))
      ) d
    );
  end if;

  return (
    with pairs as (
      select d.business_number, d.subscriber_id, count(*) as send_count, max(d.sent_at) as last_sent_at
      from public.business_alert_sends d
      join public.business_alert_subscribers s on s.id = d.subscriber_id
      where d.status = 'sent' and d.channel = 'email'
        and nullif(btrim(d.resend_id), '') is not null and s.is_test is not true
        and nullif(btrim(d.business_number), '') is not null
      group by d.business_number, d.subscriber_id
    ), named_pairs as (
      select p.*,
        coalesce(nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), 'נרשם') as buyer_name,
        coalesce(nullif(b.internal_name, ''), nullif(b.anon_display_name, ''), p.business_number) as business_name
      from pairs p
      join public.business_alert_subscribers s on s.id = p.subscriber_id
      left join public.businesses b on b.business_number = p.business_number
    )
    select jsonb_build_object(
      'total_businesses', count(distinct business_number),
      'pairs', coalesce(jsonb_agg(to_jsonb(named_pairs) order by last_sent_at desc nulls last, business_number, subscriber_id), '[]'::jsonb)
    )
    from named_pairs
  );
end;
$$;

revoke all on function public.business_alert_vip_delivery_map(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.business_alert_vip_delivery_map(text, uuid, integer) to authenticated;
