// WhatsApp 077 CRM UI: pure helpers + "hidden by default" contract (11.10.2026, branch eldad/whatsapp-cloud-api).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../js/whatsapp-api.js');
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('UI flag ships OFF: config.js sets WHATSAPP_API_UI = false', () => {
  assert.match(read('js/config.js'), /window\.BSD_CONFIG\.WHATSAPP_API_UI = false;/);
});
test('card slot renders nothing while the flag is off, a mount point when on', () => {
  const run = flag => {
    const win = { BSD_CONFIG: { WHATSAPP_API_UI: flag }, BSDWhatsApp: { enabled: () => flag, esc: s => String(s) } };
    const ctx = { window: win, document: { readyState: 'complete', querySelectorAll: () => [], body: {} }, MutationObserver: class { observe() {} } };
    vm.runInNewContext(read('js/whatsapp-card.js'), ctx);
    return win.BSDWhatsAppCard.slot('businesses', '10000000-0000-4000-8000-000000000001');
  };
  assert.equal(run(false), '');
  assert.match(run(true), /class="bsd-wa-slot" data-wa-table="businesses"/);
});
test('card pages only add a slot + script tags (no change to the 054 wa.me buttons)', () => {
  for (const p of ['businesses.html', 'leads.html', 'brokers.html']) {
    const s = read(p);
    assert.match(s, /BSDWhatsAppCard\.slot\(/, p);
    assert.match(s, /js\/whatsapp-card\.js/, p);
  }
  assert.ok(!/wa\.me\//.test(read('js/whatsapp-api.js') + read('js/whatsapp-card.js') + read('js/whatsapp-inbox.js')), 'new UI never opens wa.me');
});
test('24h window label', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  assert.equal(W.windowState('2026-10-11T02:00:00Z', now).open, true);
  assert.match(W.windowState('2026-10-11T02:00:00Z', now).label, /עוד 14 שעות/);
  assert.equal(W.windowState('2026-10-10T11:00:00Z', now).open, false);
  assert.match(W.windowState(null, now).label, /תבנית/);
});
test('«אשר כהסכם חתום» only for a stored inbound PDF on a card that is not green, by a permitted user', () => {
  const m = { direction: 'inbound', storage_path: 'whatsapp-inbound/c/m.pdf', media_mime: 'application/pdf' };
  const rec = { agreement_status: 'נשלח הסכם לחתימה' };
  assert.equal(W.canConfirmAgreement(m, rec, true), true);
  assert.equal(W.canConfirmAgreement(m, rec, false), false);
  assert.equal(W.canConfirmAgreement({ ...m, direction: 'outbound' }, rec, true), false);
  assert.equal(W.canConfirmAgreement({ ...m, media_mime: 'image/jpeg', storage_path: 'x/y.jpg' }, rec, true), false);
  assert.equal(W.canConfirmAgreement({ ...m, agreement_confirmed_at: '2026-10-11' }, rec, true), false);
  assert.equal(W.canConfirmAgreement(m, { agreement_status: 'יש הסכם חתום' }, true), false);
  assert.equal(W.canConfirmAgreement({ ...m, storage_path: null }, rec, true), false);
});
test('helpers: phone, record links, error texts, template fields', () => {
  assert.equal(W.fmtPhone('972542424999'), '054-2424999');
  assert.equal(W.recordHref('businesses', 'abc'), 'businesses.html?open=abc');
  assert.equal(W.recordHref('leads', 'a b'), 'leads.html?open=a%20b');
  assert.equal(W.recordHref(null, null), null);
  assert.match(W.errorText('window_closed_use_template'), /24 שעות/);
  assert.match(W.errorText('weird'), /weird/);
  const t = { name: 'bsd_buyer_update', params: [{ key: 'first_name' }, { key: 'client_number' }, { key: 'update_code' }] };
  assert.deepEqual(W.editableParams(t).map(p => p.key), ['update_code']);
  assert.equal(W.needsUrlTarget({ name: 'bsd_portal_access', url_button: 'x' }), true);
  assert.equal(W.needsUrlTarget({ name: 'bsd_signing_reminder', url_button: 'x' }), false);
  assert.match(W.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(W.conversationTitle({ record_label: null, profile_name: null, phone_e164: '972501234567' }), '050-1234567');
});
test('inbox / card escape every server value before inserting HTML', () => {
  for (const f of ['js/whatsapp-inbox.js', 'js/whatsapp-card.js']) {
    const s = read(f);
    for (const field of ['message_text', 'media_filename', 'record_label', 'profile_name', 'last_message_preview', 'error_message']) {
      const raw = new RegExp('\\$\\{(?:m|c)\\.' + field + '\\s*(?:\\}|\\|\\|)');
      const htmlLines = s.split('\n').filter(l => /<[a-z]/i.test(l) && !/confirm\(/.test(l));
      assert.ok(!htmlLines.some(l => raw.test(l)), `${f}: ${field} interpolated into HTML without esc()`);
    }
  }
});
