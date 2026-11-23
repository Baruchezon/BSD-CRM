begin;

-- The legacy eligibility RPC can create a row already marked sent before transport.
-- Require the email provider's receipt, which also identifies a multi-business email.
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
      where d.status = 'sent' and d.channel = 'email'
        and nullif(btrim(d.resend_id), '') is not null and s.is_test is not true
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
      'total_messages', (select count(distinct (subscriber_id, resend_id)) from deliveries),
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

create or replace trigger trg_sync_vip_email_match_on_send
after insert or update of status, resend_id on public.business_alert_sends
for each row when (new.status = 'sent' and new.channel = 'email' and nullif(btrim(new.resend_id), '') is not null)
execute function public.sync_vip_email_match_on_send();

-- Reset the stage of untouched matches added from receiptless log entries.
-- Keep their history and retain progress on matches that acquired activity.
update public.matches m
set status = 'התאמה חדשה', status_changed_at = now(),
    last_action = null, last_action_at = null, vip_email_sent_at = null
from public.business_alert_sends d, public.business_alert_subscribers s, public.businesses b
where d.subscriber_id = s.id and b.business_number = d.business_number
  and m.business_id = b.id and m.buyer_id = coalesce(s.crm_lead_id, s.buyer_id, s.lead_id)
  and d.status = 'sent' and d.channel = 'email' and nullif(btrim(d.resend_id), '') is null
  and d.match_pct = 0 and m.vip_email_sent_at = d.sent_at
  and m.match_source = 'דיוור VIP' and m.status = 'מידע ראשוני נשלח'
  and m.last_action = 'נשלח ללקוח VIP באימייל' and m.last_action_at = d.sent_at
  and m.created_at > d.sent_at and m.created_at = m.updated_at and m.version = 1
  and not exists (select 1 from public.match_participants x where x.match_id = m.id)
  and not exists (select 1 from public.tasks x where x.match_id = m.id)
  and not exists (select 1 from public.match_meetings x where x.match_id = m.id)
  and not exists (select 1 from public.anon_distributions x where x.match_id = m.id)
  and not exists (select 1 from public.match_activity_log x where x.match_id = m.id)
  and not exists (select 1 from public.seller_portal_match_permissions x where x.match_id = m.id)
  and not exists (select 1 from public.business_outreach x where x.converted_match_id = m.id)
  and not exists (
    select 1
    from public.business_alert_sends confirmed
    join public.business_alert_subscribers cs on cs.id = confirmed.subscriber_id
    where coalesce(cs.crm_lead_id, cs.buyer_id, cs.lead_id) = m.buyer_id
      and confirmed.business_number = b.business_number
      and cs.is_test is not true and confirmed.status = 'sent' and confirmed.channel = 'email'
      and nullif(btrim(confirmed.resend_id), '') is not null
  );

-- Reconcile the badge on surviving matches without changing their stage.
with received as (
  select coalesce(s.crm_lead_id, s.buyer_id, s.lead_id) as buyer_id,
         b.id as business_id, max(d.sent_at) as last_sent
  from public.business_alert_sends d
  join public.business_alert_subscribers s on s.id = d.subscriber_id
  join public.businesses b on b.business_number = d.business_number
  where d.status = 'sent' and d.channel = 'email'
    and nullif(btrim(d.resend_id), '') is not null and s.is_test is not true
  group by 1, 2
), reconciliation as (
  select m.id, r.last_sent
  from public.matches m
  left join received r on r.buyer_id = m.buyer_id and r.business_id = m.business_id
  where m.vip_email_sent_at is not null and m.vip_email_sent_at is distinct from r.last_sent
)
update public.matches m set vip_email_sent_at = r.last_sent
from reconciliation r where r.id = m.id;

commit;
