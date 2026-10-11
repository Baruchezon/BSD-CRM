import assert from 'node:assert/strict';
import { codeFromUrl, createGoHandler } from '../../supabase/functions/go/handler.ts';
import { sendSignedCopy, stableUuid } from '../../supabase/functions/_shared/whatsapp-signed-copy.ts';
import { BARUCH, BIZ, cfg, FakeStore, graphOk, record } from './fakes.ts';

const go = createGoHandler({ allowedHosts: ['baruchezon.github.io'], fallbackUrl: 'https://www.bsd-bbi.co.il/',
  async resolve(code) { return code === 'GoodCode12' ? { target_url: 'https://baruchezon.github.io/bsd-contracts/bsd-contract-signing-seller.html?rid=' + BIZ } : code === 'EvilCode12' ? { target_url: 'https://evil.example/' } : null; } });

Deno.test('go: 302 to the stored target, path or ?c=', async () => {
  for (const u of ['https://x.supabase.co/functions/v1/go/GoodCode12', 'https://x.supabase.co/functions/v1/go?c=GoodCode12']) {
    const r = await go(new Request(u)); assert.equal(r.status, 302); assert.ok(r.headers.get('location')!.includes('rid=' + BIZ));
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});
Deno.test('go: unknown/expired -> Hebrew 410; malformed -> 404; foreign target -> 404; HEAD does not resolve', async () => {
  assert.equal((await go(new Request('https://x/functions/v1/go/Unknown123'))).status, 410);
  assert.equal((await go(new Request('https://x/functions/v1/go/<script>'))).status, 404);
  assert.equal((await go(new Request('https://x/functions/v1/go/EvilCode12'))).status, 404);
  let called = false;
  const g2 = createGoHandler({ allowedHosts: [], fallbackUrl: '', async resolve() { called = true; return null; } });
  assert.equal((await g2(new Request('https://x/functions/v1/go/GoodCode12', { method: 'HEAD' }))).status, 200);
  assert.equal(called, false);
  assert.equal(codeFromUrl(new URL('https://x/functions/v1/go')), '');
});

Deno.test('signed copy: off -> nothing; personal card -> nothing (054 flow untouched)', async () => {
  const s = new FakeStore(); s.addRecord(record({ channel: 'personal' })); const g = graphOk();
  assert.equal((await sendSignedCopy({ db: null, table: 'businesses', recordId: BIZ, agreementNumber: 'A-1', storagePath: 'agreements/businesses/x.pdf', cfg: cfg({ WHATSAPP_MODE: 'off' }), store: s, fetchImpl: g.f })).reason, 'disabled');
  assert.equal((await sendSignedCopy({ db: null, table: 'businesses', recordId: BIZ, agreementNumber: 'A-1', storagePath: 'agreements/businesses/x.pdf', cfg: cfg(), store: s, fetchImpl: g.f })).reason, 'record_not_on_api_channel');
  assert.equal(g.calls.length, 0);
});
Deno.test('signed copy: outside window -> approved DOCUMENT template; retry sends once', async () => {
  const s = new FakeStore(); s.addRecord(record({ agreement_status: 'יש הסכם חתום' })); const g = graphOk();
  const o = { db: null, table: 'businesses' as const, recordId: BIZ, agreementNumber: 'BSD-2026-1042', storagePath: `agreements/businesses/${BIZ}.pdf`, cfg: cfg(), store: s, fetchImpl: g.f };
  const a = await sendSignedCopy(o); const b = await sendSignedCopy(o);
  assert.ok(a.ok && b.ok); assert.equal(g.calls.length, 1);
  const p = g.calls[0].body;
  assert.equal(p.to, BARUCH); assert.equal(p.template.name, 'bsd_agreement_signed_copy');
  assert.equal(p.template.components[0].parameters[0].document.filename, 'BSD-agreement-BSD-2026-1042.pdf');
  assert.equal(s.messages[0].sent_by, null); assert.equal(s.logs.length, 0, 'system send is not a user send-log row');
});
Deno.test('signed copy: inside window -> plain document message', async () => {
  const s = new FakeStore(); s.addRecord(record()); const g = graphOk();
  const now = new Date('2026-10-11T09:00:00Z');
  (await s.conversation(BARUCH, { table: 'businesses', id: BIZ })).last_inbound_at = '2026-10-11T08:00:00Z';
  const r = await sendSignedCopy({ db: null, table: 'businesses', recordId: BIZ, agreementNumber: 'A-2', storagePath: 'agreements/businesses/x.pdf', cfg: cfg(), store: s, fetchImpl: g.f, now });
  assert.ok(r.ok); assert.equal(g.calls[0].body.type, 'document');
});
Deno.test('stableUuid is a valid deterministic v5-style uuid', async () => {
  const a = await stableUuid('x'); assert.equal(a, await stableUuid('x')); assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
