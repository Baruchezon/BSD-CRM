-- Assertions for the WhatsApp migration. Every failure raises; the runner stops on the first error.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(c, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false); end $$;

-- fixture users and records
insert into profiles values ('00000000-0000-4000-8000-00000000000a','admin','active','Admin',true), ('00000000-0000-4000-8000-00000000000b','agent','active','Agent A',true),
  ('00000000-0000-4000-8000-00000000000c','agent','active','Agent C',false), ('00000000-0000-4000-8000-00000000000d','viewer','active','Viewer',false),
  ('00000000-0000-4000-8000-00000000000e','manager','active','Manager',true);
insert into businesses (id, owner_name, internal_name, owner_phone, created_by) values ('10000000-0000-4000-8000-000000000001','בעלים בדיקה','עסק בדיקה','050-1234567','00000000-0000-4000-8000-00000000000b');
insert into leads (id, type, full_name, phone, phone2, created_by) values ('20000000-0000-4000-8000-000000000001','buyer','קונה בדיקה','052-1111111','054-2424999','00000000-0000-4000-8000-00000000000c'),
  ('20000000-0000-4000-8000-000000000002','buyer','כפול','053-3333333',null,'00000000-0000-4000-8000-00000000000c');
insert into brokers (id, full_name, phone, created_by) values ('30000000-0000-4000-8000-000000000001','מתווך בדיקה','053-3333333','00000000-0000-4000-8000-00000000000c');

-- columns + defaults
select pg_temp.ok((select whatsapp_channel = 'personal' and not whatsapp_opt_in from businesses limit 1), 'new columns default to personal / no consent');

-- service role: inbound conversation + bump + match
set role service_role;
select pg_temp.ok((select count(*) = 2 from wa_match_phone('972533333333')), 'wa_match_phone finds lead + broker on the same phone (ambiguous)');
select pg_temp.ok((select count(*) = 1 from wa_match_phone('972542424999')), 'wa_match_phone matches leads.phone2');
select pg_temp.ok((wa_conversation_for_inbound('972501234567', 'דני')->>'id') = (wa_conversation_for_inbound('972501234567', null)->>'id'), 'conversation per phone is idempotent');
update whatsapp_conversations set record_table = 'businesses', record_id = '10000000-0000-4000-8000-000000000001', link_source = 'auto_phone' where phone_e164 = '972501234567';
select wa_bump_conversation_inbound((select id from whatsapp_conversations where phone_e164 = '972501234567'), now(), 'שלום');
select wa_bump_conversation_inbound((select id from whatsapp_conversations where phone_e164 = '972501234567'), now() - interval '1 hour', 'ישן');
select pg_temp.ok((select unread_count = 2 and last_message_preview = 'שלום' and profile_name = 'דני' from whatsapp_conversations where phone_e164 = '972501234567'), 'bump: unread +1, older event does not replace preview');
insert into whatsapp_messages (event_kind, direction, message_type, phone_e164, status, conversation_id, provider_message_id, storage_path, media_filename, media_mime)
  select 'inbound_message','inbound','document','972501234567','received', id, 'wamid.TEST1', 'whatsapp-inbound/' || id || '/m1-signed.pdf', 'signed.pdf', 'application/pdf' from whatsapp_conversations where phone_e164 = '972501234567';
select pg_temp.ok((select count(*) = 1 from whatsapp_messages), 'service role can insert new message types (document)');
do $$ begin
  insert into whatsapp_messages (event_kind, direction, message_type, phone_e164, status, provider_message_id) values ('inbound_message','inbound','text','972501234567','received','wamid.TEST1');
  raise exception 'FAIL: duplicate provider id accepted';
exception when unique_violation then raise notice 'ok - duplicate provider_message_id rejected (webhook retries are idempotent)'; end $$;
insert into storage.objects (bucket_id, name) select 'business-files', 'whatsapp-inbound/' || id || '/m1-signed.pdf' from whatsapp_conversations where phone_e164 = '972501234567';
select null from wa_conversation_for_inbound('972599999999', null); -- unlinked stranger
insert into whatsapp_short_links (code, target_url, kind, record_table, record_id, expires_at) values
  ('GoodCode12', 'https://baruchezon.github.io/bsd-contracts/bsd-contract-signing-seller.html?rid=x', 'agreement', 'businesses', '10000000-0000-4000-8000-000000000001', now() + interval '1 day'),
  ('OldCode123', 'https://baruchezon.github.io/x', 'agreement', 'businesses', '10000000-0000-4000-8000-000000000001', now() - interval '1 day');
select pg_temp.ok(wa_resolve_short_link('GoodCode12') like 'https://baruchezon.github.io/%', 'short link resolves');
select pg_temp.ok(wa_resolve_short_link('OldCode123') is null, 'expired short link does not resolve');
select pg_temp.ok((select clicks = 1 from whatsapp_short_links where code = 'GoodCode12'), 'click counted');
reset role;

-- RLS: who sees what
set role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.ok((select count(*) = 1 from whatsapp_conversations), 'agent A sees only the conversation of his business');
select pg_temp.ok((select count(*) = 1 from whatsapp_messages), 'agent A sees its messages');
select pg_temp.ok((select count(*) = 1 from storage.objects where name like 'whatsapp-inbound/%'), 'agent A can read the received file');
select pg_temp.ok((select record_label = 'בעלים בדיקה · עסק בדיקה' and record_kind_label = 'בעל עסק' from whatsapp_conversation_list), 'inbox list shows the linked record label');
select pg_temp.ok((select count(*) = 2 from whatsapp_short_links), 'agent A sees the short links of his record');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
select pg_temp.ok((select count(*) = 0 from whatsapp_conversations), 'agent C sees no foreign conversation and not the unlinked one');
select pg_temp.ok((select count(*) = 0 from whatsapp_messages), 'agent C sees no foreign message');
select pg_temp.ok((select count(*) = 0 from storage.objects where name like 'whatsapp-inbound/%'), 'agent C cannot read the received file (restrictive policy beats storage_select)');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000d');
select pg_temp.ok((select count(*) = 0 from whatsapp_conversations), 'viewer sees no WhatsApp');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000e');
select pg_temp.ok((select count(*) = 2 from whatsapp_conversations), 'manager sees all conversations incl. unlinked');

-- writes are blocked for CRM users
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
do $$ begin insert into whatsapp_messages (event_kind, direction, message_type, phone_e164, status) values ('outbound_attempt','outbound','text','972501234567','sent');
  raise exception 'FAIL: authenticated insert allowed'; exception when insufficient_privilege then raise notice 'ok - CRM users cannot insert messages directly'; end $$;
do $$ begin insert into whatsapp_conversations (phone_e164) values ('972500000000');
  raise exception 'FAIL: authenticated conversation insert allowed'; exception when insufficient_privilege then raise notice 'ok - CRM users cannot create conversations directly'; end $$;
do $$ begin insert into storage.objects (bucket_id, name) values ('business-files', 'whatsapp-inbound/x/y.pdf');
  raise exception 'FAIL: user wrote into whatsapp-inbound'; exception when insufficient_privilege then raise notice 'ok - CRM users cannot write into whatsapp-inbound'; end $$;
do $$ begin perform wa_resolve_short_link('GoodCode12');
  raise exception 'FAIL: authenticated may resolve links'; exception when insufficient_privilege then raise notice 'ok - only the service role resolves short links'; end $$;
do $$ begin perform wa_match_phone('972501234567');
  raise exception 'FAIL: authenticated may match phones'; exception when insufficient_privilege then raise notice 'ok - wa_match_phone is service-role only'; end $$;

-- mark read
select wa_mark_conversation_read((select id from whatsapp_conversations));
select pg_temp.ok((select unread_count = 0 from whatsapp_conversations), 'mark read resets unread');

-- channel flag: only admin/manager
do $$ begin update businesses set whatsapp_channel = 'api' where id = '10000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: agent switched channel'; exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok - agent cannot switch a card to the API channel'; end $$;
do $$ begin
  insert into leads (id, type, full_name, phone, created_by, whatsapp_channel)
  values ('20000000-0000-4000-8000-000000000099','buyer','חדש','050-9998877','00000000-0000-4000-8000-00000000000b','api');
  raise exception 'FAIL: agent created a card on the API channel';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok - agent cannot create a card already on the API channel'; end $$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
insert into leads (id, type, full_name, phone, created_by, whatsapp_channel)
  values ('20000000-0000-4000-8000-000000000098','buyer','מנהל','050-9998876','00000000-0000-4000-8000-00000000000a','api');
select pg_temp.ok((select whatsapp_channel = 'api' from leads where id = '20000000-0000-4000-8000-000000000098'), 'admin can create a card on the API channel');
select wa_set_record_channel('businesses', '10000000-0000-4000-8000-000000000001', 'api');
select pg_temp.ok((select whatsapp_channel = 'api' from businesses where id = '10000000-0000-4000-8000-000000000001'), 'admin switches the pilot business to api');

-- received PDF -> «אשר כהסכם חתום»: NOT green before the existing upload RPC, green after, exactly like today
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.ok((select agreement_status = 'אין הסכם' from businesses where id = '10000000-0000-4000-8000-000000000001'), 'a received document alone never turns the card green');
do $$ begin perform wa_mark_document_confirmed((select id from whatsapp_messages limit 1), 'businesses', '10000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: confirmed before the agreement was saved'; exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok - confirmation refused until the agreement PDF is saved on the card'; end $$;
select save_manual_signed_agreement('businesses', '10000000-0000-4000-8000-000000000001', 'agreements/businesses/10000000-0000-4000-8000-000000000001.pdf', '00000000-0000-4000-8000-00000000000b');
select wa_mark_document_confirmed((select id from whatsapp_messages limit 1), 'businesses', '10000000-0000-4000-8000-000000000001');
select pg_temp.ok((select agreement_status = 'יש הסכם חתום' from businesses where id = '10000000-0000-4000-8000-000000000001'), 'card is green after the existing save_manual_signed_agreement');
select pg_temp.ok((select agreement_confirmed_by = '00000000-0000-4000-8000-00000000000b' from whatsapp_messages limit 1), 'message stamped as confirmed agreement');

-- linking
select pg_temp.as_user('00000000-0000-4000-8000-00000000000e');
select wa_link_conversation((select id from whatsapp_conversations where phone_e164 = '972599999999'), 'leads', '20000000-0000-4000-8000-000000000002');
select pg_temp.ok((select record_id = '20000000-0000-4000-8000-000000000002' and link_source = 'manual' from whatsapp_conversations where phone_e164 = '972599999999'), 'manager links an unlinked conversation');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
do $$ begin perform wa_link_conversation((select id from whatsapp_conversations where phone_e164 = '972501234567'), 'leads', '20000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: linked to a foreign record'; exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok - agent cannot link a conversation to a record he cannot access'; end $$;

-- consent: stamps, opt-out wins
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
update leads set whatsapp_opt_in = true, whatsapp_opt_in_at = '2000-01-01' where id = '20000000-0000-4000-8000-000000000001';
select pg_temp.ok((select whatsapp_opt_in and whatsapp_opt_in_at > now() - interval '1 minute' and whatsapp_consent_source = 'crm' from leads where id = '20000000-0000-4000-8000-000000000001'), 'opt-in stamped by the server (browser timestamp ignored)');
reset role;
set role service_role;
select pg_temp.ok(wa_opt_out_by_phone('972542424999', 'whatsapp_stop', null) = 1, 'STOP switches consent off on the card with that phone (phone2)');
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
update leads set whatsapp_opt_in = true where id = '20000000-0000-4000-8000-000000000001';
select pg_temp.ok((select not whatsapp_opt_in and whatsapp_opt_out_at is not null from leads where id = '20000000-0000-4000-8000-000000000001'), 'opt-out wins: a card cannot re-enable a removed number');
update leads set whatsapp_marketing_opt_in_at = '1999-01-01' where id = '20000000-0000-4000-8000-000000000002';
select pg_temp.ok((select whatsapp_marketing_opt_in_at is null from leads where id = '20000000-0000-4000-8000-000000000002'), 'marketing opt-in timestamp is server-side only');
reset role;
\echo ALL WHATSAPP DB ASSERTIONS PASSED
