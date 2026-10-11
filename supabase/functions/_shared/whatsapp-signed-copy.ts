// After a client signs (complete-signed-agreement): send the signed PDF back to the client on WhatsApp.
// Inert unless WHATSAPP_MODE is simulate/dry_run/live AND the record's whatsapp_channel = 'api' (pilot flag).
// Inside the 24h window -> plain document message; otherwise the approved template bsd_agreement_signed_copy
// (DOCUMENT header). Idempotent per (record, agreement number): a retry of the signing call never sends twice.
import { deliver, readConfig, toE164, type RecordTable, type WaConfig, windowOpen } from './whatsapp.ts';
import { createStore } from './whatsapp-store.ts';
import { TEMPLATES } from './whatsapp-templates.ts';
import { firstName } from '../whatsapp-send/handler.ts';

export async function stableUuid(seed: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = Array.from(h.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export async function sendSignedCopy(opts: { db: any; table: RecordTable; recordId: string; agreementNumber: string; storagePath: string;
  cfg?: WaConfig; store?: any; fetchImpl?: typeof fetch; env?: (k: string) => string | undefined; now?: Date }) {
  const cfg = opts.cfg || readConfig(opts.env || (k => Deno.env.get(k)));
  if (cfg.mode === 'off') return { attempted: false, reason: 'disabled' };
  const store = opts.store || createStore(opts.db);
  const record = await store.record(opts.table, opts.recordId);
  if (!record) return { attempted: false, reason: 'record_not_found' };
  if (record.channel !== 'api') return { attempted: false, reason: 'record_not_on_api_channel' };
  const to = record.phones.map(toE164).find(Boolean);
  if (!to) return { attempted: false, reason: 'bad_phone' };
  const conv = await store.conversation(to, { table: record.table, id: record.id });
  const link = await store.signedUrl(opts.storagePath, 3600);
  const filename = `BSD-agreement-${String(opts.agreementNumber).replace(/[^A-Za-z0-9_-]+/g, '-')}.pdf`;
  const requestId = await stableUuid(`signed-copy:${opts.table}:${opts.recordId}:${opts.agreementNumber}`);
  const now = opts.now || new Date();
  const document = { link, filename, storagePath: opts.storagePath, mime: 'application/pdf' };
  const r = windowOpen(conv.last_inbound_at, now)
    ? await deliver(cfg, store, opts.fetchImpl || fetch, { kind: 'document', to, conversation: conv, record, sentBy: null, requestId, document,
        caption: `העתק ההסכם החתום (מספר הסכם ${opts.agreementNumber}). תודה, צוות BSD`, purpose: 'agreement_signed_copy' }, now)
    : await deliver(cfg, store, opts.fetchImpl || fetch, { kind: 'template', to, conversation: conv, record, sentBy: null, requestId,
        template: TEMPLATES.bsd_agreement_signed_copy, values: [firstName(record.name), String(opts.agreementNumber).slice(0, 40)], document, purpose: 'agreement_signed_copy' }, now);
  return { attempted: true, ok: r.ok, status: r.message_status, error: r.error };
}
