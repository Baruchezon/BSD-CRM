// 11.10.2026 (Baruch): sale-file email + WhatsApp text must not carry the real
// business name to a buyer (or anyone else) unless they are the owner or a
// buyer with agreement_status «יש הסכם חתום». Synthetic names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../js/saleFileModule2.js', import.meta.url), 'utf8');
const ctx = {
  window: {},
  console,
  esc: s => String(s == null ? '' : s),
  toast(){},
  document: {
    getElementById(id){ return this._els[id] || null; },
    querySelectorAll(){ return this._checked; },
    _els: {},
    _checked: [],
  },
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const biz = { id: 'biz-1', internal_name: 'שם פנימי אמיתי', anonymous_name: 'עסק אנונימי' };
ctx.ALL_BIZ = [biz];

function preview(recipientType, agreementStatus){
  const file = { value: 'file-1', dataset: { name: 'תקציר.pdf', cat: 'תקציר', conf: '1' }, checked: true };
  ctx.document._checked = [file];
  ctx.document._els = {
    sfSendStatus: { innerHTML: '', textContent: '' },
    sfSendModalBody: { innerHTML: '' },
    sfSendBuyer: { value: 'buyer-1' },
    sfSendBroker: { value: 'broker-1' },
  };
  ctx.__recipientType = recipientType;
  ctx.__buyers = { 'buyer-1': { email: 'buyer@example.test', full_name: 'קונה בדיקה', agreement_status: agreementStatus, phone: '0500000000' } };
  ctx.__brokers = { 'broker-1': { email: 'broker@example.test', full_name: 'מתווך בדיקה', agreement_status: agreementStatus, phone: '0500000001' } };
  ctx.__owner = { email: 'owner@example.test', full_name: 'בעל העסק', phone: '0500000002' };
  vm.runInContext(`SF_SEND_RECIPIENT_TYPE = __recipientType; SF_SEND_BUYERS_CACHE = __buyers; SF_SEND_BROKERS_CACHE = __brokers; SF_SEND_OWNER_CACHE = __owner;`, ctx);
  ctx.sfShowSendPreview('biz-1', 'שם פנימי אמיתי');
  const html = ctx.document._els.sfSendModalBody.innerHTML;
  const subject = html.match(/id="sfPreviewSubject" value="([^"]*)"/)[1];
  const body = html.match(/id="sfPreviewBody"[^>]*>([\s\S]*?)<\/textarea>/)[1];
  return { html, subject, body, sent: subject + '\n' + body };
}

test('internal name only for the owner or a buyer with a signed agreement', () => {
  assert.equal(ctx.sfMessageBizName(biz, 'owner', undefined), 'שם פנימי אמיתי');
  assert.equal(ctx.sfMessageBizName(biz, 'owner', 'אין הסכם'), 'שם פנימי אמיתי');
  assert.equal(ctx.sfMessageBizName(biz, 'buyer', 'יש הסכם חתום'), 'שם פנימי אמיתי');
});

test('everyone else gets anonymous_name, including a signed broker and an unknown status', () => {
  assert.equal(ctx.sfMessageBizName(biz, 'buyer', 'אין הסכם'), 'עסק אנונימי');
  assert.equal(ctx.sfMessageBizName(biz, 'buyer', 'נשלח הסכם לחתימה'), 'עסק אנונימי');
  assert.equal(ctx.sfMessageBizName(biz, 'buyer', undefined), 'עסק אנונימי');
  assert.equal(ctx.sfMessageBizName(biz, 'buyer', null), 'עסק אנונימי');
  assert.equal(ctx.sfMessageBizName(biz, 'broker', 'יש הסכם חתום'), 'עסק אנונימי');
  assert.equal(ctx.sfMessageBizName(biz, 'broker', undefined), 'עסק אנונימי');
  assert.equal(ctx.sfMessageBizName(biz, 'agent', 'יש הסכם חתום'), 'עסק אנונימי');
});

test('empty anonymous name, or a business we cannot read, becomes העסק — never the internal name', () => {
  assert.equal(ctx.sfMessageBizName({ internal_name: 'סודי', anonymous_name: '  ' }, 'buyer', 'אין הסכם'), 'העסק');
  assert.equal(ctx.sfMessageBizName({ internal_name: '', anonymous_name: '' }, 'owner'), 'העסק');
  assert.equal(ctx.sfMessageBizName(null, 'buyer', 'יש הסכם חתום'), 'העסק');
  assert.equal(ctx.sfMessageBizName(undefined, 'owner'), 'העסק');
});

test('email subject/body and the WhatsApp draft hide the real name from a buyer without a signed agreement', () => {
  for (const status of ['אין הסכם', 'נשלח הסכם לחתימה', undefined]){
    const view = preview('buyer', status);
    assert.equal(view.sent.includes('שם פנימי אמיתי'), false, String(status));
    assert.match(view.body, /בנוגע לעסק אנונימי/);
    assert.match(view.subject, /חומרי מכירה \(אנונימי\)/);
    assert.match(view.html, /שם פנימי אמיתי/, 'the staff label in the modal is unchanged');
  }
  const signed = preview('buyer', 'יש הסכם חתום');
  assert.match(signed.body, /בנוגע לשם פנימי אמיתי/);
  assert.match(signed.subject, /חומרי מכירה - שם פנימי אמיתי/);
});

test('owner gets the internal name; a broker does not, even with a signed agreement', () => {
  const owner = preview('owner');
  assert.match(owner.body, /בנוגע לשם פנימי אמיתי/);
  const broker = preview('broker', 'יש הסכם חתום');
  assert.equal(broker.sent.includes('שם פנימי אמיתי'), false);
  assert.match(broker.body, /בנוגע לעסק אנונימי/);
  assert.match(broker.subject, /חומרי מכירה - עסק אנונימי/);
});

test('build 202610141200 in version.json; business card stays 202610130800', () => {
  const html = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
  const preview = fs.readFileSync(new URL('../businesses-preview.html', import.meta.url), 'utf8');
  const report = fs.readFileSync(new URL('../business-report-builder.html', import.meta.url), 'utf8');
  assert.match(html, /var PAGE_BUILD = '202610130800';/);
  assert.match(html, /saleFileModule2\.js\?v=202610130800/);
  assert.match(preview, /saleFileModule2\.js\?v=202610130800/);
  assert.match(report, /saleFileModule2\.js\?v=202610130800/);
  assert.equal(JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8')).version, '202610141200');
});

test('both send functions use the preview text and do not rebuild the internal name', () => {
  const wa = src.slice(src.indexOf('async function sfConfirmSendWhatsApp'), src.indexOf('async function saveAutoGeneratedSummaryPdf'));
  const mail = src.slice(src.indexOf('async function sfConfirmSend'), src.indexOf('function sfNormalizePhoneForWa'));
  assert.match(wa, /sfPreviewBody/);
  assert.match(mail, /sfPreviewBody/);
  assert.doesNotMatch(wa, /internal_name/);
  assert.doesNotMatch(mail, /internal_name/);
  const previewFn = src.slice(src.indexOf('function sfShowSendPreview'), src.indexOf('function sfWithClientTimeout'));
  assert.match(previewFn, /sfMessageBizName\(/);
  assert.match(previewFn, /בנוגע ל\$\{messageBizName\}/);
  assert.doesNotMatch(previewFn, /בנוגע ל\$\{bizName\}/);
});
