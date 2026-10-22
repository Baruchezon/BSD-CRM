-- Rollback «בשבוע האחרון» / «פרסומי מדיה».
-- Back up Adam's log first if it has been synced, including any impressions he entered:
--   create table public.business_facebook_posts_backup_<date> as select * from public.business_facebook_posts;
-- business_facebook_impressions was never created by this migration.
select cron.unschedule(jobid) from cron.job where jobname = 'seller-portal-weekly-stats';
drop function if exists public.refresh_seller_portal_weekly_stats(boolean);
drop table if exists public.seller_portal_weekly_stats;
drop table if exists public.business_facebook_posts;
