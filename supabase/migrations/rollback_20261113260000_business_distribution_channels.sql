-- Rolls back distribution channels. History and channel rows are removed.
-- businesses.media_drive_folder_url is dropped. marketing_service_active is not touched.
-- The distribution_agent role is left in place so a later re-apply does not fight an existing role.

begin;

drop trigger if exists trg_business_distribution_website_notify on public.businesses;
drop trigger if exists trg_business_distribution_facebook_notify on public.business_distribution_channels;

drop function if exists public.business_distribution_notify_website();
drop function if exists public.business_distribution_notify_facebook();
drop function if exists public.business_distribution_enqueue_notify(text, text, uuid, text);
drop function if exists public.business_distribution_facebook_report();
drop function if exists public.business_distribution_facebook_update(uuid, text, text, text);
drop function if exists public.business_distribution_facebook_queue();
drop function if exists public.business_distribution_set(uuid, text, boolean, text);
drop function if exists public.business_distribution_list(uuid);
drop function if exists public.business_distribution_require_staff();

drop table if exists public.business_distribution_notify_log;
drop table if exists public.business_distribution_channel_history;
drop table if exists public.business_distribution_channels;

alter table public.businesses
  drop column if exists media_drive_folder_url;

commit;
