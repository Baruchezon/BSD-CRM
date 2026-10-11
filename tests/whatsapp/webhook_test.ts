import assert from 'node:assert/strict';
import { hmacSha256Hex } from '../../supabase/functions/_shared/whatsapp.ts';
import { createWebhookHandler, type WebhookStore } from '../../supabase/functions/whatsapp-webhook/handler.ts';
import { BIZ, cfg, fakeFetch, LEAD } from './fakes.ts';

const SECRET = 'app-secret-test';
const PDF = new TextEncoder().encode('%PDF-1.4 signed agreement');

function mkStore(matches: { kind: any; id: string; is_archived: boolean }[] = []) {
  const s = {
    convs: new Map<string, any>(), messages: [] as any[], uploads: [] as any[], optOuts: [] as any[], bumps: [] as any[],
    async matchPhone() { return matches; },
    async conversationForInbound(e164: string, name: string | null) {
      if (!s.convs.has(e164)) s.convs.set(e164, { id: 'c-' + e164, phone_e164: e164, record_table: null, record_id: null, ambiguous: false, profile_name: name });
      return s.convs.get(e164);
    },
    async linkConversation(id: string, patch: any) { for (const c of s.convs.values()) if (c.id === id && !c.record_id) Object.assign(c, patch); },
    async insertInbound(row: any) {
      if (s.messages.some(m => m.provider_message_id === row.provider_message_id)) return { duplicate: true as const };
      const m = { id: 'm' + (s.messages.length + 1), ...row }; s.messages.push(m); return { id: m.id };
    },
    async updateMessage(id: string, patch: any) { Object.assign(s.messages.find(m => m.id === id), patch); },
    async bumpConversation(id: string, p: any) { s.bumps.push({ id, ...p }); },
    async messageByProviderId(pid: string) { return s.messages.find(m => m.provider_message_id === pid) ?? null; },
    async upload(path: string, bytes: Uint8Array, mime: string) { s.uploads.push({ path, size: bytes.length, mime }); },
    async optOutByPhone(e164: string, source: string, mid: string | null) { s.optOuts.push({ e164, source, mid }); return 1; },
  };
  return s;
}
async function sha(bytes: Uint8Array) { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)); let x = ''; d.forEach(b => x += String.fromCharCode(b)); return btoa(x); }
const graph = async (opts: { sha?: string; fail?: boolean; mediaUrl?: string } = {}) => fakeFetch(async (url) => {
  if (url.startsWith('https://graph.facebook.com/v23.0/MEDIA1')) return new Response(JSON.stringify({ url: opts.mediaUrl ?? 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'application/pdf', sha256: opts.sha ?? await sha(PDF), file_size: PDF.length }));
  if (url.startsWith('https://lookaside.fbsbx.com/')) return opts.fail ? new Response('x', { status: 404 }) : new Response(PDF as BodyInit);
  return new Response('{}', { status: 404 });
});
const envelope = (value: any, pid = '1346024128597094') => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: pid, display_phone_number: '972774446707' }, ...value } }] }] });
const msg = (over: any) => ({ contacts: [{ wa_id: '972501234567', profile: { name: 'דני' } }], messages: [{ from: '972501234567', id: 'wamid.IN1', timestamp: '1760173200', ...over }] });

async function post(h: (r: Request) => Promise<Response>, body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body);
  const sig = 'sha256=' + await hmacSha256Hex(secret, raw);
  const r = await h(new Request('https://f/whatsapp-webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': sig }, body: raw }));
  return { status: r.status, body: await r.json() };
}
const handler = (store: WebhookStore, f: typeof fetch, over: Partial<{ appSecret: string }> = {}) =>
  createWebhookHandler({ cfg: cfg(), store, fetch: f, verifyToken: 'verify-me', appSecret: SECRET, ...over });

Deno.test('webhook GET: subscription check', async () => {
  const h = handler(mkStore() as any, fakeFetch(() => new Response()).f);
  const ok = await h(new Request('https://f/?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345'));
  assert.equal(ok.status, 200); assert.equal(await ok.text(), '12345');
  assert.equal((await h(new Request('https://f/?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1'))).status, 403);
});
Deno.test('webhook: bad / missing signature -> 401, nothing stored; no secret -> 503', async () => {
  const s = mkStore(); const h = handler(s as any, fakeFetch(() => new Response()).f);
  assert.equal((await post(h, envelope(msg({ type: 'text', text: { body: 'x' } })), 'wrong-secret')).status, 401);
  assert.equal((await h(new Request('https://f', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal(s.messages.length, 0);
  const h2 = handler(s as any, fakeFetch(() => new Response()).f, { appSecret: '' });
  assert.equal((await h2(new Request('https://f', { method: 'POST', body: '{}' }))).status, 503);
});
Deno.test('webhook: inbound text -> conversation, message, unread bump, auto-link on a unique match', async () => {
  const s = mkStore([{ kind: 'businesses', id: BIZ, is_archived: false }]); const h = handler(s as any, fakeFetch(() => new Response()).f);
  const r = await post(h, envelope(msg({ type: 'text', text: { body: 'שלום, יש שאלה' } })));
  assert.equal(r.status, 200); assert.equal(r.body.inbound, 1);
  const c = s.convs.get('972501234567');
  assert.deepEqual([c.record_table, c.record_id, c.link_source, c.profile_name], ['businesses', BIZ, 'auto_phone', 'דני']);
  assert.equal(s.messages[0].message_text, 'שלום, יש שאלה');
  assert.equal(s.bumps[0].last_inbound_at, '2025-10-11T09:00:00.000Z');
});
Deno.test('webhook: several matches -> ambiguous with candidates, not linked; archived ignored', async () => {
  const s = mkStore([{ kind: 'businesses', id: BIZ, is_archived: false }, { kind: 'leads', id: LEAD, is_archived: false }, { kind: 'leads', id: 'arch', is_archived: true }]);
  const h = handler(s as any, fakeFetch(() => new Response()).f);
  await post(h, envelope(msg({ type: 'text', text: { body: 'x' } })));
  const c = s.convs.get('972501234567');
  assert.equal(c.record_id, null); assert.equal(c.ambiguous, true); assert.equal(c.candidates.length, 2);
});
Deno.test('webhook: an existing link (manual) is never overwritten', async () => {
  const s = mkStore([{ kind: 'leads', id: LEAD, is_archived: false }]);
  s.convs.set('972501234567', { id: 'c1', record_table: 'businesses', record_id: BIZ, link_source: 'manual' });
  await post(handler(s as any, fakeFetch(() => new Response()).f), envelope(msg({ type: 'text', text: { body: 'x' } })));
  assert.equal(s.convs.get('972501234567').record_id, BIZ);
});
Deno.test('webhook: inbound PDF downloaded (Bearer, sha256 checked) into business-files/whatsapp-inbound/<conv>/; NO auto-green', async () => {
  const s = mkStore([{ kind: 'businesses', id: BIZ, is_archived: false }]); const g = await graph();
  const r = await post(handler(s as any, g.f), envelope(msg({ type: 'document', document: { id: 'MEDIA1', filename: 'הסכם חתום.pdf', mime_type: 'application/pdf', caption: 'חתמתי' } })));
  assert.equal(r.body.media, 1);
  assert.equal(s.uploads.length, 1);
  assert.match(s.uploads[0].path, /^whatsapp-inbound\/c-972501234567\/m1-file\.pdf$/);
  const m = s.messages[0];
  assert.deepEqual([m.processing_status, m.media_filename, m.media_mime, m.message_text], ['done', 'הסכם חתום.pdf', 'application/pdf', 'חתמתי']);
  assert.equal((g.calls[1].init!.headers as any).Authorization, 'Bearer tok');
  assert.equal(m.agreement_confirmed_at, undefined, 'webhook never confirms an agreement');
  assert.ok(!('agreement_status' in m));
});
Deno.test('webhook: media URL outside Meta hosts is not fetched (token stays on Meta)', async () => {
  const s = mkStore(); const g = await graph({ mediaUrl: 'https://evil.example/steal-token' });
  const r = await post(handler(s as any, g.f), envelope(msg({ type: 'document', document: { id: 'MEDIA1', filename: 'a.pdf' } })));
  assert.equal(r.status, 200);
  assert.equal(s.uploads.length, 0);
  assert.equal(s.messages[0].processing_status, 'failed');
  assert.ok(g.calls.every(c => !c.url.includes('evil.example')));
  assert.equal(g.calls.length, 1);
});
Deno.test('webhook: sha256 mismatch / download failure -> stored as failed, no upload, still 200', async () => {
  for (const g of [await graph({ sha: 'AAAA' }), await graph({ fail: true })]) {
    const s = mkStore();
    const r = await post(handler(s as any, g.f), envelope(msg({ type: 'document', document: { id: 'MEDIA1', filename: 'a.pdf' } })));
    assert.equal(r.status, 200); assert.equal(s.uploads.length, 0); assert.equal(s.messages[0].processing_status, 'failed');
  }
});
Deno.test('webhook: Meta retry of the same message is stored once', async () => {
  const s = mkStore(); const h = handler(s as any, fakeFetch(() => new Response()).f);
  const body = envelope(msg({ type: 'text', text: { body: 'x' } }));
  await post(h, body); const r = await post(h, body);
  assert.equal(s.messages.length, 1); assert.equal(r.body.duplicate, 1); assert.equal(s.bumps.length, 1);
});
Deno.test('webhook: STOP text and the «הסר אותי» button opt the phone out', async () => {
  const s = mkStore(); const h = handler(s as any, fakeFetch(() => new Response()).f);
  await post(h, envelope(msg({ type: 'text', text: { body: 'הסר' } })));
  await post(h, envelope(msg({ id: 'wamid.IN2', type: 'button', button: { text: 'הסר אותי', payload: 'BSD_OPT_OUT' } })));
  assert.deepEqual(s.optOuts.map(o => o.source), ['whatsapp_stop', 'whatsapp_button']);
});
Deno.test('webhook: statuses move forward only; failed keeps the error', async () => {
  const s = mkStore(); s.messages.push({ id: 'o1', provider_message_id: 'wamid.OUT1', status: 'accepted' });
  const h = handler(s as any, fakeFetch(() => new Response()).f);
  const st = (status: string, extra: any = {}) => post(h, envelope({ statuses: [{ id: 'wamid.OUT1', status, timestamp: '1760173300', recipient_id: '972501234567', ...extra }] }));
  await st('delivered'); await st('sent'); assert.equal(s.messages[0].status, 'delivered');
  await st('read'); assert.equal(s.messages[0].status, 'read');
  s.messages.push({ id: 'o2', provider_message_id: 'wamid.OUT2', status: 'sent' });
  await post(h, envelope({ statuses: [{ id: 'wamid.OUT2', status: 'failed', timestamp: '1760173300', errors: [{ code: 131026, title: 'Message undeliverable' }] }] }));
  assert.deepEqual([s.messages[1].status, s.messages[1].error_code], ['failed', '131026']);
});
Deno.test('webhook: events for another phone number on the same app are ignored', async () => {
  const s = mkStore(); const r = await post(handler(s as any, fakeFetch(() => new Response()).f), envelope(msg({ type: 'text', text: { body: 'x' } }), '999999'));
  assert.equal(r.body.foreign, 1); assert.equal(s.messages.length, 0);
});
Deno.test('webhook: storage failure -> 500 so Meta retries (idempotent)', async () => {
  const s = mkStore(); (s as any).insertInbound = async () => { throw new Error('db down'); };
  const r = await post(handler(s as any, fakeFetch(() => new Response()).f), envelope(msg({ type: 'text', text: { body: 'x' } })));
  assert.equal(r.status, 500);
});
