-- Existing records with a known channel but no creator cannot be claimed by a client.
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
  if ordinary_agent then
   new.origin_entered_by_id:=coalesce(old.origin_entered_by_id,old.created_by);
   new.origin_entered_by_name:=coalesce(nullif(btrim(old.origin_entered_by_name),''),bsd_private.origin_name(new.origin_entered_by_id));
  end if;
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

