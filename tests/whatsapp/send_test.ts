import assert from 'node:assert/strict';
import { deliver } from '../../supabase/functions/_shared/whatsapp.ts';
import { TEMPLATES } from '../../supabase/functions/_shared/whatsapp-templates.ts';
import { agreementTarget, createSendHandler, DEFAULT_TARGET_HOSTS } from '../../supabase/functions/whatsapp-send/handler.ts';
import { ADMIN, AGENT, BARUCH, BIZ, cfg, FakeStore, fakeFetch, graphOk, LEAD, record, VIEWER } from './fakes.ts';

const rid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-11T09:00:00Z');
const SIGN = 'https://baruchezon.github.io/bsd-contracts/bsd-contract-signing-seller.html?d=eyJsb25nIjoiZGF0YSJ9';

function setup(over: Record<string, string> = {}, rec = record()) {
  const store = new FakeStore(); store.addRecord(rec);
  const g = graphOk();
  const allow = { record: async () => true, conversation: async () => true, storagePath: async () => true };
  const h = createSendHandler({ cfg: cfg(over), store, access: allow, fetch: g.f, origins: ['https://baruchezon.github.io'], now: () => now });
  const call = (user: string, body: Record<string, unknown>) => h(new Request('https://f/whatsapp-send', { method: 'POST',
    headers: { Authorization: 'Bearer jwt-' + user, Origin: 'https://baruchezon.github.io' }, body: JSON.stringify(body) })).then(async r => ({ status: r.status, body: await r.json() }));
  return { store, g, call };
}
const bizRec = { table: 'businesses', id: BIZ };

// ---------- deliver() gates ----------
Deno.test('deliver: mode off -> disabled, nothing stored, no network', async () => {
  const s = new FakeStore(); const g = graphOk(); const conv = await s.conversation(BARUCH);
  const r = await deliver(cfg({ WHATSAPP_MODE: 'off' }), s as any, g.f, { kind: 'text', to: BARUCH, conversation: conv, record: record(), sentBy: AGENT, requestId: rid(1), text: 'x' }, now);
  assert.deepEqual([r.ok, r.error, s.messages.length, g.calls.length], [false, 'disabled', 0, 0]);
});
Deno.test('deliver: missing credentials in live -> not_configured', async () => {
  const s = new FakeStore(); const g = graphOk();
  const r = await deliver(cfg({ WHATSAPP_TOKEN: '' }), s as any, g.f, { kind: 'text', to: BARUCH, conversation: await s.conversation(BARUCH), record: record(), sentBy: AGENT, requestId: rid(2), text: 'x' }, now);
  assert.equal(r.error, 'not_configured'); assert.equal(g.calls.length, 0);
});
Deno.test('deliver: card still on 054 (personal) -> refused, logged, no network', async () => {
  const s = new FakeStore(); const g = graphOk(); const conv = await s.conversation(BARUCH); conv.last_inbound_at = now.toISOString();
  const r = await deliver(cfg(), s as any, g.f, { kind: 'text', to: BARUCH, conversation: conv, record: record({ channel: 'personal' }), sentBy: AGENT, requestId: rid(3), text: 'x' }, now);
  assert.equal(r.error, 'record_not_on_api_channel'); assert.equal(g.calls.length, 0); assert.equal(s.messages[0].status, 'refused');
});
Deno.test('deliver: dry_run only reaches the test number (Baruch)', async () => {
  const s = new FakeStore(); const g = graphOk();
  const other = record({ phones: ['050-1234567'] });
  const c1 = await s.conversation('972501234567'); c1.last_inbound_at = now.toISOString();
  const r1 = await deliver(cfg({ WHATSAPP_MODE: 'dry_run' }), s as any, g.f, { kind: 'text', to: '972501234567', conversation: c1, record: other, sentBy: AGENT, requestId: rid(4), text: 'x' }, now);
  assert.equal(r1.error, 'dry_run_number_not_allowed'); assert.equal(g.calls.length, 0);
  const c2 = await s.conversation(BARUCH); c2.last_inbound_at = now.toISOString();
  const r2 = await deliver(cfg({ WHATSAPP_MODE: 'dry_run' }), s as any, g.f, { kind: 'text', to: BARUCH, conversation: c2, record: record(), sentBy: AGENT, requestId: rid(5), text: 'בדיקה' }, now);
  assert.ok(r2.ok); assert.equal(g.calls.length, 1);
  assert.equal(g.calls[0].url, 'https://graph.facebook.com/v23.0/1346024128597094/messages');
  assert.equal((g.calls[0].init!.headers as any).Authorization, 'Bearer tok');
  assert.equal(s.messages.find(m => m.id === r2.id)!.is_test, true);
});
Deno.test('deliver: simulate never touches the network', async () => {
  const s = new FakeStore(); const g = graphOk(); const conv = await s.conversation(BARUCH); conv.last_inbound_at = now.toISOString();
  const r = await deliver(cfg({ WHATSAPP_MODE: 'simulate', WHATSAPP_TOKEN: '' }), s as any, g.f, { kind: 'text', to: BARUCH, conversation: conv, record: record(), sentBy: AGENT, requestId: rid(6), text: 'x' }, now);
  assert.deepEqual([r.ok, r.message_status, g.calls.length], [true, 'simulated', 0]);
});
Deno.test('deliver: free text outside 24h -> window_closed_use_template', async () => {
  const s = new FakeStore(); const g = graphOk(); const conv = await s.conversation(BARUCH); conv.last_inbound_at = '2026-10-09T09:00:00Z';
  const r = await deliver(cfg(), s as any, g.f, { kind: 'text', to: BARUCH, conversation: conv, record: record(), sentBy: AGENT, requestId: rid(7), text: 'x' }, now);
  assert.equal(r.error, 'window_closed_use_template'); assert.equal(g.calls.length, 0);
});
Deno.test('deliver: consent gates (opt-out list, card opt-out, marketing, utility opt-in)', async () => {
  const base = async (rec: any, tpl = TEMPLATES.bsd_meeting_summary, suppressed = false, n = 10) => {
    const s = new FakeStore(); if (suppressed) s.suppressedPhones.add(BARUCH); const g = graphOk();
    const r = await deliver(cfg(), s as any, g.f, { kind: 'template', to: BARUCH, conversation: await s.conversation(BARUCH), record: rec, sentBy: AGENT,
      requestId: rid(n), template: tpl, values: ['דני', '11.10.2026', 'סיכום'].slice(0, tpl.params.length), document: tpl.header ? { link: 'https://s/a.pdf', filename: 'a.pdf' } : undefined }, now);
    return [r.error ?? 'ok', g.calls.length];
  };
  assert.deepEqual(await base(record(), undefined, true), ['opted_out', 0]);
  assert.deepEqual(await base(record({ opt_out_at: '2026-10-05T00:00:00Z' })), ['opted_out', 0]);
  assert.deepEqual(await base(record({ opt_in: false })), ['no_consent', 0]);
  assert.deepEqual(await base(record(), TEMPLATES.bsd_training_brochure), ['no_marketing_consent', 0]);
  assert.deepEqual(await base(record({ marketing_opt_in: true }), TEMPLATES.bsd_training_brochure), ['ok', 1]);
  assert.deepEqual(await base(record()), ['ok', 1]);
});
Deno.test('deliver: idempotent per client_request_id (double click = one message)', async () => {
  const s = new FakeStore(); const g = graphOk(); const conv = await s.conversation(BARUCH); conv.last_inbound_at = now.toISOString();
  const req = { kind: 'text' as const, to: BARUCH, conversation: conv, record: record(), sentBy: AGENT, requestId: rid(20), text: 'x' };
  const a = await deliver(cfg(), s as any, g.f, req, now); const b = await deliver(cfg(), s as any, g.f, req, now);
  assert.ok(a.ok && b.ok && b.duplicate); assert.equal(g.calls.length, 1); assert.equal(a.id, b.id);
});
Deno.test('deliver: per-user rate limit', async () => {
  const s = new FakeStore(); const g = graphOk(); const conv = await s.conversation(BARUCH); conv.last_inbound_at = now.toISOString();
  const c = cfg({ WHATSAPP_USER_PER_MINUTE: '2' }); s.clock = () => now;
  const res = [];
  for (let i = 0; i < 3; i++) res.push((await deliver(c, s as any, g.f, { kind: 'text', to: BARUCH, conversation: conv, record: record(), sentBy: AGENT, requestId: rid(30 + i), text: 'x' + i }, now)).error ?? 'ok');
  assert.deepEqual(res, ['ok', 'ok', 'rate_limited_user']);
});
Deno.test('deliver: Graph failure is stored as failed; 131047 maps to window_closed', async () => {
  const s = new FakeStore(); const conv = await s.conversation(BARUCH); conv.last_inbound_at = now.toISOString();
  const g = fakeFetch(() => new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 }));
  const r = await deliver(cfg(), s as any, g.f, { kind: 'text', to: BARUCH, conversation: conv, record: record(), sentBy: AGENT, requestId: rid(40), text: 'x' }, now);
  assert.equal(r.error, 'window_closed_use_template'); assert.equal(s.messages[0].status, 'failed'); assert.equal(s.messages[0].error_code, '131047');
});
Deno.test('deliver: phone must belong to the record', async () => {
  const s = new FakeStore(); const g = graphOk(); const conv = await s.conversation('972501111111'); conv.last_inbound_at = now.toISOString();
  const r = await deliver(cfg(), s as any, g.f, { kind: 'text', to: '972501111111', conversation: conv, record: record(), sentBy: AGENT, requestId: rid(41), text: 'x' }, now);
  assert.equal(r.error, 'phone_not_on_record');
});

// ---------- whatsapp-send handler ----------
Deno.test('send: auth + roles (no JWT 401, viewer 403)', async () => {
  const { call } = setup();
  const h = createSendHandler({ cfg: cfg(), store: new FakeStore(), access: {} as any, fetch: graphOk().f, origins: [] });
  assert.equal((await h(new Request('https://f', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await call(VIEWER, { action: 'status' })).status, 403);
});
Deno.test('send_agreement: short link with rid/rt, template with URL button, logged to whatsapp_send_log', async () => {
  const { store, g, call } = setup();
  const r = await call(ADMIN, { action: 'send_agreement', record: bizRec, signing_url: SIGN, client_request_id: rid(50) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const link = store.links[0];
  assert.equal(link.kind, 'agreement');
  const t = new URL(link.target_url);
  assert.equal(t.searchParams.get('rid'), BIZ); assert.equal(t.searchParams.get('rt'), 'businesses');
  assert.ok(t.searchParams.get('d'), 'original signing data kept');
  const sent = g.calls[0].body;
  assert.equal(sent.template.name, 'bsd_agreement_to_sign');
  assert.deepEqual(sent.template.components[0].parameters.map((p: any) => p.text), ['דני', 'מכירת עסק']);
  assert.equal(sent.template.components[1].parameters[0].text, r.body.short_code);
  assert.ok(!JSON.stringify(sent).includes('github.io'), 'no long raw link in the message');
  assert.equal(store.logs[0].template_key, 'api:bsd_agreement_to_sign');
  assert.equal(store.logs[0].entity_type, 'business');
});
Deno.test('send_agreement: agent without can_send_agreement is refused; foreign signing hosts refused', async () => {
  const { call } = setup();
  assert.equal((await call(AGENT, { action: 'send_agreement', record: bizRec, signing_url: SIGN, client_request_id: rid(51) })).body.error, 'forbidden_agreement');
  assert.equal((await call(ADMIN, { action: 'send_agreement', record: bizRec, signing_url: 'https://evil.example/bsd-contracts/bsd-contract-signing-seller.html', client_request_id: rid(52) })).body.error, 'bad_signing_url');
});
Deno.test('send_agreement: already signed card is not re-sent', async () => {
  const { call } = setup({}, record({ agreement_status: 'יש הסכם חתום' }));
  assert.equal((await call(ADMIN, { action: 'send_agreement', record: bizRec, signing_url: SIGN, client_request_id: rid(53) })).body.error, 'already_signed');
});
Deno.test('agreementTarget: page/table must match (broker page only for brokers)', () => {
  assert.equal(agreementTarget('https://baruchezon.github.io/bsd-contracts/bsd-contract-signing-broker.html', 'businesses', BIZ, DEFAULT_TARGET_HOSTS), null);
  assert.ok(agreementTarget('https://baruchezon.github.io/bsd-contracts/bsd-contract-signing-buyer.html', 'leads', LEAD, DEFAULT_TARGET_HOSTS));
  assert.equal(agreementTarget('http://baruchezon.github.io/bsd-contracts/bsd-contract-signing-buyer.html', 'leads', LEAD, DEFAULT_TARGET_HOSTS), null);
});
Deno.test('send_template: reminder reuses the latest agreement short link', async () => {
  const { store, g, call } = setup();
  await call(ADMIN, { action: 'send_agreement', record: bizRec, signing_url: SIGN, client_request_id: rid(54) });
  const r = await call(ADMIN, { action: 'send_template', template: 'bsd_signing_reminder', record: bizRec, values: { sent_date: '11.10.2026' }, client_request_id: rid(55) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(store.links.length, 1);
  assert.equal(g.calls[1].body.template.components[1].parameters[0].text, store.links[0].code);
});
Deno.test('send_template: fixed codes only for buyer update; bad params rejected', async () => {
  const { call } = setup();
  assert.equal((await call(AGENT, { action: 'send_template', template: 'bsd_buyer_update', record: bizRec, values: { update_code: 'free text!' }, client_request_id: rid(56) })).body.param, 'update_code');
  const ok = await call(AGENT, { action: 'send_template', template: 'bsd_buyer_update', record: bizRec, values: { update_code: 'call_soon' }, client_request_id: rid(57) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await call(AGENT, { action: 'send_template', template: 'bsd_meeting_summary', record: bizRec, values: { meeting_date: '2026-10-11', summary: 'x' }, client_request_id: rid(58) })).body.param, 'meeting_date');
  assert.equal((await call(AGENT, { action: 'send_template', template: '__proto__', record: bizRec, client_request_id: rid(59) })).body.error, 'unknown_template');
});
Deno.test('send_template: portal access via short link to an allowed host only', async () => {
  const { store, call } = setup();
  assert.equal((await call(AGENT, { action: 'send_template', template: 'bsd_portal_access', record: bizRec, url_target: 'https://evil.example/x', client_request_id: rid(60) })).body.error, 'bad_url_target');
  const r = await call(AGENT, { action: 'send_template', template: 'bsd_portal_access', record: bizRec, url_target: 'https://www.bsd-bbi.co.il/portal/activate?t=abc', client_request_id: rid(61) });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(store.links[0].kind, 'portal');
});
Deno.test('send_text / send_document inside the window from the inbox (conversation id)', async () => {
  const { store, g, call } = setup();
  const conv = await store.conversation(BARUCH, { table: 'businesses', id: BIZ }); conv.last_inbound_at = new Date(now.getTime() - 3600_000).toISOString();
  const t = await call(AGENT, { action: 'send_text', conversation_id: conv.id, text: 'שלום, קיבלנו', client_request_id: rid(70) });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(g.calls[0].body.text.body, 'שלום, קיבלנו');
  store.objects.set(`whatsapp-outbound/${conv.id}/abc-file.pdf`, { mime: 'application/pdf', size: 1000 });
  const d = await call(AGENT, { action: 'send_document', conversation_id: conv.id, document: { storage_path: `whatsapp-outbound/${conv.id}/abc-file.pdf`, filename: 'תיק מכירה.pdf' }, client_request_id: rid(71) });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(g.calls[1].body.document.filename, 'תיק מכירה.pdf');
  assert.ok(g.calls[1].body.document.link.includes('ttl=3600'));
  assert.equal((await call(AGENT, { action: 'send_document', conversation_id: conv.id, document: { storage_path: 'whatsapp-outbound/other-conv/x.pdf' }, client_request_id: rid(72) })).body.error, 'forbidden_document');
  assert.equal((await call(AGENT, { action: 'send_document', conversation_id: conv.id, document: { storage_path: '../agreements/x.pdf' }, client_request_id: rid(73) })).body.error, 'bad_document');
});
Deno.test('status: window + channel for the card UI; media_url requires conversation access', async () => {
  const { store, call } = setup();
  const conv = await store.conversation(BARUCH); conv.last_inbound_at = now.toISOString();
  const s = await call(AGENT, { action: 'status', record: bizRec });
  assert.equal(s.body.record.channel, 'api'); assert.equal(s.body.record.window_open, true);
  assert.equal(s.body.test_numbers[0], '97254•••999');
  store.messages.push({ id: rid(80), conversation_id: conv.id, storage_path: `whatsapp-inbound/${conv.id}/x-signed.pdf`, media_filename: 'signed.pdf', media_mime: 'application/pdf' });
  const m = await call(AGENT, { action: 'media_url', message_id: rid(80), download: true });
  assert.ok(m.body.url.includes('ttl=300') && m.body.url.includes('download=signed.pdf'));
  const denied = createSendHandler({ cfg: cfg(), store, access: { record: async () => false, conversation: async () => false, storagePath: async () => false }, fetch: graphOk().f, origins: [] });
  const r = await denied(new Request('https://f', { method: 'POST', headers: { Authorization: 'Bearer jwt-' + AGENT }, body: JSON.stringify({ action: 'media_url', message_id: rid(80) }) }));
  assert.equal(r.status, 403);
  const r2 = await denied(new Request('https://f', { method: 'POST', headers: { Authorization: 'Bearer jwt-' + AGENT }, body: JSON.stringify({ action: 'status', record: bizRec }) }));
  assert.equal(r2.status, 403);
});
Deno.test('list_templates: the CRM picker gets 12 templates with fixed options', async () => {
  const { call } = setup();
  const r = await call(AGENT, { action: 'list_templates' });
  assert.equal(r.body.templates.length, 12);
  assert.ok(r.body.templates.find((t: any) => t.name === 'bsd_buyer_update').params[2].options.call_soon);
});
