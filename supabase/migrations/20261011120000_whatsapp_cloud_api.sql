-- =====================================================================================================
-- WhatsApp Cloud API on +972 77-444-6707 (phone_number_id 1346024128597094) - inbox, consent, pilot flag,
-- short links, received documents. Branch eldad/whatsapp-cloud-api, 11.10.2026.
-- *** NOT APPLIED. Apply only with Baruch's explicit go (see docs/whatsapp/GO-LIVE.md). ***
-- Additive only: no existing column, row or file changes meaning. Rollback: docs/whatsapp/rollback_20261011120000.sql
-- Reuses the EXISTING empty table public.whatsapp_messages (0 rows) and adds public.whatsapp_conversations.
-- Rules: OPT-OUT ALWAYS WINS. A received document never turns a card green by itself: a person confirms it
-- in the card («אשר כהסכם חתום»), which calls the existing save_manual_signed_agreement exactly like today.
-- =====================================================================================================
begin;

-- 1) Phone normalisation (same rules as toE164 in supabase/functions/_shared/whatsapp.ts) ---------------
create or replace function public.bsd_wa_e164(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d is null or d = '' then null
    when intl and d like '00%' then regexp_replace(substr(d, 3), '^9720', '972')
    when intl then regexp_replace(d, '^9720', '972')
    when d like '0%' then '972' || substr(d, 2)
    else regexp_replace(d, '^9720', '972') end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d,
               (btrim(coalesce(p, '')) like '+%' or btrim(coalesce(p, '')) like '00%') as intl) x
$$;

-- 2) Consent + pilot channel on leads, businesses, brokers ----------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leads','businesses','brokers'] loop
    execute format($f$
      alter table public.%1$I
        add column if not exists whatsapp_opt_in boolean not null default false,
        add column if not exists whatsapp_opt_in_at timestamptz,
        add column if not exists whatsapp_opt_out_at timestamptz,
        add column if not exists whatsapp_consent_source text,
        add column if not exists whatsapp_marketing_opt_in boolean not null default false,
        add column if not exists whatsapp_marketing_opt_in_at timestamptz,
        add column if not exists whatsapp_channel text not null default 'personal'
    $f$, t);
    execute format('alter table public.%1$I drop constraint if exists %1$s_whatsapp_channel_check', t);
    execute format($f$alter table public.%1$I add constraint %1$s_whatsapp_channel_check check (whatsapp_channel in ('personal','api'))$f$, t);
    execute format($f$comment on column public.%I.whatsapp_channel is 'וואטסאפ: personal = כפתורי wa.me מהנייד (היום), api = שליחה וקבלה דרך 077-444-6707 ב-CRM. רק מנהל משנה.'$f$, t);
    execute format($f$comment on column public.%I.whatsapp_opt_in is 'מאשר הודעות וואטסאפ תפעוליות מ-BSD (ברירת מחדל: לא). חותמת זמן נקבעת בשרת.'$f$, t);
    execute format($f$comment on column public.%I.whatsapp_marketing_opt_in is 'מאשר גם הודעות פרסומת בוואטסאפ (חוק הספאם, סעיף 30א). הסרה מבטלת גם את זה.'$f$, t);
  end loop;
end $$;

-- 3) Phone-level removal list: once a number says «הסר»/STOP it is blocked on every card ------------------
create table if not exists public.whatsapp_opt_outs (
  phone_e164   text primary key check (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  opted_out_at timestamptz not null default now(),
  source       text not null default 'whatsapp_stop',
  message_id   uuid,
  cleared_at   timestamptz,
  cleared_by   uuid references public.profiles(id),
  clear_reason text
);
alter table public.whatsapp_opt_outs enable row level security;
revoke all on public.whatsapp_opt_outs from anon, authenticated;
grant select on public.whatsapp_opt_outs to authenticated;
drop policy if exists whatsapp_opt_outs_select on public.whatsapp_opt_outs;
create policy whatsapp_opt_outs_select on public.whatsapp_opt_outs for select to authenticated using (public.is_admin_or_manager(auth.uid()));

create or replace function public.wa_phone_suppressed(p_phones text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.whatsapp_opt_outs o
                  where o.cleared_at is null
                    and o.phone_e164 = any (select public.bsd_wa_e164(x) from unnest(p_phones) x where x is not null))
$$;

-- 4) Consent stamps (server-side only) + opt-out-wins + channel guard ------------------------------------
create or replace function public.bsd_whatsapp_consent_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  phones text[];
  src text := nullif(btrim(coalesce(new.whatsapp_consent_source, '')), '');
begin
  if tg_table_name = 'leads' then phones := array[new.phone, new.phone2];
  elsif tg_table_name = 'businesses' then phones := array[new.owner_phone];
  else phones := array[new.phone]; end if;
  if src is null or src not in ('crm','website','lead_transfer','whatsapp_stop','whatsapp_button','meta_opt_out','suppressed','phone_call') then src := 'crm'; end if;
  if tg_op = 'INSERT' then
    new.whatsapp_opt_in_at := null; new.whatsapp_opt_out_at := null; new.whatsapp_consent_source := null; new.whatsapp_marketing_opt_in_at := null;
    if new.whatsapp_opt_in or new.whatsapp_marketing_opt_in then
      if public.wa_phone_suppressed(phones) then
        new.whatsapp_opt_in := false; new.whatsapp_marketing_opt_in := false; new.whatsapp_opt_out_at := now(); new.whatsapp_consent_source := 'suppressed';
      else
        if new.whatsapp_opt_in then new.whatsapp_opt_in_at := now(); end if;
        if new.whatsapp_marketing_opt_in then new.whatsapp_marketing_opt_in_at := now(); end if;
        new.whatsapp_consent_source := src;
      end if;
    end if;
    return new;
  end if;
  new.whatsapp_opt_in_at := old.whatsapp_opt_in_at;
  new.whatsapp_opt_out_at := old.whatsapp_opt_out_at;
  new.whatsapp_marketing_opt_in_at := old.whatsapp_marketing_opt_in_at;
  if (new.whatsapp_opt_in and not old.whatsapp_opt_in) or (new.whatsapp_marketing_opt_in and not old.whatsapp_marketing_opt_in) then
    if public.wa_phone_suppressed(phones) then
      new.whatsapp_opt_in := old.whatsapp_opt_in; new.whatsapp_marketing_opt_in := old.whatsapp_marketing_opt_in;
      new.whatsapp_consent_source := old.whatsapp_consent_source;                 -- opt-out wins, nothing changes
      return new;
    end if;
  end if;
  if new.whatsapp_opt_in is distinct from old.whatsapp_opt_in then
    if new.whatsapp_opt_in then new.whatsapp_opt_in_at := now();
    else new.whatsapp_opt_out_at := now(); new.whatsapp_marketing_opt_in := false; end if;
    new.whatsapp_consent_source := src;
  end if;
  if new.whatsapp_marketing_opt_in is distinct from old.whatsapp_marketing_opt_in then
    if new.whatsapp_marketing_opt_in then new.whatsapp_marketing_opt_in_at := now(); end if;
    new.whatsapp_consent_source := src;
  elsif new.whatsapp_opt_in is not distinct from old.whatsapp_opt_in then
    new.whatsapp_consent_source := old.whatsapp_consent_source;
  end if;
  if new.whatsapp_opt_in and public.wa_phone_suppressed(phones) then -- phone edited to a number that asked for removal
    new.whatsapp_opt_in := false; new.whatsapp_marketing_opt_in := false; new.whatsapp_opt_out_at := now(); new.whatsapp_consent_source := 'suppressed';
  end if;
  return new;
end;
$$;

create or replace function public.bsd_whatsapp_channel_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Only admin/manager (or the service role, auth.uid() null) may switch a record between 054 and the API.
  if new.whatsapp_channel is distinct from old.whatsapp_channel and auth.uid() is not null and not public.is_admin_or_manager(auth.uid()) then
    raise exception 'רק מנהל יכול להעביר כרטיס לערוץ וואטסאפ אחר';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_consent_whatsapp on public.leads;
create trigger trg_leads_consent_whatsapp before insert or update of whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_opt_out_at, whatsapp_consent_source, whatsapp_marketing_opt_in, phone, phone2
  on public.leads for each row execute function public.bsd_whatsapp_consent_stamp();
drop trigger if exists trg_businesses_consent_whatsapp on public.businesses;
create trigger trg_businesses_consent_whatsapp before insert or update of whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_opt_out_at, whatsapp_consent_source, whatsapp_marketing_opt_in, owner_phone
  on public.businesses for each row execute function public.bsd_whatsapp_consent_stamp();
drop trigger if exists trg_brokers_consent_whatsapp on public.brokers;
create trigger trg_brokers_consent_whatsapp before insert or update of whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_opt_out_at, whatsapp_consent_source, whatsapp_marketing_opt_in, phone
  on public.brokers for each row execute function public.bsd_whatsapp_consent_stamp();
drop trigger if exists trg_leads_whatsapp_channel_guard on public.leads;
create trigger trg_leads_whatsapp_channel_guard before update of whatsapp_channel on public.leads for each row execute function public.bsd_whatsapp_channel_guard();
drop trigger if exists trg_businesses_whatsapp_channel_guard on public.businesses;
create trigger trg_businesses_whatsapp_channel_guard before update of whatsapp_channel on public.businesses for each row execute function public.bsd_whatsapp_channel_guard();
drop trigger if exists trg_brokers_whatsapp_channel_guard on public.brokers;
create trigger trg_brokers_whatsapp_channel_guard before update of whatsapp_channel on public.brokers for each row execute function public.bsd_whatsapp_channel_guard();

-- 5) Conversations (one per phone number) ------------------------------------------------------------------
create table if not exists public.whatsapp_conversations (
  id                   uuid primary key default gen_random_uuid(),
  phone_e164           text not null unique check (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  profile_name         text,
  record_table         text check (record_table in ('leads','businesses','brokers')),
  record_id            uuid,
  link_source          text,          -- auto_phone / outbound / manual
  linked_by            uuid references public.profiles(id),
  ambiguous            boolean not null default false,
  candidates           jsonb,
  last_message_at      timestamptz,
  last_message_preview text,
  last_direction       text check (last_direction in ('inbound','outbound')),
  last_inbound_at      timestamptz,   -- 24h customer-service window
  unread_count         integer not null default 0,
  last_read_at         timestamptz,
  last_read_by         uuid references public.profiles(id),
  archived             boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((record_table is null) = (record_id is null))
);
create index if not exists whatsapp_conversations_record_idx on public.whatsapp_conversations (record_table, record_id) where record_id is not null;
create index if not exists whatsapp_conversations_recent_idx on public.whatsapp_conversations (last_message_at desc nulls last);
comment on table public.whatsapp_conversations is 'וואטסאפ 077-444-6707: שיחה לכל מספר טלפון, משויכת לכרטיס (ליד/עסק/מתווך) או ממתינה לשיוך';

-- 6) Messages: reuse public.whatsapp_messages (exists, 0 rows) ------------------------------------------
alter table public.whatsapp_messages
  add column if not exists conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  add column if not exists business_id uuid references public.businesses(id) on delete set null,
  add column if not exists broker_id uuid references public.brokers(id) on delete set null,
  add column if not exists sent_by uuid references public.profiles(id),
  add column if not exists template_params jsonb,
  add column if not exists purpose text,
  add column if not exists is_test boolean not null default false,
  add column if not exists context_message_id text,
  add column if not exists button_payload text,
  add column if not exists media_id text,
  add column if not exists media_mime text,
  add column if not exists media_filename text,
  add column if not exists media_size bigint,
  add column if not exists storage_path text,
  add column if not exists agreement_confirmed_at timestamptz,
  add column if not exists agreement_confirmed_by uuid references public.profiles(id),
  add column if not exists agreement_record_table text,
  add column if not exists agreement_record_id uuid;
alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_message_type_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_message_type_check check (message_type in
  ('template','free_text','auto_night_reply','text','document','image','audio','video','sticker','location','contacts','interactive','button','reaction','unsupported'));
create unique index if not exists whatsapp_messages_provider_id_uidx on public.whatsapp_messages (provider_message_id) where provider_message_id is not null;
create unique index if not exists whatsapp_messages_request_id_uidx on public.whatsapp_messages (client_request_id) where client_request_id is not null;
create index if not exists whatsapp_messages_conversation_idx on public.whatsapp_messages (conversation_id, created_at desc);
create index if not exists whatsapp_messages_business_idx on public.whatsapp_messages (business_id) where business_id is not null;
create index if not exists whatsapp_messages_broker_idx on public.whatsapp_messages (broker_id) where broker_id is not null;
create index if not exists whatsapp_messages_outbound_recent_idx on public.whatsapp_messages (created_at desc) where direction = 'outbound';
comment on column public.whatsapp_messages.storage_path is 'קובץ שהתקבל/נשלח: business-files/whatsapp-inbound|whatsapp-outbound/<conversation>/...';
comment on column public.whatsapp_messages.agreement_confirmed_at is 'מתי אדם אישר את הקובץ כהסכם חתום (הירוק עצמו נקבע ב-save_manual_signed_agreement)';
-- statuses: sending / accepted / sent / delivered / read / failed / uncertain / refused / simulated / received

-- 7) Access helpers (run as the caller; same rules as the CRM cards) -------------------------------------
create or replace function public.wa_record_access(p_table text, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or p_id is null then false
    when not public.is_active_user() or public.is_viewer_only() then false
    when public.is_admin_or_manager(auth.uid()) then true
    when p_table = 'businesses' then public.has_full_business_access(p_id, auth.uid())
    when p_table = 'leads' then exists (select 1 from public.leads l where l.id = p_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
                                or public.has_lead_view_access(p_id)
    when p_table = 'brokers' then public.is_broker_viewer()
                                or exists (select 1 from public.brokers b where b.id = p_id and (b.created_by = auth.uid() or b.handled_by = auth.uid()))
    else false end
$$;

create or replace function public.wa_conversation_access(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or p_conversation_id is null then false
    when not public.is_active_user() or public.is_viewer_only() then false
    when public.is_admin_or_manager(auth.uid()) then true
    else exists (select 1 from public.whatsapp_conversations c
                  where c.id = p_conversation_id and c.record_id is not null and public.wa_record_access(c.record_table, c.record_id))
      or exists (select 1 from public.whatsapp_messages m
                  where m.conversation_id = p_conversation_id
                    and ((m.lead_id is not null and public.wa_record_access('leads', m.lead_id))
                      or (m.business_id is not null and public.wa_record_access('businesses', m.business_id))
                      or (m.broker_id is not null and public.wa_record_access('brokers', m.broker_id))))
    end
$$;

create or replace function public.wa_storage_path_access(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(coalesce(p_path, ''), '/');
begin
  if auth.uid() is null or p_path is null or p_path like '%..%' or not public.is_active_user() or public.is_viewer_only() then return false; end if;
  if public.is_admin_or_manager(auth.uid()) then return true; end if;
  if parts[1] = 'agreements' and array_length(parts, 1) = 3 then
    return public.has_agreement_record_access(parts[2], public.safe_uuid(regexp_replace(parts[3], '\.pdf$', '', 'i')), auth.uid());
  end if;
  if parts[1] in ('whatsapp-inbound','whatsapp-outbound') then
    return public.wa_conversation_access(public.safe_uuid(parts[2]));
  end if;
  if public.safe_uuid(parts[1]) is not null then
    return public.has_full_business_access(public.safe_uuid(parts[1]), auth.uid());
  end if;
  return false;
end;
$$;

-- 8) RLS -----------------------------------------------------------------------------------------------
alter table public.whatsapp_conversations enable row level security;
revoke all on public.whatsapp_conversations from anon;
revoke insert, update, delete, truncate on public.whatsapp_conversations from authenticated;
grant select on public.whatsapp_conversations to authenticated;
drop policy if exists whatsapp_conversations_select on public.whatsapp_conversations;
create policy whatsapp_conversations_select on public.whatsapp_conversations for select to authenticated using (public.wa_conversation_access(id));

drop policy if exists whatsapp_messages_select on public.whatsapp_messages;
create policy whatsapp_messages_select on public.whatsapp_messages for select to authenticated using (
  public.wa_conversation_access(conversation_id)
  or (lead_id is not null and public.wa_record_access('leads', lead_id))
  or (business_id is not null and public.wa_record_access('businesses', business_id))
  or (broker_id is not null and public.wa_record_access('brokers', broker_id))
);
-- Only the edge functions (service role) and the SECURITY DEFINER RPCs below write messages/conversations.
revoke insert, delete, truncate on public.whatsapp_messages from anon, authenticated;

-- Conversation list for the inbox (RLS of every underlying table applies: security_invoker).
create or replace view public.whatsapp_conversation_list with (security_invoker = true) as
  select c.*,
         coalesce(l.full_name, nullif(concat_ws(' · ', b.owner_name, b.internal_name), ''), br.full_name) as record_label,
         case c.record_table when 'leads' then (case l.type::text when 'buyer' then 'קונה' when 'seller' then 'מוכר' when 'partner' then 'שותף' else 'ליד' end)
                             when 'businesses' then 'בעל עסק' when 'brokers' then 'מתווך' end as record_kind_label
    from public.whatsapp_conversations c
    left join public.leads l on c.record_table = 'leads' and l.id = c.record_id
    left join public.businesses b on c.record_table = 'businesses' and b.id = c.record_id
    left join public.brokers br on c.record_table = 'brokers' and br.id = c.record_id;
grant select on public.whatsapp_conversation_list to authenticated;
revoke all on public.whatsapp_conversation_list from anon;

-- 9) CRM RPCs ------------------------------------------------------------------------------------------
create or replace function public.wa_mark_conversation_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_conversation_access(p_conversation_id) then raise exception 'אין הרשאה לשיחה זו'; end if;
  update public.whatsapp_conversations set unread_count = 0, last_read_at = now(), last_read_by = auth.uid() where id = p_conversation_id;
end;
$$;

-- Link (or re-link) a conversation to a record. Needs access to the conversation AND to the target record.
create or replace function public.wa_link_conversation(p_conversation_id uuid, p_table text, p_record_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_table not in ('leads','businesses','brokers') then raise exception 'טבלה לא נתמכת'; end if;
  if not public.wa_conversation_access(p_conversation_id) then raise exception 'אין הרשאה לשיחה זו'; end if;
  if not public.wa_record_access(p_table, p_record_id) then raise exception 'אין הרשאה לכרטיס זה'; end if;
  update public.whatsapp_conversations
     set record_table = p_table, record_id = p_record_id, ambiguous = false, candidates = null, link_source = 'manual', linked_by = auth.uid(), updated_at = now()
   where id = p_conversation_id;
  update public.whatsapp_messages
     set lead_id = case when p_table = 'leads' then p_record_id else lead_id end,
         business_id = case when p_table = 'businesses' then p_record_id else business_id end,
         broker_id = case when p_table = 'brokers' then p_record_id else broker_id end
   where conversation_id = p_conversation_id and direction = 'inbound' and lead_id is null and business_id is null and broker_id is null;
end;
$$;

-- After the CRM copied a received file to agreements/<table>/<id>.pdf and called save_manual_signed_agreement
-- (which turns the card green, exactly like the manual upload), it stamps the WhatsApp message as confirmed.
create or replace function public.wa_mark_document_confirmed(p_message_id uuid, p_table text, p_record_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.whatsapp_messages;
begin
  select * into m from public.whatsapp_messages where id = p_message_id;
  if m.id is null or m.direction <> 'inbound' or m.storage_path is null then raise exception 'הודעה לא נמצאה או שאין בה קובץ'; end if;
  if not public.wa_conversation_access(m.conversation_id) then raise exception 'אין הרשאה לשיחה זו'; end if;
  if not public.has_agreement_record_access(p_table, p_record_id, auth.uid()) then raise exception 'אין הרשאה לעדכן הסכם עבור רשומה זו'; end if;
  if not exists (select 1 from public.businesses where p_table = 'businesses' and id = p_record_id and agreement_pdf_path = 'agreements/businesses/' || p_record_id || '.pdf' and agreement_status = 'יש הסכם חתום'
                 union all select 1 from public.leads where p_table = 'leads' and id = p_record_id and agreement_pdf_path = 'agreements/leads/' || p_record_id || '.pdf' and agreement_status = 'יש הסכם חתום'
                 union all select 1 from public.brokers where p_table = 'brokers' and id = p_record_id and agreement_pdf_path = 'agreements/brokers/' || p_record_id || '.pdf' and agreement_status = 'יש הסכם חתום') then
    raise exception 'ההסכם עדיין לא נשמר בכרטיס';
  end if;
  update public.whatsapp_messages set agreement_confirmed_at = now(), agreement_confirmed_by = auth.uid(), agreement_record_table = p_table, agreement_record_id = p_record_id
   where id = p_message_id;
end;
$$;

create or replace function public.wa_set_record_channel(p_table text, p_record_id uuid, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_or_manager(auth.uid()) then raise exception 'רק מנהל יכול להעביר כרטיס לערוץ וואטסאפ אחר'; end if;
  if p_channel not in ('personal','api') then raise exception 'ערוץ לא תקין'; end if;
  if p_table = 'leads' then update public.leads set whatsapp_channel = p_channel where id = p_record_id;
  elsif p_table = 'businesses' then update public.businesses set whatsapp_channel = p_channel where id = p_record_id;
  elsif p_table = 'brokers' then update public.brokers set whatsapp_channel = p_channel where id = p_record_id;
  else raise exception 'טבלה לא נתמכת'; end if;
  insert into public.activity_log(user_id, action_type, entity_type, entity_id, old_value, new_value)
  values (auth.uid(), 'whatsapp_channel_change', p_table, p_record_id, null, jsonb_build_object('whatsapp_channel', p_channel));
end;
$$;

-- 10) Service-role helpers used by the edge functions -------------------------------------------------
create or replace function public.wa_match_phone(p_e164 text)
returns table(kind text, id uuid, is_archived boolean)
language sql stable security definer set search_path = '' as $$
  select 'leads'::text, l.id, coalesce(l.is_archived, false) from public.leads l
   where public.bsd_wa_e164(l.phone) = p_e164 or public.bsd_wa_e164(l.phone2) = p_e164
  union all
  select 'businesses'::text, b.id, coalesce(b.is_archived, false) from public.businesses b where public.bsd_wa_e164(b.owner_phone) = p_e164
  union all
  select 'brokers'::text, r.id, coalesce(r.is_archived, false) from public.brokers r where public.bsd_wa_e164(r.phone) = p_e164
$$;

create or replace function public.wa_conversation_for_inbound(p_e164 text, p_profile_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.whatsapp_conversations;
begin
  insert into public.whatsapp_conversations (phone_e164, profile_name) values (p_e164, nullif(left(coalesce(p_profile_name, ''), 80), ''))
  on conflict (phone_e164) do update set profile_name = coalesce(excluded.profile_name, public.whatsapp_conversations.profile_name)
  returning * into c;
  return jsonb_build_object('id', c.id, 'record_table', c.record_table, 'record_id', c.record_id, 'ambiguous', c.ambiguous);
end;
$$;

create or replace function public.wa_bump_conversation_inbound(p_id uuid, p_at timestamptz, p_preview text)
returns void language sql security definer set search_path = '' as $$
  update public.whatsapp_conversations
     set last_message_at = greatest(coalesce(last_message_at, p_at), p_at),
         last_inbound_at = greatest(coalesce(last_inbound_at, p_at), p_at),
         last_message_preview = case when last_message_at is null or p_at >= last_message_at then left(p_preview, 140) else last_message_preview end,
         last_direction = case when last_message_at is null or p_at >= last_message_at then 'inbound' else last_direction end,
         unread_count = unread_count + 1, archived = false, updated_at = now()
   where id = p_id
$$;

-- «הסר» / STOP / quick reply «הסר אותי»: suppress the number and switch OFF consent on every card with it.
create or replace function public.wa_opt_out_by_phone(p_e164 text, p_source text default 'whatsapp_stop', p_message_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n1 integer; n2 integer; n3 integer;
begin
  if p_e164 is null or p_e164 !~ '^[1-9][0-9]{7,14}$' then return 0; end if;
  insert into public.whatsapp_opt_outs (phone_e164, source, message_id) values (p_e164, coalesce(p_source, 'whatsapp_stop'), p_message_id)
  on conflict (phone_e164) do update set opted_out_at = now(), source = excluded.source, message_id = excluded.message_id, cleared_at = null, cleared_by = null, clear_reason = null;
  update public.leads set whatsapp_opt_in = false, whatsapp_marketing_opt_in = false, whatsapp_consent_source = 'whatsapp_stop'
   where (whatsapp_opt_in or whatsapp_marketing_opt_in) and (public.bsd_wa_e164(phone) = p_e164 or public.bsd_wa_e164(phone2) = p_e164);
  get diagnostics n1 = row_count;
  update public.businesses set whatsapp_opt_in = false, whatsapp_marketing_opt_in = false, whatsapp_consent_source = 'whatsapp_stop'
   where (whatsapp_opt_in or whatsapp_marketing_opt_in) and public.bsd_wa_e164(owner_phone) = p_e164;
  get diagnostics n2 = row_count;
  update public.brokers set whatsapp_opt_in = false, whatsapp_marketing_opt_in = false, whatsapp_consent_source = 'whatsapp_stop'
   where (whatsapp_opt_in or whatsapp_marketing_opt_in) and public.bsd_wa_e164(phone) = p_e164;
  get diagnostics n3 = row_count;
  return n1 + n2 + n3;
end;
$$;

create or replace function public.wa_clear_opt_out(p_e164 text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'רק מנהל מערכת'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'חובה לרשום סיבה'; end if;
  update public.whatsapp_opt_outs set cleared_at = now(), cleared_by = auth.uid(), clear_reason = btrim(p_reason) where phone_e164 = p_e164 and cleared_at is null;
end;
$$;

-- 11) Short links (BSD /go/<code>), carrying the record id inside the stored target --------------------
create table if not exists public.whatsapp_short_links (
  code          text primary key check (code ~ '^[A-Za-z0-9]{8,16}$'),
  target_url    text not null check (target_url like 'https://%'),
  kind          text not null check (kind in ('agreement','portal','vip','training','file','other')),
  record_table  text check (record_table in ('leads','businesses','brokers')),
  record_id     uuid,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  clicks        integer not null default 0,
  last_click_at timestamptz
);
create index if not exists whatsapp_short_links_record_idx on public.whatsapp_short_links (record_table, record_id, kind, created_at desc);
alter table public.whatsapp_short_links enable row level security;
revoke all on public.whatsapp_short_links from anon, authenticated;
grant select on public.whatsapp_short_links to authenticated;
drop policy if exists whatsapp_short_links_select on public.whatsapp_short_links;
create policy whatsapp_short_links_select on public.whatsapp_short_links for select to authenticated
  using (record_id is not null and public.wa_record_access(record_table, record_id));

create or replace function public.wa_resolve_short_link(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  update public.whatsapp_short_links set clicks = clicks + 1, last_click_at = now()
   where code = p_code and revoked_at is null and expires_at > now()
  returning target_url into t;
  return t;
end;
$$;

create or replace function public.wa_revoke_short_link(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.whatsapp_short_links;
begin
  select * into r from public.whatsapp_short_links where code = p_code;
  if r.code is null then return; end if;
  if not (public.is_admin_or_manager(auth.uid()) or (r.record_id is not null and public.wa_record_access(r.record_table, r.record_id))) then raise exception 'אין הרשאה'; end if;
  update public.whatsapp_short_links set revoked_at = now() where code = p_code and revoked_at is null;
end;
$$;

-- 12) Storage: received/sent WhatsApp files are readable only with access to the conversation -----------
drop policy if exists business_files_whatsapp_restrict_select on storage.objects;
create policy business_files_whatsapp_restrict_select on storage.objects as restrictive for select to public using (
  bucket_id <> 'business-files' or (storage.foldername(name))[1] not in ('whatsapp-inbound','whatsapp-outbound')
  or public.wa_storage_path_access(name));
drop policy if exists business_files_whatsapp_restrict_insert on storage.objects;
create policy business_files_whatsapp_restrict_insert on storage.objects as restrictive for insert to public with check (
  bucket_id <> 'business-files' or (storage.foldername(name))[1] not in ('whatsapp-inbound','whatsapp-outbound'));
drop policy if exists business_files_whatsapp_restrict_update on storage.objects;
create policy business_files_whatsapp_restrict_update on storage.objects as restrictive for update to public using (
  bucket_id <> 'business-files' or (storage.foldername(name))[1] not in ('whatsapp-inbound','whatsapp-outbound'));

-- 13) Grants: CRM-callable vs service-role-only ----------------------------------------------------------
revoke execute on function public.wa_phone_suppressed(text[]), public.wa_match_phone(text), public.wa_conversation_for_inbound(text, text),
  public.wa_bump_conversation_inbound(uuid, timestamptz, text), public.wa_opt_out_by_phone(text, text, uuid), public.wa_resolve_short_link(text)
  from public, anon, authenticated;
grant execute on function public.wa_phone_suppressed(text[]), public.wa_match_phone(text), public.wa_conversation_for_inbound(text, text),
  public.wa_bump_conversation_inbound(uuid, timestamptz, text), public.wa_opt_out_by_phone(text, text, uuid), public.wa_resolve_short_link(text)
  to service_role;
revoke execute on function public.wa_record_access(text, uuid), public.wa_conversation_access(uuid), public.wa_storage_path_access(text),
  public.wa_mark_conversation_read(uuid), public.wa_link_conversation(uuid, text, uuid), public.wa_mark_document_confirmed(uuid, text, uuid),
  public.wa_set_record_channel(text, uuid, text), public.wa_clear_opt_out(text, text), public.wa_revoke_short_link(text) from public, anon;
grant execute on function public.wa_record_access(text, uuid), public.wa_conversation_access(uuid), public.wa_storage_path_access(text),
  public.wa_mark_conversation_read(uuid), public.wa_link_conversation(uuid, text, uuid), public.wa_mark_document_confirmed(uuid, text, uuid),
  public.wa_set_record_channel(text, uuid, text), public.wa_clear_opt_out(text, text), public.wa_revoke_short_link(text) to authenticated, service_role;
revoke execute on function public.bsd_whatsapp_consent_stamp(), public.bsd_whatsapp_channel_guard() from public, anon, authenticated;

commit;
