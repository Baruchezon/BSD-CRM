-- Rollback for 20261115100000_website_lead_alert_status.sql (drops only the 4 new columns).
alter table public.leads drop constraint if exists leads_website_alert_email_status_chk;
alter table public.leads
  drop column if exists website_alert_email_status,
  drop column if exists website_alert_email_at,
  drop column if exists website_alert_email_error,
  drop column if exists website_alert_email_id;
