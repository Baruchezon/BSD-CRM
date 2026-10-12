-- Additive schema. Existing leads, permissions and forms are unchanged.
create table if not exists public.advisor_settings (id boolean primary key default true check(id), enabled boolean not null default true, daily_limit integer not null default 100 check(daily_limit between 1 and 1000), model text not null default 'gpt-5.4');
create table if not exists public.advisor_knowledge (id uuid primary key default gen_random_uuid(), title text not null, body text not null, approved boolean not null default false, updated_at timestamptz not null default now());
create table if not exists public.advisor_usage (day date not null, bucket text not null, count integer not null default 0, primary key(day,bucket));
create table if not exists public.advisor_events (id uuid primary key default gen_random_uuid(), session_hash text not null, created_at timestamptz not null default now(), kind text not null, topic text, input_tokens integer default 0, output_tokens integer default 0, feedback smallint check(feedback in (-1,1)), lead_id uuid references public.leads(id));
create table if not exists public.advisor_inquiries (id uuid primary key, lead_id uuid not null references public.leads(id), created_at timestamptz not null default now(), question text not null, message text, transcript jsonb, consent_at timestamptz not null, transcript_consent boolean not null default false, traffic_source text, status text not null default 'ממתין למענה', reply text);
alter table public.advisor_settings enable row level security;
alter table public.advisor_knowledge enable row level security;
alter table public.advisor_usage enable row level security;
alter table public.advisor_events enable row level security;
alter table public.advisor_inquiries enable row level security;
revoke all on public.advisor_settings,public.advisor_knowledge,public.advisor_usage,public.advisor_events,public.advisor_inquiries from anon;
grant all on public.advisor_settings,public.advisor_knowledge,public.advisor_usage,public.advisor_events,public.advisor_inquiries to service_role;
grant select,update on public.advisor_settings to authenticated;
grant select,insert,update,delete on public.advisor_knowledge to authenticated;
grant select on public.advisor_events to authenticated;
grant select,update on public.advisor_inquiries to authenticated;
create policy advisor_settings_manager on public.advisor_settings for all to authenticated using(public.is_admin_or_manager((select auth.uid()))) with check(public.is_admin_or_manager((select auth.uid())));
create policy advisor_knowledge_manager on public.advisor_knowledge for all to authenticated using(public.is_admin_or_manager((select auth.uid()))) with check(public.is_admin_or_manager((select auth.uid())));
create policy advisor_events_manager on public.advisor_events for select to authenticated using(public.is_admin_or_manager((select auth.uid())));
create policy advisor_inquiries_manager on public.advisor_inquiries for all to authenticated using(public.is_admin_or_manager((select auth.uid()))) with check(public.is_admin_or_manager((select auth.uid())));
insert into public.advisor_settings(id) values(true) on conflict do nothing;
insert into public.advisor_knowledge(title,body,approved) values
('BSD ושיטת העבודה','BSD Business Brokers Israel מלווה בעלי עסקים, רוכשים ומשקיעים בישראל. התהליך כולל בחינה ראשונית, ניתוח כלכלי, הכנת תיק מכירה, תקציר אנונימי, חשיפה מבוקרת, סינון רוכשים וליווי משא ומתן. אין הבטחת מחיר או הצלחה. ברוך איזון בעל ניסיון של למעלה מ 17 שנים במיזוגים ורכישות וגיוס משקיעים.',true),
('פרטי קשר','טלפון BSD: 0774446707. וואטסאפ זמני: 0542424999. אימייל info@bsd-bbi.co.il. הצעת קשר אישית רק כשהיא רלוונטית ורק לפי רצון הגולש.',true),
('איכות מקצועית','הערכת שווי דורשת רווחיות מייצגת, תזרים, נכסים, התחייבויות וסיכונים. מחיר מבוקש אינו שווי מאומת. רכישת מניות שונה מרכישת פעילות. השקעה ראשונית, הלוואת בעלים ומכירת מניות הן רכיבים נפרדים. שאל נתונים חסרים; אל תמציא מכפילים, חוקים או מספרים.',true);

create or replace function public.advisor_reserve(p_bucket text,p_action text) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
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
end; $$;
revoke all on function public.advisor_reserve(text,text) from public,anon,authenticated;
grant execute on function public.advisor_reserve(text,text) to service_role;

create or replace function public.advisor_capture(p_request uuid,p_name text,p_phone text,p_question text,p_message text,p_transcript jsonb,p_transcript_consent boolean,p_source text) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare lid uuid; aid uuid; normalized text;
begin
  normalized:=public.normalize_il_phone(p_phone);
  if normalized is null or p_name is null or length(trim(p_name))<2 or length(trim(p_question))<2 then raise exception 'invalid_contact'; end if;
  perform pg_advisory_xact_lock(hashtext('advisor-lead:'||normalized));
  select lead_id into lid from advisor_inquiries where id=p_request;
  if lid is not null then return lid; end if;
  select id into aid from profiles where email='baruch@bsd-bbi.co.il' limit 1;
  select id into lid from leads where not coalesce(is_archived,false) and (public.normalize_il_phone(phone)=normalized or public.normalize_il_phone(phone2)=normalized) order by created_at desc limit 1;
  if lid is null then
    insert into leads(type,full_name,first_name,last_name,phone,source,status,website_intake_stage,website_purpose_guess,notes,created_by,handled_by,agreement_status,handling_status)
    values('buyer',p_name,split_part(p_name,' ',1),nullif(substr(p_name,length(split_part(p_name,' ',1))+2),''),p_phone,'שאלה מהיועץ באתר','חדש','new','שאלה עסקית, טרם סווגה','[שאלה מהיועץ באתר]'||chr(10)||p_question||chr(10)||coalesce(p_message,''),aid,aid,'אין הסכם','לחזור עם תשובה') returning id into lid;
  end if;
  insert into advisor_inquiries(id,lead_id,question,message,transcript,consent_at,transcript_consent,traffic_source)
  values(p_request,lid,p_question,p_message,case when p_transcript_consent then p_transcript else null end,now(),p_transcript_consent,p_source);
  insert into tasks(title,description,priority,assigned_to,status,related_type,related_id)
  values('מענה לשאלה מהאתר: '||p_name,p_question||chr(10)||'טלפון: '||p_phone,'רגילה',aid,'פתוחה','lead',lid);
  return lid;
end; $$;
revoke all on function public.advisor_capture(uuid,text,text,text,text,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.advisor_capture(uuid,text,text,text,text,jsonb,boolean,text) to service_role;
