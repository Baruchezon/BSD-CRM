-- Snapshots describe entry provenance, separately from current handling rights.
do $$ declare t text; begin
 foreach t in array array['leads','businesses','business_alert_subscribers'] loop
  execute format('alter table public.%I add column origin_entered_by_id uuid references public.profiles(id)',t);
  execute format('alter table public.%I add column origin_entered_by_name text',t);
 end loop;
end $$;
create or replace function bsd_private.origin_name(uid uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(nullif(btrim(full_name),''),nullif(btrim(concat_ws(' ',first_name,last_name)),''),internal_code) from public.profiles where id=uid;
$$;
revoke all on function bsd_private.origin_name(uuid) from public,anon;
grant execute on function bsd_private.origin_name(uuid) to authenticated,service_role;

create or replace function bsd_private.record_origin() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; ref public.profiles; linked public.leads; oldj jsonb; j jsonb; ordinary_agent boolean;
begin
 select * into actor from public.profiles where id=auth.uid();
 ordinary_agent:=coalesce(actor.role in ('agent','agent_authorized'),false);
 if tg_op='INSERT' then
  if ordinary_agent then
   if actor.status<>'active' then raise exception 'forbidden' using errcode='42501'; end if;
   new.created_by:=actor.id; new.handled_by:=actor.id;
   new.origin_entered_by_id:=actor.id; new.origin_entered_by_name:=bsd_private.origin_name(actor.id);
   -- A caller cannot claim credit for a different agent or remove their own attribution.
   new.referred_by_agent_id:=actor.id; new.referred_by_agent_name:=bsd_private.origin_name(actor.id);
  end if;
  if tg_table_name='businesses' then
   j:=to_jsonb(new);
   if nullif(j->>'seller_id','') is not null then
    select * into linked from public.leads where id=(j->>'seller_id')::uuid;
    if ordinary_agent and linked.id is not null and linked.created_by is distinct from actor.id and linked.handled_by is distinct from actor.id then
     raise exception 'seller_origin_not_owned' using errcode='42501';
    end if;
    if linked.id is not null then
     new.referred_by_agent_id:=coalesce(linked.referred_by_agent_id,new.referred_by_agent_id);
     new.referred_by_agent_name:=coalesce(linked.referred_by_agent_name,new.referred_by_agent_name);
     new.origin_entered_by_id:=coalesce(linked.origin_entered_by_id,linked.created_by,new.origin_entered_by_id);
     new.origin_entered_by_name:=coalesce(linked.origin_entered_by_name,bsd_private.origin_name(linked.created_by),new.origin_entered_by_name);
     new.original_source:=coalesce(nullif(btrim(linked.original_source),''),nullif(btrim(linked.source),''),new.original_source);
    end if;
   end if;
  end if;
  new.origin_entered_by_id:=coalesce(new.origin_entered_by_id,new.created_by,actor.id);
  new.origin_entered_by_name:=coalesce(nullif(btrim(new.origin_entered_by_name),''),bsd_private.origin_name(new.origin_entered_by_id));
  if new.referred_by_agent_id is null then
   select * into ref from public.profiles where id=new.origin_entered_by_id and role in ('agent','agent_authorized');
   if ref.id is not null then new.referred_by_agent_id:=ref.id; new.referred_by_agent_name:=bsd_private.origin_name(ref.id); end if;
  else new.referred_by_agent_name:=bsd_private.origin_name(new.referred_by_agent_id); end if;
  new.original_source:=coalesce(nullif(btrim(new.original_source),''),nullif(btrim(new.source),''));
  if coalesce(new.referred_by_agent_name,new.origin_entered_by_name,new.original_source) is null then
   raise exception 'record_origin_required' using errcode='23514';
  end if;
 else
  if ordinary_agent and (new.created_by is distinct from old.created_by or new.handled_by is distinct from old.handled_by) then
   raise exception 'ownership_is_managed_by_admin' using errcode='42501';
  end if;
  new.origin_entered_by_id:=coalesce(old.origin_entered_by_id,old.created_by,new.origin_entered_by_id);
  new.origin_entered_by_name:=coalesce(nullif(btrim(old.origin_entered_by_name),''),bsd_private.origin_name(new.origin_entered_by_id),new.origin_entered_by_name);
  if old.referred_by_agent_id is not null then
   new.referred_by_agent_id:=old.referred_by_agent_id;
   new.referred_by_agent_name:=coalesce(nullif(btrim(old.referred_by_agent_name),''),bsd_private.origin_name(old.referred_by_agent_id));
  elsif ordinary_agent then
   select * into ref from public.profiles where id=coalesce(old.origin_entered_by_id,old.created_by) and role in ('agent','agent_authorized');
   new.referred_by_agent_id:=ref.id; new.referred_by_agent_name:=bsd_private.origin_name(ref.id);
  elsif new.referred_by_agent_id is not null then new.referred_by_agent_name:=bsd_private.origin_name(new.referred_by_agent_id);
  end if;
  new.original_source:=coalesce(nullif(btrim(old.original_source),''),nullif(btrim(old.source),''),nullif(btrim(new.original_source),''),nullif(btrim(new.source),''));
 end if;
 return new;
end; $$;

create or replace function bsd_private.subscriber_origin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if old.referred_by_agent_id is not null then
   new.referred_by_agent_id:=old.referred_by_agent_id;
   new.referred_by_agent_name:=coalesce(nullif(btrim(old.referred_by_agent_name),''),bsd_private.origin_name(old.referred_by_agent_id));
  end if;
  new.origin_entered_by_id:=coalesce(old.origin_entered_by_id,new.origin_entered_by_id,new.owner_id);
  new.origin_entered_by_name:=coalesce(old.origin_entered_by_name,bsd_private.origin_name(new.origin_entered_by_id));
  new.original_source:=coalesce(nullif(btrim(old.original_source),''),nullif(btrim(old.source),''),nullif(btrim(new.original_source),''),nullif(btrim(new.source),''));
 else
  new.origin_entered_by_id:=coalesce(new.origin_entered_by_id,new.owner_id);
  new.origin_entered_by_name:=coalesce(new.origin_entered_by_name,bsd_private.origin_name(new.origin_entered_by_id));
  new.original_source:=coalesce(nullif(btrim(new.original_source),''),case when new.manual_source='call' then 'טלפון' else nullif(btrim(new.source),'') end);
 end if;
 return new;
end; $$;

-- Backfill only proven creator identities; never infer a referrer from the current handler.
update public.leads l set origin_entered_by_id=l.created_by,origin_entered_by_name=bsd_private.origin_name(l.created_by),
 original_source=coalesce(nullif(btrim(l.original_source),''),nullif(btrim(l.source),'')),
 referred_by_agent_id=case when p.role in ('agent','agent_authorized') then coalesce(l.referred_by_agent_id,p.id) else l.referred_by_agent_id end,
 referred_by_agent_name=case when p.role in ('agent','agent_authorized') then coalesce(l.referred_by_agent_name,bsd_private.origin_name(p.id)) else l.referred_by_agent_name end
from public.profiles p where p.id=l.created_by;
update public.businesses b set origin_entered_by_id=b.created_by,origin_entered_by_name=bsd_private.origin_name(b.created_by),
 original_source=coalesce(nullif(btrim(b.original_source),''),nullif(btrim(b.source),'')),
 referred_by_agent_id=case when p.role in ('agent','agent_authorized') then coalesce(b.referred_by_agent_id,p.id) else b.referred_by_agent_id end,
 referred_by_agent_name=case when p.role in ('agent','agent_authorized') then coalesce(b.referred_by_agent_name,bsd_private.origin_name(p.id)) else b.referred_by_agent_name end
from public.profiles p where p.id=b.created_by;
update public.businesses b set referred_by_agent_id=l.referred_by_agent_id,referred_by_agent_name=l.referred_by_agent_name
from public.leads l where b.seller_id=l.id and b.referred_by_agent_id is null and l.referred_by_agent_id is not null;
update public.business_alert_subscribers s set origin_entered_by_id=s.owner_id,origin_entered_by_name=bsd_private.origin_name(s.owner_id) where owner_id is not null;
notify pgrst,'reload schema';
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
      select case when public.has_full_business_access(b.id,auth.uid()) then jsonb_build_object('referred_by_agent_name', b.referred_by_agent_name, 'origin_entered_by_name', b.origin_entered_by_name, 'original_source', coalesce(b.original_source,b.source)) else jsonb_build_object('_anonymous',true) end as business_origin, jsonb_build_object('referred_by_agent_name', s.referred_by_agent_name, 'origin_entered_by_name', s.origin_entered_by_name, 'original_source', coalesce(s.original_source,s.source)) as buyer_origin, d.id, d.business_number, d.channel, d.sent_at, d.match_pct,
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
$function$
;
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
      select case when public.has_full_business_access(b.id,auth.uid()) then jsonb_build_object('referred_by_agent_name', b.referred_by_agent_name, 'origin_entered_by_name', b.origin_entered_by_name, 'original_source', coalesce(b.original_source,b.source)) else jsonb_build_object('_anonymous',true) end as business_origin, jsonb_build_object('referred_by_agent_name', s.referred_by_agent_name, 'origin_entered_by_name', s.origin_entered_by_name, 'original_source', coalesce(s.original_source,s.source)) as buyer_origin, p.*,
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
$function$
;
