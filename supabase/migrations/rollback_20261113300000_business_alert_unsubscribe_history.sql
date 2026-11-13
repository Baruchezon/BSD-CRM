begin;

update public.business_alert_subscriber_history
set action = 'update'
where action = 'unsubscribe';

alter table public.business_alert_subscriber_history
  drop constraint if exists business_alert_subscriber_history_action_check;

alter table public.business_alert_subscriber_history
  add constraint business_alert_subscriber_history_action_check
  check (action in ('update', 'confirm', 'reactivate'));

commit;
