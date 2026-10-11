import assert from 'node:assert/strict';
import { cleanParam, hmacSha256Hex, isStopMessage, nextStatus, readConfig, safeFilename, safeTextParam, storageSafeName, templatePayload, toE164,
  windowOpen } from '../../supabase/functions/_shared/whatsapp.ts';
import { TEMPLATES } from '../../supabase/functions/_shared/whatsapp-templates.ts';

Deno.test('toE164: Israeli formats', () => {
  assert.equal(toE164('054-2424999'), '972542424999');
  assert.equal(toE164('+972 54 242 4999'), '972542424999');
  assert.equal(toE164('00972542424999'), '972542424999');
  assert.equal(toE164('9720542424999'), '972542424999');
  assert.equal(toE164('077-4446707'), '972774446707');
  assert.equal(toE164('03-1234567'), '97231234567');
  assert.equal(toE164('12345'), null);
  assert.equal(toE164('+1 415 555 0100'), '14155550100');
  assert.equal(toE164('4155550100'), null, 'no guessing of foreign numbers');
  assert.equal(toE164(null), null);
});
Deno.test('config: default off, test numbers normalised, short-link base', () => {
  assert.equal(readConfig(() => undefined).mode, 'off');
  assert.equal(readConfig(k => ({ WHATSAPP_MODE: 'LIVE!' } as any)[k]).mode, 'off');
  const c = readConfig(k => ({ WHATSAPP_MODE: 'dry_run', WHATSAPP_TEST_NUMBERS: '054-2424999, bad', SUPABASE_URL: 'https://r.supabase.co/' } as any)[k]);
  assert.deepEqual(c.testNumbers, ['972542424999']);
  assert.equal(c.shortLinkBase, 'https://r.supabase.co/functions/v1/go/');
  assert.equal(c.graphVersion, 'v23.0');
});
Deno.test('params: Meta-safe and no links/phones/passwords', () => {
  assert.equal(cleanParam('a\n\tb    c'), 'a b c');
  assert.equal(safeTextParam('https://evil'), null);
  assert.equal(safeTextParam('0541234567'), null);
  assert.equal(safeTextParam('הסיסמה 1234'), null);
  assert.equal(safeTextParam('דני'), 'דני');
});
Deno.test('filenames: safe display name + ASCII storage key', () => {
  const f = safeFilename('../../etc/passwd');
  assert.ok(!f.includes('/') && !f.startsWith('.'), f);
  assert.equal(safeFilename(''), 'file');
  assert.equal(storageSafeName('הסכם חתום.PDF'), 'file.pdf');
  assert.equal(storageSafeName('Signed agreement v2.pdf'), 'Signed-agreement-v2.pdf');
});
Deno.test('STOP words (Hebrew + English), not ordinary text', () => {
  for (const w of ['הסר', 'הסר אותי', 'STOP', 'להסרה.']) assert.ok(isStopMessage(w), w);
  for (const w of ['אני רוצה להסיר את המודעה של העסק שלי', 'שלום', '']) assert.ok(!isStopMessage(w), w);
});
Deno.test('24h window', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  assert.ok(windowOpen('2026-10-10T12:00:01Z', now));
  assert.ok(!windowOpen('2026-10-10T11:59:59Z', now));
  assert.ok(!windowOpen(null, now));
});
Deno.test('status order never moves backwards', () => {
  assert.equal(nextStatus('accepted', 'sent'), 'sent');
  assert.equal(nextStatus('read', 'delivered'), null);
  assert.equal(nextStatus('delivered', 'failed'), null);
  assert.equal(nextStatus('sent', 'failed'), 'failed');
  assert.equal(nextStatus('simulated', 'read'), null);
});
Deno.test('template payload: document header + body + URL button + quick replies', () => {
  const p: any = templatePayload('972542424999', TEMPLATES.bsd_agreement_to_sign, ['דני', 'מכירת עסק'], { urlCode: 'Ab3kD9xQ12' });
  assert.equal(p.template.language.code, 'he');
  assert.deepEqual(p.template.components[1], { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'Ab3kD9xQ12' }] });
  assert.equal(p.template.components[2].sub_type, 'quick_reply');
  assert.throws(() => templatePayload('972542424999', TEMPLATES.bsd_agreement_to_sign, ['a', 'b'], {}), /url_code_required/);
  const d: any = templatePayload('972542424999', TEMPLATES.bsd_agreement_signed_copy, ['דני', 'A-1'], { document: { link: 'https://s/x.pdf', filename: 'a.pdf' } });
  assert.equal(d.template.components[0].parameters[0].document.filename, 'a.pdf');
});
Deno.test('HMAC matches the known vector', async () => {
  assert.equal(await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
});
