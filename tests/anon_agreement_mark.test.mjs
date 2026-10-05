import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { anonAgreementIsSigned, anonAgreementLabel, anonAgreementMark } = require('../js/anonAgreementMark.js');
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('signed agreement is exactly «יש הסכם חתום»', () => {
  assert.equal(anonAgreementIsSigned('יש הסכם חתום'), true);
  assert.equal(anonAgreementLabel('יש הסכם חתום'), 'יש הסכם');
  const html = anonAgreementMark('יש הסכם חתום');
  assert.match(html, /class="anon-agr-mark yes"/);
  assert.match(html, />יש הסכם</);
  assert.doesNotMatch(html, /אין הסכם/);
});

test('sent, missing, and empty statuses are «אין הסכם»', () => {
  for (const status of ['נשלח הסכם לחתימה', 'אין הסכם', '', null, undefined, 'אחר']) {
    assert.equal(anonAgreementIsSigned(status), false, String(status));
    assert.equal(anonAgreementLabel(status), 'אין הסכם');
    const html = anonAgreementMark(status);
    assert.match(html, /class="anon-agr-mark no"/);
    assert.match(html, />אין הסכם</);
    assert.doesNotMatch(html, /יש הסכם חתום|נשלח/);
  }
});

test('the mark never echoes the raw status or contact fields', () => {
  const html = anonAgreementMark('יש הסכם חתום<script>');
  assert.equal(html.includes('script'), false);
  assert.equal(html.includes('owner_'), false);
});

function cardHtml(page, status) {
  const src = read(page);
  const start = src.indexOf('function renderAnonBizGrid()');
  const end = src.indexOf('async function viewAnonFile');
  const ctx = {
    document: { getElementById: () => ({ innerHTML: '' }) },
    ALL_ANON_BIZ: [{
      id: 'b1',
      anon_display_name: 'עסק בתחום המזון',
      field: 'מזון',
      category: 'מסעדות',
      city: 'תל אביב',
      agreement_status: status,
      business_number: 'BSD-B-1',
      handled_by: 'u1',
      anon_summary: 'תקציר',
    }],
    ANON_BIZ_FILES: { b1: [] },
    esc: v => String(v ?? ''),
    fmtDateTime: () => '',
    userName: () => 'סוכן',
    anonAgreementIsSigned,
    anonAgreementMark,
  };
  const box = { innerHTML: '' };
  ctx.document.getElementById = () => box;
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end), ctx);
  ctx.renderAnonBizGrid();
  return box.innerHTML;
}

for (const page of ['businesses.html', 'businesses-preview.html']) {
  test(page + ' anonymous cards always show the binary mark', () => {
    const yes = cardHtml(page, 'יש הסכם חתום');
    const sent = cardHtml(page, 'נשלח הסכם לחתימה');
    const none = cardHtml(page, null);
    assert.match(yes, /anon-agr-mark yes/);
    assert.match(yes, />יש הסכם</);
    assert.match(sent, /anon-agr-mark no/);
    assert.match(sent, />אין הסכם</);
    assert.match(none, /anon-agr-mark no/);
    assert.doesNotMatch(yes + sent + none, /הסכם חתום|color:#888|owner_phone|owner_email|owner_name/);
    const src = read(page);
    const grid = src.slice(src.indexOf('function renderAnonBizGrid()'), src.indexOf('async function viewAnonFile'));
    assert.match(grid, /anonAgreementMark\(b\.agreement_status\)/);
    const preview = src.slice(src.indexOf('function previewAnonCard('), src.indexOf('async function requestBusinessAccess'));
    assert.match(preview, /anonAgreementMark\(biz\.agreement_status\)/);
    const modal = src.slice(src.indexOf('async function openSendAnonModal('), src.indexOf('function getSelectedSendAnonChannel'));
    assert.match(modal, /anonAgreementMark\(biz\.agreement_status\)/);
  });
}

test('anonymous view exposes agreement_status and no contact columns', () => {
  const sql = read('migrations/2026-10-05_anon_card_agreement_status.sql');
  assert.match(sql, /agreement_status/);
  assert.match(sql, /business_number,\s*agreement_status/);
  assert.doesNotMatch(sql, /owner_phone|owner_email|owner_name|agreement_pdf_path|internal_name/);
  assert.match(sql, /get_business_access_level\(id, auth\.uid\(\)\) = 'anonymous'/);
});
