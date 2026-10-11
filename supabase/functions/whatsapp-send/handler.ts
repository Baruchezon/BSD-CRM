// whatsapp-send - every outbound WhatsApp from the CRM (Cloud API, +972 77-444-6707). NOT deployed.
// Deploy with verify_jwt = true. Caller = active CRM user (Supabase JWT). Actions:
//   status, list_templates, send_template, send_agreement, send_text, send_document, upload_url, media_url
// All sending goes through deliver() in _shared/whatsapp.ts: mode (off/simulate/dry_run/live), per-record
// channel flag ('api'), phone-on-record, 24h window, consent/opt-out, rate limits, idempotency, logging.
import {
  cleanFreeText, deliver, randomCode, RECORD_TABLES, safeFilename, safeTextParam, SHORT_CODE_RE, storageSafeName, toE164, UUID_RE,
  windowClosesAt, windowOpen, type Conversation, type RecordTable, type WaConfig, type WaRecord,
} from '../_shared/whatsapp.ts';
import { AGREEMENT_KIND_LABELS, TEMPLATES, type TemplateDef } from '../_shared/whatsapp-templates.ts';

export interface Access {
  record(jwt: string, table: RecordTable, id: string): Promise<boolean>;
  conversation(jwt: string, conversationId: string): Promise<boolean>;
  storagePath(jwt: string, path: string): Promise<boolean>;
}
export interface SendDeps {
  cfg: WaConfig; store: any; access: Access; fetch: typeof fetch; origins: string[]; now?: () => Date;
  allowedTargetHosts?: string[];
}

const SEND_ROLES = new Set(['admin', 'manager', 'agent_authorized', 'agent', 'user']);
const FULL = new Set(['admin', 'manager']);
export const DEFAULT_TARGET_HOSTS = ['baruchezon.github.io', 'www.bsd-bbi.co.il', 'bsd-bbi.co.il'];
export const SIGNING_PAGES: Record<string, string> = {
  'bsd-contract-signing-seller.html': 'seller', 'bsd-contract-signing-buyer.html': 'buyer', 'bsd-contract-signing-broker.html': 'broker',
};
const LINK_KIND: Record<string, string> = {
  bsd_agreement_to_sign: 'agreement', bsd_signing_reminder: 'agreement', bsd_portal_access: 'portal', bsd_vip_access: 'vip', bsd_training_form: 'training',
};
const LINK_TTL_DAYS: Record<string, number> = { agreement: 60, portal: 3, vip: 14, training: 30 };

export function firstName(name: string | null | undefined): string {
  return safeTextParam(String(name || '').trim().split(/\s+/)[0], 30) || 'לקוח';
}

// Long signing URL -> short-link target. The record id travels inside the redirect target (rid=), never in the message.
export function agreementTarget(url: string, table: RecordTable, id: string, hosts: string[]): { target: string; kind: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname)) return null;
  const page = u.pathname.split('/').pop() || '';
  const kind = SIGNING_PAGES[page];
  if (!kind || !u.pathname.startsWith('/bsd-contracts/')) return null;
  if ((kind === 'broker') !== (table === 'brokers')) return null;
  u.searchParams.set('rid', id);
  u.searchParams.set('rt', table);
  return { target: u.toString(), kind };
}
export function linkTarget(url: string, hosts: string[]): string | null {
  try { const u = new URL(url); return u.protocol === 'https:' && hosts.includes(u.hostname) ? u.toString() : null; } catch { return null; }
}

export function createSendHandler(deps: SendDeps) {
  const now = deps.now || (() => new Date());
  const hosts = deps.allowedTargetHosts?.length ? deps.allowedTargetHosts : DEFAULT_TARGET_HOSTS;
  const cors = (req: Request) => {
    const o = req.headers.get('origin') || '';
    return { 'Access-Control-Allow-Origin': deps.origins.includes(o) ? o : (deps.origins[0] || 'null'), 'Vary': 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  };
  const json = (req: Request, status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
    if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method_not_allowed' });
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json(req, 401, { ok: false, error: 'unauthorized' });
    const userId = await deps.store.userFromJwt(jwt).catch(() => null);
    if (!userId) return json(req, 401, { ok: false, error: 'unauthorized' });
    const prof = await deps.store.profile(userId);
    if (!prof || prof.status !== 'active' || !SEND_ROLES.has(String(prof.role))) return json(req, 403, { ok: false, error: 'forbidden_role' });
    let body: any;
    try { body = await req.json(); } catch { return json(req, 400, { ok: false, error: 'bad_json' }); }
    const action = String(body?.action || '');
    const cfg = deps.cfg;

    const loadRecord = async (): Promise<WaRecord | Response> => {
      const table = body?.record?.table as RecordTable, id = String(body?.record?.id || '');
      if (!RECORD_TABLES.includes(table) || !UUID_RE.test(id)) return json(req, 400, { ok: false, error: 'bad_record' });
      if (!(await deps.access.record(jwt, table, id))) return json(req, 403, { ok: false, error: 'forbidden_record' });
      const r = await deps.store.record(table, id);
      if (!r) return json(req, 404, { ok: false, error: 'record_not_found' });
      return r;
    };
    const recordPhone = (r: WaRecord) => {
      const phones = r.phones.map(toE164).filter((p): p is string => !!p);
      const want = body?.phone ? toE164(body.phone) : null;
      return want ? (phones.includes(want) ? want : null) : (phones[0] || null);
    };
    const target = async (): Promise<{ conv: Conversation; record: WaRecord | null; to: string } | Response> => {
      if (body?.conversation_id) {
        const cid = String(body.conversation_id);
        if (!UUID_RE.test(cid)) return json(req, 400, { ok: false, error: 'bad_conversation' });
        if (!(await deps.access.conversation(jwt, cid))) return json(req, 403, { ok: false, error: 'forbidden_conversation' });
        const conv = await deps.store.conversationById(cid);
        if (!conv) return json(req, 404, { ok: false, error: 'conversation_not_found' });
        const record = conv.record_table && conv.record_id ? await deps.store.record(conv.record_table, conv.record_id) : null;
        return { conv, record, to: conv.phone_e164 };
      }
      const r = await loadRecord();
      if (r instanceof Response) return r;
      const to = recordPhone(r);
      if (!to) return json(req, 422, { ok: false, error: 'bad_phone' });
      const conv = await deps.store.conversation(to, { table: r.table, id: r.id });
      return { conv, record: r, to };
    };
    const documentFrom = async (d: any, conv: Conversation) => {
      const path = String(d?.storage_path || '');
      if (!path || path.includes('..') || path.startsWith('/')) return { error: 'bad_document' };
      if (!(await deps.access.storagePath(jwt, path))) return { error: 'forbidden_document' };
      if (path.startsWith('whatsapp-outbound/') && !path.startsWith(`whatsapp-outbound/${conv.id}/`)) return { error: 'forbidden_document' };
      const info = await deps.store.objectInfo(path);
      if (!info) return { error: 'document_not_found' };
      const filename = safeFilename(d?.filename || path.split('/').pop(), 'document.pdf');
      const link = await deps.store.signedUrl(path, 3600);
      return { link, filename, storagePath: path, mime: info.mime, size: info.size };
    };
    const reply = (r: any) => json(req, r.status || (r.ok ? 200 : 400), r);

    if (action === 'status') {
      const out: Record<string, unknown> = { ok: true, mode: cfg.mode, configured: cfg.mode === 'simulate' || (!!cfg.token && !!cfg.phoneNumberId),
        test_numbers: cfg.testNumbers.map(n => n.slice(0, 5) + '•••' + n.slice(-3)) };
      if (body?.record) {
        const r = await loadRecord();
        if (r instanceof Response) return r;
        const to = recordPhone(r);
        const conv = to ? await deps.store.conversationOrNull(to) : null;
        out.record = { channel: r.channel, phone: to, opt_in: r.opt_in, opted_out: !!r.opt_out_at && (!r.opt_in_at || r.opt_out_at >= r.opt_in_at),
          marketing_opt_in: r.marketing_opt_in, conversation_id: conv?.id ?? null,
          window_open: windowOpen(conv?.last_inbound_at, now()), window_closes_at: windowClosesAt(conv?.last_inbound_at) };
      }
      return json(req, 200, out);
    }
    if (action === 'list_templates') {
      return json(req, 200, { ok: true, templates: Object.values(TEMPLATES).map(t => ({ name: t.name, category: t.category, description: t.description,
        header: t.header || null, url_button: t.urlButton?.text || null, body: t.body,
        params: t.params.map(p => ({ key: p.key, label: p.label, max: p.max, options: t.fixedValues?.[p.key] || null })) })) });
    }

    if (action === 'send_template' || action === 'send_agreement') {
      const tName = action === 'send_agreement' ? 'bsd_agreement_to_sign' : String(body?.template || '');
      const def: TemplateDef | undefined = Object.hasOwn(TEMPLATES, tName) ? TEMPLATES[tName] : undefined;
      if (!def) return json(req, 400, { ok: false, error: 'unknown_template' });
      if (def.needsAgreementPermission && !FULL.has(prof.role) && prof.can_send_agreement !== true) return json(req, 403, { ok: false, error: 'forbidden_agreement' });
      const t = await target();
      if (t instanceof Response) return t;
      if (!t.record) return json(req, 400, { ok: false, error: 'record_required_for_template' });
      const r = t.record;
      // ---- parameter values: built from the DB where possible, the rest validated ----
      const given = (body?.values && typeof body.values === 'object') ? body.values : {};
      const values: string[] = [];
      for (const p of def.params) {
        let v: string | null = null;
        // the agreement kind is derived from the signing page below (never typed by the user)
        if (def.name === 'bsd_agreement_to_sign' && p.key === 'agreement_kind') { values[def.params.indexOf(p)] = ''; continue; }
        if (p.key === 'first_name') v = firstName(r.name);
        else if (p.key === 'client_number') v = safeTextParam(r.client_number, p.max);
        else if (p.key === 'agreement_number') v = safeTextParam(given.agreement_number || r.agreement_number, p.max);
        else if (def.fixedValues?.[p.key]) {
          const code = String(given[p.key] ?? '');
          v = Object.hasOwn(def.fixedValues[p.key], code) ? def.fixedValues[p.key][code] : null;
        } else if (/date/.test(p.key)) {
          v = /^(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.20\d\d$/.test(String(given[p.key] || '')) ? String(given[p.key]) : null;
        } else v = safeTextParam(given[p.key], p.max);
        if (!v) return json(req, 400, { ok: false, error: 'bad_param', param: p.key });
        values[def.params.indexOf(p)] = v;
      }
      // ---- URL button: short link carrying the record id (no long raw link in the message) ----
      let urlCode: string | undefined;
      if (def.urlButton) {
        const kind = LINK_KIND[def.name] || 'other';
        let targetUrl: string | null = null;
        if (kind === 'agreement' && (action === 'send_agreement' || body?.url_target)) {
          const a = agreementTarget(String(body?.signing_url || body?.url_target || ''), r.table, r.id, hosts);
          if (!a) return json(req, 400, { ok: false, error: 'bad_signing_url' });
          targetUrl = a.target;
          if (def.name === 'bsd_agreement_to_sign') {
            const idx = def.params.findIndex(p => p.key === 'agreement_kind');
            values[idx] = AGREEMENT_KIND_LABELS[r.table === 'leads' && r.lead_type === 'partner' ? 'partner' : a.kind];
          }
        } else if (kind === 'agreement') {
          const last = await deps.store.latestShortLink('agreement', r.table, r.id);
          if (!last) return json(req, 409, { ok: false, error: 'no_agreement_link_to_remind' });
          urlCode = last.code;
        } else {
          targetUrl = linkTarget(String(body?.url_target || ''), hosts);
          if (!targetUrl) return json(req, 400, { ok: false, error: 'bad_url_target' });
        }
        if (targetUrl) {
          const days = LINK_TTL_DAYS[kind] || 14;
          urlCode = await deps.store.createShortLink({ target_url: targetUrl, kind, record_table: r.table, record_id: r.id, created_by: userId,
            expires_at: new Date(now().getTime() + days * 86400_000).toISOString() });
        }
        if (!urlCode || !SHORT_CODE_RE.test(urlCode)) return json(req, 500, { ok: false, error: 'short_link_failed' });
      }
      const missing = def.params.findIndex((_p, i) => !values[i]);
      if (missing >= 0) return json(req, 400, { ok: false, error: def.name === 'bsd_agreement_to_sign' ? 'bad_signing_url' : 'bad_param', param: def.params[missing].key });
      let document;
      if (def.header === 'DOCUMENT') {
        const d = await documentFrom(body?.document, t.conv);
        if ('error' in d) return json(req, 400, { ok: false, error: d.error });
        document = d;
      }
      const res = await deliver(cfg, deps.store, deps.fetch, { kind: 'template', to: t.to, conversation: t.conv, record: r, sentBy: userId,
        requestId: String(body?.client_request_id || ''), template: def, values, urlCode, document, purpose: def.name }, now());
      return reply({ ...res, short_code: urlCode || null });
    }

    if (action === 'send_text') {
      const t = await target();
      if (t instanceof Response) return t;
      const text = cleanFreeText(body?.text);
      if (!text) return json(req, 400, { ok: false, error: 'empty_text' });
      const replyTo = body?.reply_to && /^wamid\.[A-Za-z0-9+/=_-]{10,200}$/.test(String(body.reply_to)) ? String(body.reply_to) : undefined;
      return reply(await deliver(cfg, deps.store, deps.fetch, { kind: 'text', to: t.to, conversation: t.conv, record: t.record, sentBy: userId,
        requestId: String(body?.client_request_id || ''), text, replyTo, purpose: 'reply' }, now()));
    }
    if (action === 'send_document') {
      const t = await target();
      if (t instanceof Response) return t;
      const d = await documentFrom(body?.document, t.conv);
      if ('error' in d) return json(req, 400, { ok: false, error: d.error });
      return reply(await deliver(cfg, deps.store, deps.fetch, { kind: 'document', to: t.to, conversation: t.conv, record: t.record, sentBy: userId,
        requestId: String(body?.client_request_id || ''), document: d, caption: body?.caption ? String(body.caption) : undefined, purpose: 'document' }, now()));
    }
    if (action === 'upload_url') {
      const t = await target();
      if (t instanceof Response) return t;
      const name = safeFilename(body?.filename, 'file.pdf');
      const path = `whatsapp-outbound/${t.conv.id}/${randomCode(8)}-${storageSafeName(name)}`;
      const up = await deps.store.signedUploadUrl(path);
      return json(req, 200, { ok: true, conversation_id: t.conv.id, path: up.path || path, token: up.token, filename: name });
    }
    if (action === 'media_url') {
      const mid = String(body?.message_id || '');
      if (!UUID_RE.test(mid)) return json(req, 400, { ok: false, error: 'bad_message' });
      const m = await deps.store.message(mid);
      if (!m || !m.storage_path) return json(req, 404, { ok: false, error: 'no_media' });
      if (!m.conversation_id || !(await deps.access.conversation(jwt, m.conversation_id))) return json(req, 403, { ok: false, error: 'forbidden_conversation' });
      const url = await deps.store.signedUrl(m.storage_path, 300, body?.download ? safeFilename(m.media_filename, 'file') : undefined);
      return json(req, 200, { ok: true, url, filename: m.media_filename, mime: m.media_mime, size: m.media_size });
    }
    return json(req, 400, { ok: false, error: 'unknown_action' });
  };
}
