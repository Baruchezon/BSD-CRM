-- Unsubscribe clicks are recorded in subscriber history.
-- Does not change consent columns or sending flags.
-- Rollback: supabase/migrations/rollback_20261113300000_business_alert_unsubscribe_history.sql

begin;

alter table public.business_alert_subscriber_history
  drop constraint if exists business_alert_subscriber_history_action_check;

alter table public.business_alert_subscriber_history
  add constraint business_alert_subscriber_history_action_check
  check (action in ('update', 'confirm', 'reactivate', 'unsubscribe'));

commit;
