begin;

create or replace function public.business_alert_vip_recipients()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc nulls last), '[]'::jsonb)
    from (
      select l.id, l.first_name, l.last_name, l.phone, l.email, l.agreement_status, l.created_at
      from public.leads l
      where l.type::text = 'buyer'
        and l.is_archived is not true
        and position('@' in btrim(coalesce(l.email, ''))) > 1
        and not exists (
          select 1
          from public.business_alert_subscribers s
          where (
              (nullif(btrim(coalesce(l.email, '')), '') is not null and lower(l.email) = lower(s.email))
              or (
                nullif(right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9), '') is not null
                and s.phone9 = right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9)
              )
            )
            and (
              s.do_not_call is true
              or s.status in ('unsubscribed', 'unsubscribed_all', 'unsubscribed_email')
              or s.email_unsubscribed_at is not null
            )
        )
    ) x
  );
end;
$$;

drop table if exists public.business_alert_subscriber_purges;

alter table public.business_alert_subscriber_history
  drop constraint if exists business_alert_subscriber_history_action_check;
alter table public.business_alert_subscriber_history
  add constraint business_alert_subscriber_history_action_check
  check (action in ('update', 'confirm', 'reactivate', 'unsubscribe'));

drop index if exists public.business_alert_subscribers_archived_idx;

alter table public.business_alert_subscribers
  drop column if exists prev_status,
  drop column if exists archive_reason,
  drop column if exists archived_by,
  drop column if exists archived_at;

commit;
