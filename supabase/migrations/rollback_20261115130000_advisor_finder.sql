-- Rollback for 20261115130000_advisor_finder.sql. Redeploy business-advisor v8 and website-lead v20 first.
create or replace function public.advisor_reserve(p_bucket text, p_action text)
 returns boolean
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare n integer; cap integer;
begin
  if p_action not in ('chat','lead','feedback') then return false; end if;
  perform pg_advisory_xact_lock(hashtext('bsd-advisor-quota'));
  select daily_limit into cap from advisor_settings where id=true and enabled=true;
  if cap is null and p_action='chat' then return false; end if;
  if p_action='chat' then
    select count into n from advisor_usage where day=current_date and bucket='global';
    if coalesce(n,0)>=cap then return false; end if;
  end if;
  select count into n from advisor_usage where day=current_date and bucket=p_action||':'||p_bucket;
  if coalesce(n,0)>=(case p_action when 'chat' then 25 when 'lead' then 5 else 60 end) then return false; end if;
  insert into advisor_usage(day,bucket,count) values(current_date,p_action||':'||p_bucket,1) on conflict(day,bucket) do update set count=advisor_usage.count+1;
  if p_action='chat' then insert into advisor_usage(day,bucket,count) values(current_date,'global',1) on conflict(day,bucket) do update set count=advisor_usage.count+1; end if;
  return true;
end; $function$;
-- Data column: keep unless explicitly approved (dropping removes stored listing numbers).
-- alter table public.leads drop column if exists matched_business_numbers;
