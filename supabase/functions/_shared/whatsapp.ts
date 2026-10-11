// BSD WhatsApp Cloud API (direct Meta, number +972 77-444-6707) - shared helpers + outbound core.
// Branch eldad/whatsapp-cloud-api (11.10.2026). NOT deployed. Inert until WHATSAPP_MODE is set (default "off").
// Nothing here talks to the network by itself: every Graph call goes through an injected fetch, every DB call
// through the WaStore interface (whatsapp-store.ts implements it with supabase-js + service role).
import { OPT_OUT_PAYLOAD, renderTemplateText, TEMPLATES, type TemplateDef } from './whatsapp-templates.ts';

export const DEFAULT_GRAPH_VERSION = 'v23.0';
export type WaMode = 'off' | 'simulate' | 'dry_run' | 'live';
export const WINDOW_MS = 24 * 3600_000;
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024; // Cloud API document limit
export const MAX_INBOUND_BYTES = 100 * 1024 * 1024;

export interface WaConfig {
  mode: WaMode;                // WHATSAPP_MODE: off | simulate (no network) | dry_run (test numbers only) | live
  token: string;               // WHATSAPP_TOKEN - permanent System User token (whatsapp_business_messaging)
  phoneNumberId: string;       // WHATSAPP_PHONE_NUMBER_ID - 1346024128597094
  wabaId: string;              // WHATSAPP_WABA_ID - only needed by the template submission script
  graphVersion: string;        // WHATSAPP_GRAPH_VERSION (optional)
  testNumbers: string[];       // WHATSAPP_TEST_NUMBERS - comma separated, e.g. 972542424999 (dry_run allow-list)
  shortLinkBase: string;       // WHATSAPP_SHORT_LINK_BASE - fixed URL-button prefix approved by Meta (ends with /)
  requireOptInUtility: boolean;// WHATSAPP_REQUIRE_OPT_IN_UTILITY (default true): utility templates need opt-in too
  dailyLimit: number;          // WHATSAPP_DAILY_LIMIT - business-initiated templates per 24h (Meta tier starts at 250)
  userPerMinute: number;       // WHATSAPP_USER_PER_MINUTE
}

export function readConfig(env: (k: string) => string | undefined): WaConfig {
  const v = (k: string) => (env(k) || '').trim();
  const int = (k: string, d: number) => { const n = Number(v(k)); return Number.isInteger(n) && n > 0 ? n : d; };
  const modeRaw = v('WHATSAPP_MODE');
  const mode: WaMode = (['off', 'simulate', 'dry_run', 'live'] as const).includes(modeRaw as WaMode) ? modeRaw as WaMode : 'off';
  const gv = v('WHATSAPP_GRAPH_VERSION');
  const supa = v('SUPABASE_URL').replace(/\/+$/, '');
  let base = v('WHATSAPP_SHORT_LINK_BASE') || (supa ? supa + '/functions/v1/go/' : '');
  if (base && !base.endsWith('/')) base += '/';
  return {
    mode, token: v('WHATSAPP_TOKEN'), phoneNumberId: v('WHATSAPP_PHONE_NUMBER_ID'), wabaId: v('WHATSAPP_WABA_ID'),
    graphVersion: /^v\d{2}\.0$/.test(gv) ? gv : DEFAULT_GRAPH_VERSION,
    testNumbers: v('WHATSAPP_TEST_NUMBERS').split(',').map(s => toE164(s)).filter((s): s is string => !!s),
    shortLinkBase: base,
    requireOptInUtility: v('WHATSAPP_REQUIRE_OPT_IN_UTILITY') !== 'false',
    dailyLimit: int('WHATSAPP_DAILY_LIMIT', 200),
    userPerMinute: int('WHATSAPP_USER_PER_MINUTE', 10),
  };
}

export function credentialsPresent(cfg: WaConfig): boolean {
  return !!cfg.token && /^\d{5,30}$/.test(cfg.phoneNumberId);
}

// E.164 digits without '+'. 050-1234567 -> 972501234567, 077-4446707 -> 972774446707. Other countries only when
// already international (+ / 00), never guessed.
export function toE164(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const intl = s.startsWith('+') || s.startsWith('00');
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (!intl && d.startsWith('0')) d = '972' + d.slice(1);
  if (d.startsWith('9720')) d = '972' + d.slice(4);
  if (d.startsWith('972')) return /^972(5\d{8}|[2-489]\d{7}|7\d{8})$/.test(d) ? d : null;
  if (!intl) return null;
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

// Meta rules for template parameters: no newlines/tabs, no more than 4 consecutive spaces, bounded length.
export function cleanParam(v: unknown, max = 60): string {
  const s = String(v ?? '').replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
// No links / long numbers / e-mails / prices inside text parameters (keeps utility templates non-marketing).
export function safeTextParam(v: unknown, max = 60): string | null {
  const s = cleanParam(v, max);
  if (!s) return null;
  if (/https?:|www\.|\.co\b|\.com\b|@|\d{7,}|₪|\$|סיסמ/i.test(s)) return null;
  return s;
}
export function cleanFreeText(v: unknown, max = 4096): string {
  return String(v ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
export function safeFilename(name: unknown, fallback = 'file'): string {
  const s = String(name ?? '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim();
  const out = s.replace(/^\.+/, '').slice(-120);
  return out || fallback;
}
// Storage object keys: ASCII only (Supabase rejects some unicode keys); the original name is kept in the DB.
export function storageSafeName(name: string): string {
  const ext = (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] || 'bin').toLowerCase();
  const stem = name.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return (stem || 'file') + '.' + ext;
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SHORT_CODE_RE = /^[A-Za-z0-9]{8,16}$/;

// ---------- opt-out ----------
const STOP_WORDS = new Set(['הסר', 'הסרה', 'להסיר', 'הסירו', 'תסיר', 'תסירו', 'הסר אותי', 'הסירו אותי', 'תסירו אותי',
  'להסרה', 'הסר אותי מהרשימה', 'הפסק', 'הפסיקו', 'stop', 'unsubscribe', 'remove me', 'stop all']);
export function isStopMessage(text: unknown): boolean {
  const t = String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.length <= 24 && STOP_WORDS.has(t);
}

// ---------- 24h customer-service window ----------
export function windowOpen(lastInboundAt: string | null | undefined, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) && now.getTime() - t < WINDOW_MS && t <= now.getTime() + 60_000;
}
export function windowClosesAt(lastInboundAt: string | null | undefined): string | null {
  if (!lastInboundAt) return null;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) ? new Date(t + WINDOW_MS).toISOString() : null;
}

// ---------- Graph payloads ----------
export function templatePayload(to: string, def: TemplateDef, values: string[], opts: { urlCode?: string; document?: { link: string; filename: string } } = {}) {
  const components: unknown[] = [];
  if (def.header === 'DOCUMENT') {
    if (!opts.document) throw new Error('document_required');
    components.push({ type: 'header', parameters: [{ type: 'document', document: { link: opts.document.link, filename: opts.document.filename } }] });
  }
  if (values.length) components.push({ type: 'body', parameters: values.map(text => ({ type: 'text', text })) });
  let idx = 0;
  if (def.urlButton) {
    if (!opts.urlCode || !SHORT_CODE_RE.test(opts.urlCode)) throw new Error('url_code_required');
    components.push({ type: 'button', sub_type: 'url', index: String(idx++), parameters: [{ type: 'text', text: opts.urlCode }] });
  }
  for (const q of def.quickReplies) {
    components.push({ type: 'button', sub_type: 'quick_reply', index: String(idx++), parameters: [{ type: 'payload', payload: q.payload }] });
  }
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
    template: { name: def.name, language: { code: def.language }, components } };
}
export function textPayload(to: string, body: string, replyTo?: string) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body, preview_url: false },
    ...(replyTo ? { context: { message_id: replyTo } } : {}) };
}
export function documentPayload(to: string, link: string, filename: string, caption?: string) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'document',
    document: { link, filename, ...(caption ? { caption: caption.slice(0, 1024) } : {}) } };
}

export async function graphPost(cfg: WaConfig, f: typeof fetch, path: string, payload: unknown, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await f(`https://graph.facebook.com/${cfg.graphVersion}/${path}`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.token }, body: JSON.stringify(payload) });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } finally { clearTimeout(t); }
}
export async function graphGet(cfg: WaConfig, f: typeof fetch, path: string, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await f(`https://graph.facebook.com/${cfg.graphVersion}/${path}`, { signal: ctl.signal, headers: { 'Authorization': 'Bearer ' + cfg.token } });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } finally { clearTimeout(t); }
}

// ---------- crypto ----------
export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
export async function hmacSha256Hex(secret: string, body: Uint8Array | string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, data as BufferSource));
  return Array.from(mac, b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256Base64(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  let s = ''; d.forEach(b => s += String.fromCharCode(b)); return btoa(s);
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function randomCode(len = 10): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, x => ALPHABET[x % ALPHABET.length]).join('');
}

const RANK: Record<string, number> = { sending: 0, accepted: 1, sent: 2, delivered: 3, read: 4 };
// Status webhooks can arrive out of order; never move backwards.
export function nextStatus(current: string | null | undefined, incoming: string): string | null {
  if (incoming === 'failed') return current === 'failed' || current === 'read' || current === 'delivered' ? null : 'failed';
  if (!(incoming in RANK)) return null;
  if (current === 'failed' || current === 'simulated') return null;
  if (current && current in RANK && RANK[current] >= RANK[incoming]) return null;
  return incoming;
}

// ---------- outbound core ----------
export type RecordTable = 'leads' | 'businesses' | 'brokers';
export const RECORD_TABLES: RecordTable[] = ['leads', 'businesses', 'brokers'];
export interface WaRecord {
  table: RecordTable; id: string; name: string | null; phones: (string | null)[];
  channel: 'personal' | 'api'; is_archived: boolean; lead_type: string | null; client_number: string | null;
  agreement_status: string | null; agreement_number: string | null;
  opt_in: boolean; opt_in_at: string | null; opt_out_at: string | null; marketing_opt_in: boolean;
}
export interface Conversation { id: string; phone_e164: string; record_table: RecordTable | null; record_id: string | null; last_inbound_at: string | null }
export interface MessageRow { id: string; status: string; provider_message_id?: string | null }

export interface WaStore {
  record(table: RecordTable, id: string): Promise<WaRecord | null>;
  suppressed(e164: string): Promise<boolean>;
  conversation(e164: string, link?: { table: RecordTable; id: string } | null): Promise<Conversation>; // get or create
  conversationById(id: string): Promise<Conversation | null>;
  countOutbound(f: { sinceIso: string; sentBy?: string; templatesOnly?: boolean }): Promise<number>;
  byRequestId(id: string): Promise<MessageRow | null>;
  insertMessage(row: Record<string, unknown>): Promise<{ id: string } | { conflict: true }>;
  updateMessage(id: string, patch: Record<string, unknown>): Promise<void>;
  touchConversation(id: string, patch: Record<string, unknown>): Promise<void>;
  sendLog(row: Record<string, unknown>): Promise<void>;
}

export interface DeliverRequest {
  kind: 'template' | 'text' | 'document';
  to: string;                         // e164
  conversation: Conversation;
  record: WaRecord | null;            // null only for replies to an unlinked conversation (window must be open)
  sentBy: string | null;              // CRM user id (null = system, e.g. signed copy after signing)
  requestId: string;                  // idempotency key (uuid)
  template?: TemplateDef; values?: string[]; urlCode?: string;
  document?: { link: string; filename: string; storagePath?: string; mime?: string; size?: number };
  text?: string; caption?: string; replyTo?: string;
  purpose?: string;                   // free label kept in the log, e.g. agreement_to_sign
}
export interface DeliverResult { ok: boolean; status: number; error?: string; id?: string; provider_message_id?: string | null; message_status?: string; duplicate?: boolean; simulated?: boolean }

const PREVIEW = (s: string) => s.replace(/\s+/g, ' ').slice(0, 140);

// Every gate is here, so whatsapp-send and complete-signed-agreement cannot bypass one.
export async function deliver(cfg: WaConfig, store: WaStore, f: typeof fetch, req: DeliverRequest, now = new Date()): Promise<DeliverResult> {
  if (cfg.mode === 'off') return { ok: false, status: 503, error: 'disabled' };
  if (cfg.mode !== 'simulate' && !credentialsPresent(cfg)) return { ok: false, status: 503, error: 'not_configured' };
  if (!UUID_RE.test(req.requestId)) return { ok: false, status: 400, error: 'client_request_id_required' };
  const prev = await store.byRequestId(req.requestId);
  if (prev) return { ok: prev.status !== 'failed' && prev.status !== 'refused', status: 200, duplicate: true, id: prev.id, message_status: prev.status, provider_message_id: prev.provider_message_id };

  const to = toE164(req.to);
  if (!to) return { ok: false, status: 422, error: 'bad_phone' };
  const inWindow = windowOpen(req.conversation.last_inbound_at, now);
  const isTemplate = req.kind === 'template';
  const def = req.template;

  let messageType = req.kind === 'template' ? 'template' : req.kind === 'document' ? 'document' : 'free_text';
  let text = '';
  let payload: unknown;
  try {
    if (isTemplate) {
      if (!def || !TEMPLATES[def.name]) return { ok: false, status: 400, error: 'unknown_template' };
      text = renderTemplateText(def, req.values || []);
      payload = templatePayload(to, def, req.values || [], { urlCode: req.urlCode, document: req.document });
    } else if (req.kind === 'text') {
      text = cleanFreeText(req.text);
      if (!text) return { ok: false, status: 400, error: 'empty_text' };
      payload = textPayload(to, text, req.replyTo);
    } else {
      if (!req.document?.link) return { ok: false, status: 400, error: 'document_required' };
      if ((req.document.size || 0) > MAX_DOCUMENT_BYTES) return { ok: false, status: 413, error: 'document_too_large' };
      text = req.caption ? cleanFreeText(req.caption, 1024) : '';
      payload = documentPayload(to, req.document.link, safeFilename(req.document.filename, 'document.pdf'), text || undefined);
    }
  } catch (e) {
    return { ok: false, status: 400, error: (e as Error).message };
  }

  const base: Record<string, unknown> = {
    event_kind: 'outbound_attempt', direction: 'outbound', message_type: messageType, template_name: def?.name ?? null,
    template_params: isTemplate ? (req.values || []) : null, phone_e164: to, raw_phone_input: to, message_text: text,
    conversation_id: req.conversation.id, client_request_id: req.requestId, sent_by: req.sentBy,
    lead_id: req.record?.table === 'leads' ? req.record.id : null,
    business_id: req.record?.table === 'businesses' ? req.record.id : null,
    broker_id: req.record?.table === 'brokers' ? req.record.id : null,
    media_filename: req.document?.filename ?? null, media_mime: req.document?.mime ?? (req.document ? 'application/pdf' : null),
    media_size: req.document?.size ?? null, storage_path: req.document?.storagePath ?? null,
    purpose: req.purpose ?? null, is_test: cfg.mode !== 'live', processing_status: 'done',
  };
  const refuse = async (status: number, error: string): Promise<DeliverResult> => {
    const r = await store.insertMessage({ ...base, status: 'refused', error_code: error, error_message: error });
    return { ok: false, status, error, id: 'id' in r ? r.id : undefined };
  };

  // ---- feature flag per record (the 054 -> API switch) ----
  if (req.record) {
    if (req.record.channel !== 'api') return refuse(409, 'record_not_on_api_channel');
    if (req.record.is_archived) return refuse(409, 'archived');
    const phones = req.record.phones.map(toE164).filter(Boolean);
    if (!phones.includes(to)) return refuse(403, 'phone_not_on_record');
  } else if (isTemplate) {
    return refuse(400, 'record_required_for_template');
  }
  // ---- mode: dry_run sends only to the test numbers (Baruch's own phone) ----
  if (cfg.mode === 'dry_run' && !cfg.testNumbers.includes(to)) return refuse(403, 'dry_run_number_not_allowed');
  // ---- 24h window / consent ----
  if (!isTemplate && !inWindow) return refuse(409, 'window_closed_use_template');
  const suppressed = await store.suppressed(to);
  if (isTemplate) {
    if (suppressed) return refuse(403, 'opted_out');
    const r = req.record!;
    const optedOut = !!r.opt_out_at && (!r.opt_in_at || Date.parse(r.opt_out_at) >= Date.parse(r.opt_in_at));
    if (optedOut) return refuse(403, 'opted_out');
    if (def!.category === 'MARKETING' && !r.marketing_opt_in) return refuse(403, 'no_marketing_consent');
    if (def!.category === 'UTILITY' && cfg.requireOptInUtility && !r.opt_in && !inWindow) return refuse(403, 'no_consent');
    if (def!.needsAgreementPermission && r.agreement_status === 'יש הסכם חתום' && def!.name !== 'bsd_agreement_signed_copy') return refuse(409, 'already_signed');
    // ---- rate limits (business-initiated only) ----
    const t = now.getTime();
    if (!inWindow && await store.countOutbound({ sinceIso: new Date(t - 86400_000).toISOString(), templatesOnly: true }) >= cfg.dailyLimit) return refuse(429, 'rate_limited_daily');
  }
  if (req.sentBy && await store.countOutbound({ sinceIso: new Date(now.getTime() - 60_000).toISOString(), sentBy: req.sentBy }) >= cfg.userPerMinute) return refuse(429, 'rate_limited_user');

  // ---- record the attempt first (idempotent), then send ----
  const ins = await store.insertMessage({ ...base, status: 'sending' });
  if ('conflict' in ins) {
    const p = await store.byRequestId(req.requestId);
    return { ok: !!p && p.status !== 'failed', status: 200, duplicate: true, id: p?.id, message_status: p?.status };
  }
  const id = ins.id;
  const nowIso = now.toISOString();
  let status = 'accepted', providerId: string | null = null, errCode: string | null = null, errMsg: string | null = null;
  if (cfg.mode === 'simulate') {
    status = 'simulated'; providerId = 'sim.' + id;
  } else {
    try {
      const r = await graphPost(cfg, f, `${cfg.phoneNumberId}/messages`, payload);
      if (r.ok && r.body?.messages?.[0]?.id) providerId = String(r.body.messages[0].id);
      else { status = 'failed'; errCode = String(r.body?.error?.code ?? r.status); errMsg = cleanParam(r.body?.error?.error_data?.details || r.body?.error?.message || 'graph error', 500); }
    } catch (e) {
      status = 'uncertain'; errCode = 'network'; errMsg = cleanParam((e as Error).message, 300); // may or may not have been sent
    }
  }
  await store.updateMessage(id, { status, provider_message_id: providerId, error_code: errCode, error_message: errMsg,
    sent_at: status === 'failed' ? null : nowIso, failed_at: status === 'failed' ? nowIso : null, uncertain_at: status === 'uncertain' ? nowIso : null });
  if (status !== 'failed') {
    await store.touchConversation(req.conversation.id, { last_message_at: nowIso, last_message_preview: PREVIEW(text || req.document?.filename || ''), last_direction: 'outbound' });
    if (req.record && req.sentBy && (req.record.table === 'leads' || req.record.table === 'businesses')) {
      await store.sendLog({ entity_type: req.record.table === 'leads' ? 'lead' : 'business', entity_id: req.record.id,
        template_key: 'api:' + (def?.name || messageType), message_text: text || req.document?.filename || '-', phone_snapshot: to,
        opened_by: req.sentBy, confirmed_sent: true, confirmed_by: req.sentBy, confirmed_at: nowIso }).catch(() => {});
    }
  }
  return { ok: status !== 'failed', status: status === 'failed' ? 502 : 200, id, provider_message_id: providerId, message_status: status,
    simulated: status === 'simulated', error: status === 'failed' ? (errCode === '131047' ? 'window_closed_use_template' : 'send_failed') : undefined };
}

export { OPT_OUT_PAYLOAD };
