// In-memory fakes for the WhatsApp edge tests (no network, no Supabase).
import type { Conversation, RecordTable, WaConfig, WaRecord } from '../../supabase/functions/_shared/whatsapp.ts';
import { readConfig } from '../../supabase/functions/_shared/whatsapp.ts';

export const BIZ = '10000000-0000-4000-8000-000000000001';
export const LEAD = '20000000-0000-4000-8000-000000000001';
export const ADMIN = '00000000-0000-4000-8000-00000000000a';
export const AGENT = '00000000-0000-4000-8000-00000000000b';
export const VIEWER = '00000000-0000-4000-8000-00000000000d';
export const BARUCH = '972542424999';

export function cfg(over: Record<string, string> = {}): WaConfig {
  const env: Record<string, string> = { WHATSAPP_MODE: 'live', WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '1346024128597094',
    WHATSAPP_TEST_NUMBERS: '054-2424999', SUPABASE_URL: 'https://x.supabase.co', ...over };
  return readConfig(k => env[k]);
}
export function record(over: Partial<WaRecord> = {}): WaRecord {
  return { table: 'businesses', id: BIZ, name: 'דני כהן', phones: ['054-2424999'], channel: 'api', is_archived: false, lead_type: null,
    client_number: '1234', agreement_status: 'נשלח הסכם לחתימה', agreement_number: 'A-77', opt_in: true, opt_in_at: '2026-10-01T00:00:00Z',
    opt_out_at: null, marketing_opt_in: false, ...over };
}

let n = 0;
const uuid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;

export class FakeStore {
  records = new Map<string, WaRecord>();
  convs: Conversation[] = [];
  messages: Record<string, any>[] = [];
  logs: Record<string, unknown>[] = [];
  links: Record<string, any>[] = [];
  objects = new Map<string, { mime: string; size: number }>();
  suppressedPhones = new Set<string>();
  clock: () => Date = () => new Date();
  profiles = new Map<string, any>([[ADMIN, { role: 'admin', status: 'active', can_send_agreement: true }],
    [AGENT, { role: 'agent', status: 'active', can_send_agreement: false }], [VIEWER, { role: 'viewer', status: 'active' }]]);
  addRecord(r: WaRecord) { this.records.set(r.table + ':' + r.id, r); return r; }
  async record(t: RecordTable, id: string) { return this.records.get(t + ':' + id) ?? null; }
  async suppressed(e: string) { return this.suppressedPhones.has(e); }
  async conversation(e164: string, link?: { table: RecordTable; id: string } | null) {
    let c = this.convs.find(x => x.phone_e164 === e164);
    if (!c) { c = { id: uuid(), phone_e164: e164, record_table: link?.table ?? null, record_id: link?.id ?? null, last_inbound_at: null }; this.convs.push(c); }
    return c;
  }
  async conversationOrNull(e164: string) { return this.convs.find(x => x.phone_e164 === e164) ?? null; }
  async conversationById(id: string) { return this.convs.find(x => x.id === id) ?? null; }
  async countOutbound(f: { sinceIso: string; sentBy?: string; templatesOnly?: boolean }) {
    return this.messages.filter(m => m.direction === 'outbound' && m.status !== 'refused' && m.created_at >= f.sinceIso
      && (!f.sentBy || m.sent_by === f.sentBy) && (!f.templatesOnly || m.message_type === 'template')).length;
  }
  async byRequestId(id: string) { return this.messages.find(m => m.client_request_id === id && m.status !== 'refused') ?? null; }
  async insertMessage(row: Record<string, any>) {
    if (row.status !== 'refused' && row.client_request_id && this.messages.some(m => m.client_request_id === row.client_request_id && m.status !== 'refused')) return { conflict: true as const };
    const m = { id: uuid(), created_at: this.clock().toISOString(), ...row }; this.messages.push(m); return { id: m.id };
  }
  async updateMessage(id: string, patch: Record<string, unknown>) { Object.assign(this.messages.find(m => m.id === id)!, patch); }
  async touchConversation(id: string, patch: Record<string, unknown>) { Object.assign(this.convs.find(c => c.id === id)!, patch); }
  async sendLog(row: Record<string, unknown>) { this.logs.push(row); }
  async signedUrl(path: string, ttl: number, download?: string) { return `https://x.supabase.co/storage/v1/object/sign/business-files/${path}?ttl=${ttl}${download ? '&download=' + encodeURIComponent(download) : ''}`; }
  async signedUploadUrl(path: string) { return { path, token: 'upload-token' }; }
  async objectInfo(path: string) { return this.objects.get(path) ?? null; }
  async createShortLink(row: Record<string, any>) { const code = 'Code' + String(this.links.length + 1).padStart(6, '0'); this.links.push({ code, ...row }); return code; }
  async latestShortLink(kind: string, t: string, id: string) { return [...this.links].reverse().find(l => l.kind === kind && l.record_table === t && l.record_id === id) ?? null; }
  async message(id: string) { return this.messages.find(m => m.id === id) ?? null; }
  async profile(id: string) { return this.profiles.get(id) ?? null; }
  async userFromJwt(jwt: string) { return jwt.startsWith('jwt-') ? jwt.slice(4) : null; }
}

export interface FetchCall { url: string; init?: RequestInit; body?: any }
export function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const f = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(url, init);
  }) as typeof fetch;
  return { f, calls };
}
export const graphOk = () => fakeFetch(() => new Response(JSON.stringify({ messages: [{ id: 'wamid.HBgMOTcyNTQyNDI0OTk5FQIAERgSQUI=' }] }), { status: 200 }));
