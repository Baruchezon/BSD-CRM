// 09.10.2026 (Baruch, via Grok Bot): every official BSD place shows only info@bsd-bbi.co.il, and every
// BSD email ends with the approved signature, no logo:
//   צוות BSD / BSD Business Brokers Israel · מחברים עסקים להזדמנויות / info@bsd-bbi.co.il | www.bsd-bbi.co.il
// Kept on purpose: the portal BCC to baruch@bsd-bbi.co.il, login identities (profiles.email lookups),
// and the technical web-push contact (VAPID_SUBJECT default), which no person ever sees.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const L1 = 'צוות BSD', L2 = 'BSD Business Brokers Israel · מחברים עסקים להזדמנויות', L3 = 'info@bsd-bbi.co.il | www.bsd-bbi.co.il';
const FN = 'supabase/functions/';
const mailers = ['send-match-summary', 'send-sale-files-to-buyer', 'send-ad-report-email', 'complete-signed-agreement', 'match-suggestions-report'];

test('every email function in the repo sends from info@ and carries the approved signature', () => {
  for (const f of mailers) {
    const s = read(FN + f + '/index.ts');
    assert.ok(s.includes('צוות BSD <info@bsd-bbi.co.il>'), f + ' sender');
    assert.ok(s.includes(L1) && s.includes(L2), f + ' signature lines 1-2');
    assert.ok(s.includes(L3) || (s.includes('mailto:info@bsd-bbi.co.il') && s.includes('www.bsd-bbi.co.il</a>')), f + ' signature line 3');
    assert.ok(!/ברוך איזון \| BSD Business Brokers Israel \| bsd-bbi\.co\.il/.test(s), f + ' old footer gone');
    assert.ok(!/onboarding@resend\.dev'|from: 'BSD CRM/.test(s), f + ' no test sender');
    assert.ok(!/<img\b/i.test(s), f + ' no logo');
  }
});

test('portal login email: no logo, ends with the approved signature (HTML and text), BCC unchanged', () => {
  const s = read(FN + 'seller-portal-api/access-email.ts');
  assert.ok(!/LOGO_URL|<img\b/.test(s), 'no logo');
  assert.ok(s.includes(`'${L1}',\n    '${L2}',\n    '${L3}',\n  ].join`), 'text ends with the 3 signature lines');
  const htmlEnd = s.slice(s.indexOf('בברכה,<br><b>צוות BSD</b>'));
  assert.ok(htmlEnd.includes(L2) && htmlEnd.includes('mailto:info@bsd-bbi.co.il'), 'html signature');
  assert.ok(!htmlEnd.includes('ליווי אישי. דיסקרטיות. שקיפות.'), 'nothing after the signature');
  assert.ok(s.includes("PORTAL_MAIL_BCC = 'baruch@bsd-bbi.co.il'"), 'BCC to baruch@ kept');
});

// Pulls the two helpers out of send-match-summary (TypeScript annotations stripped) and runs them.
function helpers() {
  const s = read(FN + 'send-match-summary/index.ts');
  let code = s.slice(s.indexOf('const SIGNATURE_MARK'), s.indexOf('\nconst supabase = createClient'));
  code = code.replace(/export function/g, 'function').replace(/\((\w+): string\)/g, '($1)').replace(/\((\w+): string, (\w+): string\)/g, '($1, $2)')
    .replace(/\): string \{/g, ') {').replace(/\}\[c\]!\)/g, '}[c])');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(code + ';this.signedText=signedText;this.signedHtml=signedHtml;', ctx);
  return ctx;
}

test('send-match-summary appends the signature once, at the very end, in text and RTL HTML', () => {
  const { signedText, signedHtml } = helpers();
  const t = signedText('שלום,\n\nמצורף חומר.\n\n---\nתקציר https://x.example/a?b=1&c=2\n');
  assert.ok(t.endsWith(`בברכה,\n${L1}\n${L2}\n${L3}`), 'text ends with signature');
  assert.equal(signedText(t), t, 'idempotent');
  const h = signedHtml('', 'שלום <b>\nhttps://x.example/a?b=1&c=2');
  assert.ok(h.startsWith('<div dir="rtl"') && h.includes('&lt;b&gt;') && h.includes('<a href="https://x.example/a?b=1&amp;c=2"'), 'escaped RTL html with links');
  assert.ok(h.trim().endsWith('</a></span></div>') && h.includes(L2) && h.includes('mailto:info@bsd-bbi.co.il'), 'html ends with signature');
  assert.equal(signedHtml('', t).split(L2).length, 2, 'no double signature when the text has it');
  const doc = signedHtml('<html><body><p>x</p></body></html>', '');
  assert.ok(doc.indexOf(L2) < doc.indexOf('</body>'), 'inserted before </body>');
});

test('CRM default email texts: ad report ends with the approved signature; buyer emails drop the old personal closing', () => {
  const ad = read('ad-reports.html');
  assert.ok(ad.includes(`'בברכה,\\n${L1}\\n${L2}\\n${L3}'`), 'ad report default body');
  for (const f of ['businesses.html', 'businesses-preview.html']) {
    assert.ok(!read(f).includes("בברכה,\\n${(CURRENT_PROFILE && CURRENT_PROFILE.full_name) || 'BSD Business Brokers Israel'}"), f);
  }
});

test('official CRM pages and PDFs show info@, never baruch@ (only the portal BCC note keeps it)', () => {
  const files = ['ad-reports.html', 'buyer-form.html', 'intake-form.html', 'help.html', 'match-detail.html', 'match-detail-preview.html',
    'training-brochure.html', 'js/standaloneRecording.js', 'js/pdfPipeline.js'];
  for (const f of files) {
    assert.ok(!read(f).includes('baruch@bsd-bbi.co.il'), f + ' has no baruch@');
  }
  for (const f of ['buyer-form.html', 'intake-form.html', 'match-detail.html', 'training-brochure.html', 'js/standaloneRecording.js', 'help.html']) {
    assert.ok(read(f).includes('info@bsd-bbi.co.il'), f + ' shows info@');
  }
  const card = read('js/portal-business-card.js');
  assert.equal((card.match(/baruch@bsd-bbi\.co\.il/g) || []).length, 2, 'portal BCC note + comment only');
});
