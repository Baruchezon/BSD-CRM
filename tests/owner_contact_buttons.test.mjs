import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const html = read('businesses.html');
const window = { addEventListener() {} };
const document = { addEventListener() {} };
new Function('window', 'document', read('js/record-actions.js'))(window, document);
const { contactActions } = window.BSDRecordActions;

test('card phone renders a dial button and a WhatsApp button', () => {
  const out = contactActions(['050-123-4567']);
  assert.match(out, /class="bsd-contact-call" href="tel:0501234567"/);
  assert.match(out, /class="bsd-contact-wa" href="https:\/\/wa\.me\/972501234567" target="_blank" rel="noopener"/);
});

test('normalizes Israeli and international numbers and deduplicates the same number', () => {
  assert.match(contactActions(['+972 54-765-4321']), /href="tel:\+972547654321"/);
  assert.match(contactActions(['972-52-1112222']), /wa\.me\/972521112222"/);
  assert.match(contactActions(['(03) 555 1234']), /wa\.me\/97235551234"/);
  assert.match(contactActions(['0044 7700 900123']), /wa\.me\/447700900123"/);
  assert.equal((contactActions(['0501234567', '+972 50 123 4567']).match(/wa\.me/g) || []).length, 1);
});

test('empty or unusable phone shows nothing', () => {
  assert.equal(contactActions([null, undefined, '', '   ', '050"><img src=x onerror=alert(1)>1234567']), '');
});

test('seller contact actions appear above the form in the card header', () => {
  assert.match(html, /<h3>\$\{biz \? 'עריכת עסק'.*<\/h3>\s*<div class="bsd-card-contacts" data-card-contacts><\/div>/);
  assert.match(html, /BSDRecordActions\.bindContacts\(modal, \['owner_phone'\]\);\s*bsdTabifyBizForm\(biz\);/);
  assert.match(html, /title="WhatsApp" onclick="event\.stopPropagation\(\)"/);
  const version = JSON.parse(read('version.json')).version;
  assert.match(html, new RegExp(`var PAGE_BUILD = '${version}';`));
});
