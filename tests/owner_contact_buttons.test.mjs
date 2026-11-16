import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
// Load the real helpers from the page (esc … refreshOwnerContactActions) without a DOM.
const start = html.indexOf('function esc(s)');
const end = html.indexOf('function refreshOwnerContactActions');
assert.ok(start > 0 && end > start);
const api = new Function(html.slice(start, end) + '; return { ownerContactActions, waPhoneDigits, waBtn };')();

test('owner phone renders a tel: dial button and a wa.me WhatsApp button', () => {
  const out = api.ownerContactActions('050-123-4567');
  assert.match(out, /class="oc-btn oc-tel" href="tel:0501234567"/);
  assert.match(out, /class="oc-btn oc-wa" href="https:\/\/wa\.me\/972501234567" target="_blank" rel="noopener"/);
  assert.match(out, />WhatsApp<\/a>$/);
});

test('number rule: digits only, 0 → 972, existing 972 kept', () => {
  assert.match(api.ownerContactActions('+972 54-765-4321'), /wa\.me\/972547654321"/);
  assert.match(api.ownerContactActions('972-52-1112222'), /wa\.me\/972521112222"/);
  assert.match(api.ownerContactActions('(03) 555 1234'), /wa\.me\/97235551234"/);
  assert.match(api.ownerContactActions('+972 54-765-4321'), /href="tel:\+972547654321"/);
});

test('empty phone shows nothing; output is escaped', () => {
  for (const v of [null, undefined, '', '   ']) assert.equal(api.ownerContactActions(v), '');
  const out = api.ownerContactActions('050"><img src=x onerror=alert(1)>1234567');
  assert.ok(!out.includes('<img'));
});

test('card section uses it under the owner phone; list WhatsApp button unchanged; build bumped', () => {
  assert.match(html, /fieldRowPhone\('owner_phone','טלפון הבעלים', biz\?\.owner_phone, `<div class="owner-contact-actions" id="owner_phone_actions">\$\{ownerContactActions\(biz\?\.owner_phone\)\}<\/div>`\)/);
  assert.match(api.waBtn('0501234567'), /^<a href="https:\/\/wa\.me\/972501234567" target="_blank" rel="noopener" title="WhatsApp" onclick="event\.stopPropagation\(\)"/);
  assert.match(html, /\.oc-btn\.oc-wa\{background:linear-gradient/);
  const version = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8')).version;
  assert.match(html, new RegExp(`var PAGE_BUILD = '${version}';`));
});
