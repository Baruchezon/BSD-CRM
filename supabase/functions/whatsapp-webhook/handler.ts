// whatsapp-webhook - Meta Cloud API events for +972 77-444-6707. NOT deployed. Deploy with verify_jwt = false
// (Meta cannot send a Supabase JWT; every POST is authenticated by X-Hub-Signature-256 = HMAC(app secret, raw body)).
// - GET : subscription check (hub.verify_token must equal WHATSAPP_VERIFY_TOKEN).
// - POST: inbound messages (text, buttons, documents, images, audio, video...), delivery/read/failed statuses.
//   Media is downloaded from Graph and stored in business-files/whatsapp-inbound/<conversation>/<message>-<name>.
//   The conversation is linked to a CRM record by phone: exactly one live match -> linked; several -> ambiguous
//   (candidates kept, a human picks); none -> unlinked. A received PDF is NEVER turned into a signed agreement
//   here: confirming it is a human action in the CRM card («אשר כהסכם חתום»). Never sends a message.
import {
  cleanFreeText, cleanParam, graphGet, hmacSha256Hex, isStopMessage, MAX_INBOUND_BYTES, nextStatus, OPT_OUT_PAYLOAD, safeFilename,
  sha256Base64, storageSafeName, timingSafeEqual, toE164, type WaConfig,
} from '../_shared/whatsapp.ts';

export interface WebhookStore {
  matchPhone(e164: string): Promise<{ kind: 'leads' | 'businesses' | 'brokers'; id: string; is_archived: boolean }[]>;
  conversationForInbound(e164: string, profileName: string | null): Promise<{ id: string; record_table: string | null; record_id: string | null; ambiguous: boolean }>;
  linkConversation(id: string, patch: Record<string, unknown>): Promise<void>;
  insertInbound(row: Record<string, unknown>): Promise<{ id: string } | { duplicate: true }>;
  updateMessage(id: string, patch: Record<string, unknown>): Promise<void>;
  bumpConversation(id: string, patch: { last_message_at: string; last_message_preview: string; last_inbound_at: string }): Promise<void>;
  messageByProviderId(providerId: string): Promise<{ id: string; status: string } | null>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  optOutByPhone(e164: string, source: string, messageId: string | null): Promise<number>;
}
export interface WebhookDeps { cfg: WaConfig; store: WebhookStore; fetch: typeof fetch; verifyToken: string; appSecret: string; maxMediaBytes?: number }

const MEDIA_TYPES = new Set(['document', 'image', 'audio', 'video', 'sticker']);
const KNOWN_TYPES = new Set(['text', 'button', 'interactive', 'reaction', 'location', 'contacts', 'document', 'image', 'audio', 'video', 'sticker']);
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };

export function inboundText(m: any): string {
  switch (m?.type) {
    case 'text': return m.text?.body ?? '';
    case 'button': return m.button?.text ?? m.button?.payload ?? '';
    case 'interactive': return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
    case 'reaction': return m.reaction?.emoji ? `[תגובה ${m.reaction.emoji}]` : '[תגובה]';
    case 'location': return `[מיקום] ${m.location?.name || ''} ${m.location?.latitude ?? ''},${m.location?.longitude ?? ''}`.trim();
    case 'contacts': return '[איש קשר] ' + (m.contacts?.[0]?.name?.formatted_name || '');
    default: return m?.[m?.type]?.caption ?? '';
  }
}
const tsIso = (t: unknown) => { const n = Number(t); return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString(); };

export function createWebhookHandler(deps: WebhookDeps) {
  const res = (body: unknown = { ok: true }, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const maxBytes = deps.maxMediaBytes ?? MAX_INBOUND_BYTES;

  async function link(conv: { id: string; record_table: string | null; record_id: string | null }, e164: string) {
    if (conv.record_id) return; // a link (automatic or chosen by a person) is never overwritten by a webhook
    const live = (await deps.store.matchPhone(e164)).filter(r => !r.is_archived);
    const uniq = [...new Map(live.map(r => [r.kind + ':' + r.id, r])).values()];
    if (uniq.length === 1) await deps.store.linkConversation(conv.id, { record_table: uniq[0].kind, record_id: uniq[0].id, ambiguous: false, candidates: null, link_source: 'auto_phone' });
    else if (uniq.length > 1) await deps.store.linkConversation(conv.id, { ambiguous: true, candidates: uniq.map(r => ({ table: r.kind, id: r.id })) });
  }

  async function downloadMedia(m: any, convId: string, rowId: string) {
    const media = m[m.type] || {};
    try {
      const meta = await graphGet(deps.cfg, deps.fetch, encodeURIComponent(String(media.id)));
      if (!meta.ok || !meta.body?.url) throw new Error('media lookup ' + meta.status);
      const size = Number(meta.body.file_size || 0);
      if (size > maxBytes) throw new Error('media too large ' + size);
      const r = await deps.fetch(String(meta.body.url), { headers: { Authorization: 'Bearer ' + deps.cfg.token } });
      if (!r.ok) throw new Error('media download ' + r.status);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > maxBytes) throw new Error('media too large ' + bytes.length);
      const mime = String(meta.body.mime_type || media.mime_type || 'application/octet-stream').split(';')[0];
      if (meta.body.sha256) {
        const got = await sha256Base64(bytes);
        const want = String(meta.body.sha256);
        const hex = Array.from(atob(got), c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
        if (want !== got && want.toLowerCase() !== hex) throw new Error('media sha256 mismatch');
      }
      const original = safeFilename(media.filename || `${m.type}.${EXT[mime] || 'bin'}`);
      const named = /\.[A-Za-z0-9]{1,8}$/.test(original) ? original : original + '.' + (EXT[mime] || 'bin');
      const path = `whatsapp-inbound/${convId}/${rowId}-${storageSafeName(named)}`;
      await deps.store.upload(path, bytes, mime);
      await deps.store.updateMessage(rowId, { storage_path: path, media_mime: mime, media_size: bytes.length, media_filename: named, processing_status: 'done', processed_at: new Date().toISOString() });
    } catch (e) {
      // Row stays; the CRM shows «הקובץ לא נקלט» and an admin can retry. Meta keeps media ~30 days.
      await deps.store.updateMessage(rowId, { processing_status: 'failed', last_processing_error: cleanParam((e as Error).message, 300) });
    }
  }

  async function handleValue(v: any, stats: Record<string, number>) {
    const names = new Map<string, string>();
    for (const c of v?.contacts || []) if (c?.wa_id) names.set(String(c.wa_id), cleanParam(c?.profile?.name || '', 80));
    for (const m of v?.messages || []) {
      const from = toE164('+' + String(m.from || '').replace(/^\+/, ''));
      if (!from || !m.id) continue;
      const conv = await deps.store.conversationForInbound(from, names.get(String(m.from)) || null);
      await link(conv, from);
      const type = KNOWN_TYPES.has(m.type) ? m.type : 'unsupported';
      const isMedia = MEDIA_TYPES.has(type);
      const text = cleanFreeText(inboundText(m), 4000);
      const media = isMedia ? (m[type] || {}) : null;
      const at = tsIso(m.timestamp);
      const ins = await deps.store.insertInbound({ event_kind: 'inbound_message', direction: 'inbound', message_type: type, phone_e164: from,
        provider_message_id: m.id, message_text: text || null, status: 'received', received_at: at, conversation_id: conv.id,
        context_message_id: m.context?.id ?? null, media_id: media?.id ?? null, media_mime: media?.mime_type ?? null,
        media_filename: media?.filename ? safeFilename(media.filename) : null, button_payload: m.button?.payload ?? m.interactive?.button_reply?.id ?? null,
        processing_status: isMedia ? 'pending' : 'done' });
      if ('duplicate' in ins) { stats.duplicate++; continue; } // Meta retry: already stored and processed
      stats.inbound++;
      await deps.store.bumpConversation(conv.id, { last_message_at: at, last_inbound_at: at,
        last_message_preview: (text || (media?.filename ? '📎 ' + media.filename : `[${type}]`)).replace(/\s+/g, ' ').slice(0, 140) });
      if (isMedia && media?.id) { await downloadMedia({ ...m, type }, conv.id, ins.id); stats.media++; }
      const payload = String(m.button?.payload || m.interactive?.button_reply?.id || '');
      if (isStopMessage(text) || payload === OPT_OUT_PAYLOAD) stats.opt_out += await deps.store.optOutByPhone(from, payload === OPT_OUT_PAYLOAD ? 'whatsapp_button' : 'whatsapp_stop', ins.id);
    }
    for (const s of v?.statuses || []) {
      if (!s.id || !s.status) continue;
      const row = await deps.store.messageByProviderId(String(s.id));
      if (!row) { stats.status_unknown++; continue; }
      const next = nextStatus(row.status, String(s.status));
      if (!next) continue;
      const at = tsIso(s.timestamp);
      const patch: Record<string, unknown> = { status: next };
      if (next === 'sent') patch.sent_at = at;
      if (next === 'delivered') patch.delivered_at = at;
      if (next === 'read') patch.read_at = at;
      if (next === 'failed') { const e = s.errors?.[0] || {}; patch.failed_at = at; patch.error_code = String(e.code ?? ''); patch.error_message = cleanParam(e.error_data?.details || e.title || e.message || '', 500); }
      await deps.store.updateMessage(row.id, patch);
      stats.status++;
    }
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'GET') {
      const u = new URL(req.url);
      const mode = u.searchParams.get('hub.mode'), token = u.searchParams.get('hub.verify_token') || '', challenge = u.searchParams.get('hub.challenge') || '';
      if (deps.verifyToken && mode === 'subscribe' && timingSafeEqual(token, deps.verifyToken)) return new Response(challenge, { status: 200 });
      return new Response('forbidden', { status: 403 });
    }
    if (req.method !== 'POST') return res({ ok: false }, 405);
    if (!deps.appSecret) return res({ ok: false, error: 'not_configured' }, 503);
    const raw = new Uint8Array(await req.arrayBuffer());
    if (raw.length > 3_000_000) return res({ ok: false, error: 'too_large' }, 413);
    const sig = req.headers.get('x-hub-signature-256') || '';
    if (!sig.startsWith('sha256=') || !timingSafeEqual(sig.slice(7).toLowerCase(), await hmacSha256Hex(deps.appSecret, raw))) return res({ ok: false, error: 'unauthorized' }, 401);
    let body: any;
    try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return res({ ok: false, error: 'bad_json' }, 400); }
    if (body?.object !== 'whatsapp_business_account') return res({ ok: true, ignored: true });
    const stats = { inbound: 0, duplicate: 0, media: 0, status: 0, status_unknown: 0, opt_out: 0, foreign: 0 };
    try {
      for (const e of body?.entry || []) for (const c of e?.changes || []) {
        if (c?.field !== 'messages') continue;
        const pid = String(c?.value?.metadata?.phone_number_id || '');
        if (deps.cfg.phoneNumberId && pid && pid !== deps.cfg.phoneNumberId) { stats.foreign++; continue; } // another number on the same app
        await handleValue(c?.value, stats);
      }
    } catch (err) {
      console.error('whatsapp-webhook', (err as Error).message);
      return res({ ok: false, error: 'processing_failed' }, 500); // Meta retries; inserts are idempotent (unique provider_message_id)
    }
    return res({ ok: true, ...stats });
  };
}
