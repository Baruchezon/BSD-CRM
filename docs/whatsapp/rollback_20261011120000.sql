-- Rollback of supabase/migrations/20261011120000_whatsapp_cloud_api.sql. Run only if the migration was applied.
-- Data note: dropping whatsapp_conversations / whatsapp_short_links / whatsapp_opt_outs and the new columns deletes
-- their content (conversations, removal list, consent stamps). Export them first (see GO-LIVE.md §Rollback).
begin;
drop policy if exists business_files_whatsapp_restrict_select on storage.objects;
drop policy if exists business_files_whatsapp_restrict_insert on storage.objects;
drop policy if exists business_files_whatsapp_restrict_update on storage.objects;

drop function if exists public.wa_revoke_short_link(text);
drop function if exists public.wa_resolve_short_link(text);
drop table if exists public.whatsapp_short_links;
drop function if exists public.wa_clear_opt_out(text, text);
drop function if exists public.wa_opt_out_by_phone(text, text, uuid);
drop function if exists public.wa_bump_conversation_inbound(uuid, timestamptz, text);
drop function if exists public.wa_conversation_for_inbound(text, text);
drop function if exists public.wa_match_phone(text);
drop function if exists public.wa_set_record_channel(text, uuid, text);
drop function if exists public.wa_mark_document_confirmed(uuid, text, uuid);
drop function if exists public.wa_link_conversation(uuid, text, uuid);
drop function if exists public.wa_mark_conversation_read(uuid);
drop view if exists public.whatsapp_conversation_list;

-- restore the original messages policy (lead-based only)
drop policy if exists whatsapp_messages_select on public.whatsapp_messages;
create policy whatsapp_messages_select on public.whatsapp_messages for select to public using (
  (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = any (array['admin'::user_role, 'manager'::user_role])))
  or (exists (select 1 from public.leads l where l.id = whatsapp_messages.lead_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))));
grant insert, delete, truncate on public.whatsapp_messages to anon, authenticated; -- exact grants before the migration (checked 11.10.2026)

drop index if exists public.whatsapp_messages_provider_id_uidx;
drop index if exists public.whatsapp_messages_request_id_uidx;
drop index if exists public.whatsapp_messages_conversation_idx;
drop index if exists public.whatsapp_messages_business_idx;
drop index if exists public.whatsapp_messages_broker_idx;
drop index if exists public.whatsapp_messages_outbound_recent_idx;
delete from public.whatsapp_messages where message_type not in ('template','free_text','auto_night_reply');
alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_message_type_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_message_type_check check (message_type in ('template','free_text','auto_night_reply'));
alter table public.whatsapp_messages
  drop column if exists conversation_id, drop column if exists business_id, drop column if exists broker_id, drop column if exists sent_by,
  drop column if exists template_params, drop column if exists purpose, drop column if exists is_test, drop column if exists context_message_id,
  drop column if exists button_payload, drop column if exists media_id, drop column if exists media_mime, drop column if exists media_filename,
  drop column if exists media_size, drop column if exists storage_path, drop column if exists agreement_confirmed_at,
  drop column if exists agreement_confirmed_by, drop column if exists agreement_record_table, drop column if exists agreement_record_id;
drop table if exists public.whatsapp_conversations;
drop function if exists public.wa_storage_path_access(text);
drop function if exists public.wa_conversation_access(uuid);
drop function if exists public.wa_record_access(text, uuid);

drop trigger if exists trg_leads_whatsapp_channel_guard on public.leads;
drop trigger if exists trg_businesses_whatsapp_channel_guard on public.businesses;
drop trigger if exists trg_brokers_whatsapp_channel_guard on public.brokers;
drop trigger if exists trg_leads_consent_whatsapp on public.leads;
drop trigger if exists trg_businesses_consent_whatsapp on public.businesses;
drop trigger if exists trg_brokers_consent_whatsapp on public.brokers;
drop function if exists public.bsd_whatsapp_channel_guard();
drop function if exists public.bsd_whatsapp_consent_stamp();
drop function if exists public.wa_phone_suppressed(text[]);
drop table if exists public.whatsapp_opt_outs;
do $$
declare t text;
begin
  foreach t in array array['leads','businesses','brokers'] loop
    execute format('alter table public.%1$I drop constraint if exists %1$s_whatsapp_channel_check', t);
    execute format('alter table public.%I drop column if exists whatsapp_opt_in, drop column if exists whatsapp_opt_in_at, drop column if exists whatsapp_opt_out_at,
      drop column if exists whatsapp_consent_source, drop column if exists whatsapp_marketing_opt_in, drop column if exists whatsapp_marketing_opt_in_at,
      drop column if exists whatsapp_channel', t);
  end loop;
end $$;
drop function if exists public.bsd_wa_e164(text);
commit;
-- Storage objects under business-files/whatsapp-inbound/ and whatsapp-outbound/ are NOT deleted by this script.
