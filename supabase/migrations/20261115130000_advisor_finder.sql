-- 15.11.2026 advisor «finder» mode (Baruch approved Roman's plan 15.11 08:28).
-- Additive: leads.matched_business_numbers + 'finder' rate-limit bucket in advisor_reserve.
-- Rollback: rollback_20261115130000_advisor_finder.sql
alter table public.leads add column if not exists matched_business_numbers text[];
comment on column public.leads.matched_business_numbers is
  'Listing numbers (BSD-B-…) the visitor was shown/asked about (advisor finder, website form business_numbers). First one is also in business_id.';

create or replace function public.advisor_reserve(p_bucket text, p_action text)
 returns boolean
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare n integer; cap integer;
begin
  if p_action not in ('chat','lead','feedback','finder') then return false; end if;
  perform pg_advisory_xact_lock(hashtext('bsd-advisor-quota'));
  select daily_limit into cap from advisor_settings where id=true and enabled=true;
  if cap is null and p_action='chat' then return false; end if;
  if p_action='chat' then
    select count into n from advisor_usage where day=current_date and bucket='global';
    if coalesce(n,0)>=cap then return false; end if;
  end if;
  select count into n from advisor_usage where day=current_date and bucket=p_action||':'||p_bucket;
  if coalesce(n,0)>=(case p_action when 'chat' then 25 when 'lead' then 5 when 'finder' then 30 else 60 end) then return false; end if;
  insert into advisor_usage(day,bucket,count) values(current_date,p_action||':'||p_bucket,1) on conflict(day,bucket) do update set count=advisor_usage.count+1;
  if p_action='chat' then insert into advisor_usage(day,bucket,count) values(current_date,'global',1) on conflict(day,bucket) do update set count=advisor_usage.count+1; end if;
  return true;
end; $function$;
