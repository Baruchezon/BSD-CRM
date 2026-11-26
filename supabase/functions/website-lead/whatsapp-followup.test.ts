import { assertEquals } from 'jsr:@std/assert@1';
import { leadFirstName, leadTopic, sendLeadFollowup, wantsWhatsApp } from './whatsapp-followup.ts';
import { FakeStore, LEAD, record } from '../../../tests/whatsapp/fakes.ts';

const fakeDb = (prev: unknown[] = []) => {
  const q: any = { select: () => q, eq: () => q, not: () => q, gte: () => q, limit: async () => ({ data: prev }) };
  return { from: () => q };
};
const envOf = (o: Record<string, string>) => (k: string) => ({ WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '1346024128597094',
  WHATSAPP_TEST_NUMBERS: '972542424999', SUPABASE_URL: 'https://x.supabase.co', ...o } as Record<string, string>)[k];
const okFetch = (async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST1234567890' }] }), { status: 200 })) as typeof fetch;
const leadStore = (over = {}) => { const s = new FakeStore(); s.addRecord(record({ table: 'leads', id: LEAD, phones: ['054-2424999'], ...over })); return s; };

Deno.test('consent box: only an explicit tick counts', () => {
  assertEquals(wantsWhatsApp({ whatsapp_consent: true }), true);
  assertEquals(wantsWhatsApp({ whatsapp_consent: 'on' }), true);
  assertEquals(wantsWhatsApp({ whatsapp_consent: false }), false);
  assertEquals(wantsWhatsApp({ whatsapp_consent: 'false' }), false);
  assertEquals(wantsWhatsApp({ phone: '0542424999' }), false);
  assertEquals(wantsWhatsApp(null), false);
});
Deno.test('topic + first name', () => {
  assertEquals(leadTopic('seller'), 'מכירת עסק');
  assertEquals(leadTopic('training'), 'הכשרת מתווכי עסקים');
  assertEquals(leadTopic('question'), 'עסקים למכירה');
  assertEquals(leadFirstName('  דני כהן '), 'דני');
  assertEquals(leadFirstName('{{1}}'), 'לקוח');
});
Deno.test('fail-closed: flag missing / not exactly "true" -> nothing sent', async () => {
  for (const v of [undefined, 'TRUE', '1', 'yes']) {
    const r = await sendLeadFollowup(fakeDb(), LEAD, 'דני', '0542424999', 'seller', { env: envOf(v ? { WHATSAPP_LEAD_AUTOSEND: v, WHATSAPP_MODE: 'live' } : { WHATSAPP_MODE: 'live' }), store: leadStore(), fetch: okFetch });
    assertEquals(r, { sent: false, reason: 'autosend_off' });
  }
});
Deno.test('mode off -> nothing sent', async () => {
  const r = await sendLeadFollowup(fakeDb(), LEAD, 'דני', '0542424999', 'seller', { env: envOf({ WHATSAPP_LEAD_AUTOSEND: 'true', WHATSAPP_MODE: 'off' }), store: leadStore(), fetch: okFetch });
  assertEquals(r.reason, 'mode_off');
});
Deno.test('already sent in the last 30 days -> no second message', async () => {
  const r = await sendLeadFollowup(fakeDb([{ id: 'x' }]), LEAD, 'דני', '0542424999', 'seller', { env: envOf({ WHATSAPP_LEAD_AUTOSEND: 'true', WHATSAPP_MODE: 'live' }), store: leadStore(), fetch: okFetch });
  assertEquals(r.reason, 'already_sent');
});
Deno.test('live + consent -> bsd_lead_followup sent with name and topic', async () => {
  const s = leadStore();
  const r = await sendLeadFollowup(fakeDb(), LEAD, 'דני כהן', '0542424999', 'buyer', { env: envOf({ WHATSAPP_LEAD_AUTOSEND: 'true', WHATSAPP_MODE: 'live' }), store: s, fetch: okFetch });
  assertEquals(r, { sent: true, reason: 'sent' });
  const m = s.messages.find(x => x.template_name === 'bsd_lead_followup');
  assertEquals(m?.template_params, ['דני', 'רכישת עסק']);
});
Deno.test('opted-out phone is never messaged', async () => {
  const s = leadStore(); s.suppressedPhones.add('972542424999');
  const r = await sendLeadFollowup(fakeDb(), LEAD, 'דני', '0542424999', 'buyer', { env: envOf({ WHATSAPP_LEAD_AUTOSEND: 'true', WHATSAPP_MODE: 'live' }), store: s, fetch: okFetch });
  assertEquals(r, { sent: false, reason: 'opted_out' });
});
Deno.test('dry_run: only the test number', async () => {
  const s = leadStore({ phones: ['050-1234567'] });
  const r = await sendLeadFollowup(fakeDb(), LEAD, 'דני', '0501234567', 'buyer', { env: envOf({ WHATSAPP_LEAD_AUTOSEND: 'true', WHATSAPP_MODE: 'dry_run' }), store: s, fetch: okFetch });
  assertEquals(r.sent, false);
  assertEquals(r.reason, 'dry_run_number_not_allowed');
});
Deno.test('any exception -> caught, intake unaffected', async () => {
  const bad: any = { from: () => { throw new Error('db down'); } };
  const r = await sendLeadFollowup(bad, LEAD, 'דני', '0542424999', 'buyer', { env: envOf({ WHATSAPP_LEAD_AUTOSEND: 'true', WHATSAPP_MODE: 'live' }), store: leadStore(), fetch: okFetch });
  assertEquals(r, { sent: false, reason: 'error' });
});
