-- Agent isolation is restrictive: legacy permissive policies cannot widen it.
create schema if not exists bsd_private;
revoke all on schema bsd_private from public, anon;
grant usage on schema bsd_private to authenticated, service_role;

create or replace function bsd_private.agent_role() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='agent_authorized');
$$;
create or replace function bsd_private.active_agent() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='agent_authorized' and status='active');
$$;
create or replace function bsd_private.owns_lead(lid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.leads l where l.id=lid and (l.created_by=auth.uid() or l.handled_by=auth.uid()));
$$;
create or replace function bsd_private.owns_business(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.businesses b where b.id=bid and (b.created_by=auth.uid() or b.handled_by=auth.uid()));
$$;
create or replace function bsd_private.owns_match(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select bsd_private.active_agent() and exists(select 1 from public.matches m where m.id=mid and
 (m.created_by=auth.uid() or m.current_handler=auth.uid() or bsd_private.owns_lead(m.buyer_id)));
$$;

alter table public.business_alert_subscribers add column if not exists owner_id uuid references public.profiles(id);
alter table public.business_alert_subscribers add column if not exists referred_by_agent_id uuid references public.profiles(id);
alter table public.business_alert_subscribers add column if not exists referred_by_agent_name text;
alter table public.business_alert_subscribers add column if not exists original_source text;
alter table public.leads add column if not exists referred_by_agent_id uuid references public.profiles(id);
alter table public.leads add column if not exists referred_by_agent_name text;
alter table public.leads add column if not exists original_source text;
alter table public.businesses add column if not exists referred_by_agent_id uuid references public.profiles(id);
alter table public.businesses add column if not exists referred_by_agent_name text;
alter table public.businesses add column if not exists original_source text;
create index if not exists alert_subscriber_owner_idx on public.business_alert_subscribers(owner_id);
create index if not exists alert_subscriber_referrer_idx on public.business_alert_subscribers(referred_by_agent_id);
create index if not exists leads_referrer_idx on public.leads(referred_by_agent_id);
create index if not exists businesses_referrer_idx on public.businesses(referred_by_agent_id);

-- Original attribution survives edits, transfers and repeat registration.
create or replace function bsd_private.record_origin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
 if tg_op='INSERT' then
   if bsd_private.agent_role() then
     if not bsd_private.active_agent() then raise exception 'forbidden' using errcode='42501'; end if;
     new.created_by:=auth.uid(); new.handled_by:=auth.uid();
   end if;
   select * into p from public.profiles where id=new.created_by and role='agent_authorized';
   if p.id is not null and (new.referred_by_agent_id is null or bsd_private.agent_role()) then new.referred_by_agent_id:=p.id; new.referred_by_agent_name:=p.full_name; end if;
   new.original_source:=coalesce(new.original_source,new.source);
 else
   if bsd_private.agent_role() then
     if new.created_by is distinct from old.created_by or new.handled_by is distinct from old.handled_by then
       raise exception 'ownership_is_managed_by_admin' using errcode='42501';
     end if;
   end if;
   if old.referred_by_agent_id is not null then
     new.referred_by_agent_id:=old.referred_by_agent_id;
     new.referred_by_agent_name:=old.referred_by_agent_name;
   elsif bsd_private.agent_role() then
     new.referred_by_agent_id:=old.referred_by_agent_id;
     new.referred_by_agent_name:=old.referred_by_agent_name;
   end if;
   new.original_source:=coalesce(old.original_source,old.source,new.original_source,new.source);
 end if;
 return new;
end; $$;
create trigger agent_record_origin before insert or update on public.leads for each row execute function bsd_private.record_origin();
create trigger agent_record_origin before insert or update on public.businesses for each row execute function bsd_private.record_origin();

create or replace function bsd_private.subscriber_origin() returns trigger
language plpgsql set search_path = '' as $$
begin
 if tg_op='UPDATE' then
   if old.referred_by_agent_id is not null then
     new.referred_by_agent_id:=old.referred_by_agent_id; new.referred_by_agent_name:=old.referred_by_agent_name;
   end if;
   new.original_source:=coalesce(old.original_source,old.source,new.original_source,new.source);
 else new.original_source:=coalesce(new.original_source,case when new.manual_source='call' then 'טלפון' else new.source end); end if;
 return new;
end; $$;
create trigger subscriber_origin before insert or update on public.business_alert_subscribers for each row execute function bsd_private.subscriber_origin();

-- Self-editing a profile must never permit self-promotion or permission changes.
create or replace function bsd_private.protect_profile_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is not null and not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','manager') and status='active') then
   if (to_jsonb(new)-array['first_name','last_name','full_name','phone','city','address','company','job_title','specialization','license_number','photo_url','last_login_at','login_count']) is distinct from
      (to_jsonb(old)-array['first_name','last_name','full_name','phone','city','address','company','job_title','specialization','license_number','photo_url','last_login_at','login_count']) then
     raise exception 'profile_permissions_require_admin' using errcode='42501';
   end if;
 end if;
 return new;
end; $$;
create trigger protect_profile_permissions before update on public.profiles for each row execute function bsd_private.protect_profile_permissions();

-- Active users only; an explicit full grant is scoped to one business.
create or replace function public.has_full_business_access(biz_id uuid, uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p where p.id=uid and p.status='active' and (
 p.role in ('admin','manager') or exists(select 1 from public.businesses b where b.id=biz_id and (b.created_by=uid or b.handled_by=uid))
 or exists(select 1 from public.business_access_grants g where g.business_id=biz_id and g.granted_to=uid and g.active and g.access_level='full')));
$$;
create policy agent_business_read on public.businesses as restrictive for select to authenticated
 using (not bsd_private.agent_role() or (bsd_private.active_agent() and public.has_full_business_access(id,auth.uid())));
create policy agent_business_write on public.businesses as restrictive for update to authenticated
 using (not bsd_private.agent_role() or (bsd_private.active_agent() and public.has_full_business_access(id,auth.uid())))
 with check (not bsd_private.agent_role() or (bsd_private.active_agent() and public.has_full_business_access(id,auth.uid())));
create policy agent_business_insert on public.businesses for insert to authenticated
 with check (bsd_private.active_agent() and created_by=auth.uid() and handled_by=auth.uid());
create policy agent_lead_scope on public.leads as restrictive for select to authenticated
 using (not bsd_private.agent_role() or (bsd_private.active_agent() and (created_by=auth.uid() or handled_by=auth.uid() or public.has_lead_view_access(id))));
create policy agent_lead_insert on public.leads for insert to authenticated
 with check (bsd_private.active_agent() and created_by=auth.uid() and handled_by=auth.uid());
create policy agent_lead_write on public.leads as restrictive for update to authenticated
 using (not bsd_private.agent_role() or (bsd_private.active_agent() and (created_by=auth.uid() or handled_by=auth.uid())))
 with check (not bsd_private.agent_role() or (bsd_private.active_agent() and (created_by=auth.uid() or handled_by=auth.uid())));
create policy agent_lead_owned_update on public.leads for update to authenticated
 using (bsd_private.active_agent() and (created_by=auth.uid() or handled_by=auth.uid()))
 with check (bsd_private.active_agent() and (created_by=auth.uid() or handled_by=auth.uid()));

create policy agent_matches_scope on public.matches as restrictive for select to authenticated
 using (not bsd_private.agent_role() or bsd_private.owns_match(id));
create policy agent_matches_write on public.matches as restrictive for update to authenticated
 using (not bsd_private.agent_role() or bsd_private.owns_match(id))
 with check (not bsd_private.agent_role() or (bsd_private.active_agent() and bsd_private.owns_lead(buyer_id) and public.get_business_access_level(business_id,auth.uid())<>'none'));
create policy agent_matches_insert on public.matches as restrictive for insert to authenticated
 with check (not bsd_private.agent_role() or (bsd_private.active_agent() and created_by=auth.uid() and bsd_private.owns_lead(buyer_id) and public.get_business_access_level(business_id,auth.uid())<>'none'));
create policy agent_match_activity_scope on public.match_activity_log as restrictive for all to authenticated
 using (not bsd_private.agent_role() or bsd_private.owns_match(match_id))
 with check (not bsd_private.agent_role() or bsd_private.owns_match(match_id));
create policy agent_meetings_scope on public.match_meetings as restrictive for all to authenticated
 using (not bsd_private.agent_role() or (bsd_private.active_agent() and case when match_id is not null then bsd_private.owns_match(match_id) else bsd_private.owns_lead(buyer_id) end))
 with check (not bsd_private.agent_role() or (bsd_private.active_agent() and case when match_id is not null then bsd_private.owns_match(match_id) else bsd_private.owns_lead(buyer_id) end));
create policy agent_notes_scope on public.record_notes as restrictive for all to authenticated
 using (not bsd_private.agent_role() or (bsd_private.active_agent() and case table_name
 when 'matches' then bsd_private.owns_match(record_id) when 'leads' then bsd_private.owns_lead(record_id)
 when 'businesses' then public.has_full_business_access(record_id,auth.uid()) else author_id=auth.uid() end))
 with check (not bsd_private.agent_role() or (bsd_private.active_agent() and author_id=auth.uid() and case table_name
 when 'matches' then bsd_private.owns_match(record_id) when 'leads' then bsd_private.owns_lead(record_id)
 when 'businesses' then public.has_full_business_access(record_id,auth.uid()) else false end));
create policy agent_grants_read on public.business_access_grants as restrictive for select to authenticated
 using (not bsd_private.agent_role() or (bsd_private.active_agent() and (granted_to=auth.uid() or bsd_private.owns_business(business_id))));
create policy agent_grants_insert on public.business_access_grants as restrictive for insert to authenticated
 with check (not bsd_private.agent_role() or (bsd_private.active_agent() and bsd_private.owns_business(business_id) and granted_by=auth.uid()));
create policy agent_grants_update on public.business_access_grants as restrictive for update to authenticated
 using (not bsd_private.agent_role() or (bsd_private.active_agent() and bsd_private.owns_business(business_id)))
 with check (not bsd_private.agent_role() or (bsd_private.active_agent() and bsd_private.owns_business(business_id)));

create policy agent_sale_file_scope on public.business_sale_files as restrictive for select to authenticated
 using (not bsd_private.agent_role() or (bsd_private.active_agent() and
 (public.has_full_business_access(business_id,auth.uid()) or
 (public.get_business_access_level(business_id,auth.uid())='anonymous' and confidentiality_level=1 and document_type='anonymous_summary' and status='active'))));
-- Filename metadata and raw document paths are part of full business access.
create policy agent_file_meta_scope on public.business_file_meta as restrictive for select to authenticated
 using (not bsd_private.agent_role() or (bsd_private.active_agent() and public.has_full_business_access(business_id,auth.uid())));
-- Duplicate checks use the same lead RLS as normal searches.
alter function public.bsd_check_lead_duplicate(text,text,text,uuid) security invoker;

CREATE OR REPLACE FUNCTION public.get_business_access_level(biz_id uuid, uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  select case
    when not exists(select 1 from public.profiles where id=uid and status='active') then 'none'
    when exists (select 1 from public.profiles p where p.id = uid and p.role in ('admin','manager')) then 'full'
    when exists (select 1 from public.businesses b where b.id = biz_id and (b.created_by = uid or b.handled_by = uid)) then 'full'
    when exists (
      select 1 from public.business_access_grants g
      where g.business_id = biz_id and g.granted_to = uid and g.active
    ) then (
      select g.access_level from public.business_access_grants g
      where g.business_id = biz_id and g.granted_to = uid and g.active
      limit 1
    )
    when exists (
      select 1 from public.businesses b, public.profiles p
      where b.id = biz_id and p.id = uid
        and b.distribution_status = 'all_authorized' and p.role = 'agent_authorized'
    ) then 'anonymous'
    else 'none'
  end;
$function$;

-- Service-only ownership predicate. No subscriber contacts or tokens returned.
create or replace function public.business_alert_agent_subscriber_ids(p_actor uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
 select s.id from public.business_alert_subscribers s where exists(select 1 from public.profiles p where p.id=p_actor and p.role='agent_authorized' and p.status='active') and s.owner_id=p_actor;
$$;
revoke all on function public.business_alert_agent_subscriber_ids(uuid) from public,anon,authenticated;
grant execute on function public.business_alert_agent_subscriber_ids(uuid) to service_role;

-- Attribution and creation are one transaction, preventing unowned manual rows.
create or replace function public.business_alert_staff_add(p_actor uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; result jsonb; sid uuid;
begin
 select * into p from public.profiles where id=p_actor and status='active' and role in ('admin','manager','agent_authorized');
 if p.id is null then raise exception 'forbidden' using errcode='42501'; end if;
 if coalesce((p_payload->>'p_consent_email')::boolean,false) and coalesce(p_payload->>'p_email_method','') not in ('verbal_call','whatsapp_reply','written','form') then raise exception 'consent_method' using errcode='22023'; end if;
 if coalesce((p_payload->>'p_consent_whatsapp')::boolean,false) and coalesce(p_payload->>'p_whatsapp_method','') not in ('verbal_call','whatsapp_reply','written','form') then raise exception 'consent_method' using errcode='22023'; end if;
 result:=public.business_alert_add_manual(
 p_payload->>'p_first_name',p_payload->>'p_last_name',p_payload->>'p_phone',p_payload->>'p_email',
 (p_payload->>'p_consent_email')::boolean,(p_payload->>'p_consent_whatsapp')::boolean,
 p_payload->>'p_email_method',p_payload->>'p_whatsapp_method',p_payload->>'p_email_note',p_payload->>'p_whatsapp_note',
 array(select jsonb_array_elements_text(p_payload->'p_categories')),array(select jsonb_array_elements_text(p_payload->'p_regions')),
 (p_payload->>'p_budget_min')::numeric,(p_payload->>'p_budget_max')::numeric,(p_payload->>'p_budget_open')::boolean,
 p.full_name,p_payload->>'p_address_form');
 sid:=(result->'subscriber'->>'id')::uuid;
 update public.business_alert_subscribers set owner_id=p.id,
 referred_by_agent_id=case when p.role='agent_authorized' then p.id end,
 referred_by_agent_name=case when p.role='agent_authorized' then p.full_name end,
 original_source=case when p.role='agent_authorized' then 'סוכן מורשה' else 'טלפון' end where id=sid;
 return public.business_alert_screen_card(sid);
end; $$;
revoke all on function public.business_alert_staff_add(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.business_alert_staff_add(uuid,jsonb) to service_role;

-- Helpers are available to RLS, never as public HTTP RPC endpoints.
revoke all on all functions in schema bsd_private from public,anon;
grant execute on all functions in schema bsd_private to authenticated,service_role;
update public.profiles set can_create_businesses=true,can_create_buyers=true,can_view_anonymous_businesses=true,can_use_ai_match=true where role='agent_authorized' and status='active';
create or replace function bsd_private.can_read_subscriber(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and
 (p.role in ('admin','manager') or (p.role='agent_authorized' and exists(select 1 from public.business_alert_subscribers s where s.id=sid and s.owner_id=p.id))));
$$;
revoke all on function bsd_private.can_read_subscriber(uuid) from public,anon;
grant execute on function bsd_private.can_read_subscriber(uuid) to authenticated,service_role;

-- Called only after a valid invitation token and successful consent submission.
create or replace function public.business_alert_complete_invite(p_invite_id uuid,p_subscriber_id uuid,p_claim_new boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.business_alert_invites; s public.business_alert_subscribers; p public.profiles; lid uuid; same_contact boolean;
begin
 select * into i from public.business_alert_invites where id=p_invite_id for update;
 if i.id is null or i.status not in ('sent','opened') or i.expires_at<=now() then raise exception 'invalid_invite'; end if;
 select * into s from public.business_alert_subscribers where id=p_subscriber_id for update;
 if s.id is null then raise exception 'not_found'; end if;
 select * into p from public.profiles where id=i.created_by and status='active' and role in ('admin','manager','agent_authorized');
 same_contact:=(nullif(lower(s.email),'')=nullif(lower(i.prefill->>'email'),'')) or
 (length(coalesce(s.phone9,''))=9 and s.phone9=right(regexp_replace(i.prefill->>'phone','[^0-9]','','g'),9));
 lid:=coalesce(i.buyer_id,i.lead_id);
 -- Existing ownership and first referrer always win; a forwarded link cannot
 -- attach a different person to the invite's original CRM card.
 if p_claim_new and p.id is not null and s.created_at>=i.sent_at and s.owner_id is null and s.referred_by_agent_id is null then
   update public.business_alert_subscribers set owner_id=p.id,
     referred_by_agent_id=case when p.role='agent_authorized' then p.id end,
     referred_by_agent_name=case when p.role='agent_authorized' then p.full_name end,
     crm_lead_id=case when same_contact then coalesce(crm_lead_id,lid) else crm_lead_id end,
     buyer_id=case when same_contact then coalesce(buyer_id,i.buyer_id) else buyer_id end,
     lead_id=case when same_contact then coalesce(lead_id,i.lead_id) else lead_id end
   where id=s.id;
   if same_contact then
     update public.leads set referred_by_agent_id=case when p.role='agent_authorized' then p.id else referred_by_agent_id end,
       referred_by_agent_name=case when p.role='agent_authorized' then p.full_name else referred_by_agent_name end
     where id=lid and (created_by=p.id or handled_by=p.id) and referred_by_agent_id is null;
   end if;
 end if;
 update public.business_alert_invites set status='joined',joined_at=now(),subscriber_id=s.id where id=i.id;
end; $$;
revoke all on function public.business_alert_complete_invite(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.business_alert_complete_invite(uuid,uuid,boolean) to service_role;

-- A recipient of a business grant cannot pass that grant on to other agents.
create or replace function bsd_private.protect_match_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
 if bsd_private.agent_role() and (new.business_id is distinct from old.business_id or new.buyer_id is distinct from old.buyer_id or new.broker_id is distinct from old.broker_id or new.created_by is distinct from old.created_by or new.current_handler is distinct from old.current_handler) then
   raise exception 'match_identity_requires_admin' using errcode='42501';
 end if;
 return new;
end; $$;
create trigger protect_match_identity before update on public.matches for each row execute function bsd_private.protect_match_identity();
revoke all on function bsd_private.protect_match_identity() from public,anon;
grant execute on function bsd_private.protect_match_identity() to authenticated,service_role;
CREATE OR REPLACE FUNCTION public.business_alert_vip_delivery_history(p_sort text DEFAULT 'date'::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('admin', 'manager', 'agent_authorized')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return (
    with deliveries as (
      select d.id, d.business_number, d.channel, d.sent_at, d.match_pct,
             d.resend_id, s.id as subscriber_id,
             coalesce(nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), 'נרשם') as buyer_name,
             case when public.has_full_business_access(b.id,auth.uid()) then coalesce(nullif(b.internal_name, ''), b.anon_display_name, d.business_number) else coalesce(nullif(b.anon_display_name,''), 'עסק אנונימי') end as business_name
      from public.business_alert_sends d
      join public.business_alert_subscribers s on s.id = d.subscriber_id
      left join public.businesses b on b.business_number = d.business_number
      where d.status = 'sent' and d.channel = 'email'
        and nullif(btrim(d.resend_id), '') is not null and s.is_test is not true and bsd_private.can_read_subscriber(s.id)
    ), page as (
      select *, row_number() over (
        order by case when p_sort = 'business' then business_name end,
                 case when p_sort = 'buyer' then buyer_name end,
                 sent_at desc, id desc
      ) as ordering
      from deliveries
      order by ordering
      limit 50 offset greatest(0, coalesce(p_offset, 0))
    )
    select jsonb_build_object(
      'total_deliveries', (select count(*) from deliveries),
      'total_messages', (select count(distinct (subscriber_id, resend_id)) from deliveries),
      'deliveries', coalesce(
        (select jsonb_agg(to_jsonb(page) - 'ordering' - 'resend_id' - 'subscriber_id' order by ordering) from page),
        '[]'::jsonb
      )
    )
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.business_alert_vip_delivery_map(p_business_number text DEFAULT NULL::text, p_subscriber_id uuid DEFAULT NULL::uuid, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('admin', 'manager', 'agent_authorized')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_business_number is not null and p_subscriber_id is not null then
    return (
      select jsonb_build_object('deliveries', coalesce(jsonb_agg(to_jsonb(d)
        order by d.sent_at desc nulls last, d.id desc), '[]'::jsonb))
      from (
        select d.id, d.sent_at, d.channel, d.match_pct, case when not bsd_private.agent_role() then d.subject else 'עדכון עסק' end as subject, case when not bsd_private.agent_role() then d.file_name end as file_name, d.recipient_email, case when not bsd_private.agent_role() then d.match_reason end as match_reason
        from public.business_alert_sends d
        join public.business_alert_subscribers s on s.id = d.subscriber_id
        where d.subscriber_id = p_subscriber_id and d.business_number = p_business_number
          and d.status = 'sent' and d.channel = 'email'
          and nullif(btrim(d.resend_id), '') is not null and s.is_test is not true and bsd_private.can_read_subscriber(s.id)
        order by d.sent_at desc nulls last, d.id desc
        limit 50 offset greatest(0, coalesce(p_offset, 0))
      ) d
    );
  end if;

  return (
    with pairs as (
      select d.business_number, d.subscriber_id, count(*) as send_count, max(d.sent_at) as last_sent_at
      from public.business_alert_sends d
      join public.business_alert_subscribers s on s.id = d.subscriber_id
      where d.status = 'sent' and d.channel = 'email'
        and nullif(btrim(d.resend_id), '') is not null and s.is_test is not true and bsd_private.can_read_subscriber(s.id)
        and nullif(btrim(d.business_number), '') is not null
      group by d.business_number, d.subscriber_id
    ), named_pairs as (
      select p.*,
        coalesce(nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), 'נרשם') as buyer_name,
        case when public.has_full_business_access(b.id,auth.uid()) then coalesce(nullif(b.internal_name, ''), b.anon_display_name, p.business_number) else coalesce(nullif(b.anon_display_name,''), 'עסק אנונימי') end as business_name
      from pairs p
      join public.business_alert_subscribers s on s.id = p.subscriber_id
      left join public.businesses b on b.business_number = p.business_number
    )
    select jsonb_build_object(
      'total_businesses', count(distinct business_number),
      'pairs', coalesce(jsonb_agg(to_jsonb(named_pairs) order by last_sent_at desc nulls last, business_number, subscriber_id), '[]'::jsonb)
    )
    from named_pairs
  );
end;
$function$;
notify pgrst,'reload schema';
