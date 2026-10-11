// whatsapp-webhook entry point. NOT deployed. Deploy with verify_jwt = false (authenticated by Meta's HMAC signature).
// Secrets: WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_TOKEN (media download), WHATSAPP_PHONE_NUMBER_ID.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { readConfig } from '../_shared/whatsapp.ts';
import { BUCKET } from '../_shared/whatsapp-store.ts';
import { createWebhookHandler, type WebhookStore } from './handler.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const must = <T>(r: { data: T; error: any }, what: string) => { if (r.error) throw new Error(what + ': ' + r.error.message); return r.data; };

const store: WebhookStore = {
  async matchPhone(e164) { return must(await db.rpc('wa_match_phone', { p_e164: e164 }), 'wa_match_phone') || []; },
  async conversationForInbound(e164, profileName) {
    return must(await db.rpc('wa_conversation_for_inbound', { p_e164: e164, p_profile_name: profileName }), 'wa_conversation_for_inbound');
  },
  async linkConversation(id, patch) { must(await db.from('whatsapp_conversations').update(patch).eq('id', id).is('record_id', null), 'link'); },
  async insertInbound(row) {
    const r = await db.from('whatsapp_messages').insert(row).select('id').maybeSingle();
    if (r.error) { if (r.error.code === '23505') return { duplicate: true as const }; throw new Error('insert: ' + r.error.message); }
    return { id: r.data!.id };
  },
  async updateMessage(id, patch) { must(await db.from('whatsapp_messages').update(patch).eq('id', id), 'update message'); },
  async bumpConversation(id, p) { must(await db.rpc('wa_bump_conversation_inbound', { p_id: id, p_at: p.last_message_at, p_preview: p.last_message_preview }), 'bump'); },
  async messageByProviderId(pid) { return must(await db.from('whatsapp_messages').select('id,status').eq('provider_message_id', pid).maybeSingle(), 'status lookup'); },
  async upload(path, bytes, mime) { must(await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true }), 'upload'); },
  async optOutByPhone(e164, source, messageId) { return Number(must(await db.rpc('wa_opt_out_by_phone', { p_e164: e164, p_source: source, p_message_id: messageId }), 'opt out') || 0); },
};

Deno.serve(createWebhookHandler({ cfg: readConfig(k => Deno.env.get(k)), store, fetch,
  verifyToken: (Deno.env.get('WHATSAPP_VERIFY_TOKEN') || '').trim(), appSecret: (Deno.env.get('WHATSAPP_APP_SECRET') || '').trim() }));
