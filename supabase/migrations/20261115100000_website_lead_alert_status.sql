-- 15.11.2026 lead audit, stage 1 (approved by Baruch 15.11 08:28 via Roman).
-- website-lead stores the outcome of the internal alert email on the lead.
-- Additive only; rollback: rollback_20261115100000_website_lead_alert_status.sql
alter table public.leads
  add column if not exists website_alert_email_status text,
  add column if not exists website_alert_email_at timestamptz,
  add column if not exists website_alert_email_error text,
  add column if not exists website_alert_email_id text;

alter table public.leads drop constraint if exists leads_website_alert_email_status_chk;
alter table public.leads add constraint leads_website_alert_email_status_chk
  check (website_alert_email_status is null or website_alert_email_status in ('sent','failed','skipped_test'));

comment on column public.leads.website_alert_email_status is
  'Internal alert email for the latest website/advisor inquiry: sent, failed, or skipped_test (is_test inquiries never email Baruch).';
