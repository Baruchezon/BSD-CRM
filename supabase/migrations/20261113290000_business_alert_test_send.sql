-- An explicit one-subscriber test send can name an allowlist and store the Resend id.
-- sending_enabled and dry_run are not changed. Real subscribers stay gated by those flags.
-- Rollback: supabase/migrations/rollback_20261113290000_business_alert_test_send.sql

begin;

alter table public.business_alert_match_settings
  add column if not exists alert_send_allowlist uuid[] not null default '{}';

comment on column public.business_alert_match_settings.alert_send_allowlist is
  'Staff may target these subscribers from send_one_alert. Service-role calls still require is_test.';

alter table public.business_alert_sends
  add column if not exists resend_id text;

comment on column public.business_alert_sends.resend_id is
  'Resend message id for a delivered alert letter.';

commit;
