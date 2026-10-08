// 08.10.2026 (בקשת ברוך): «שליחה במייל» of the seller-portal login details from the business card.
// Server side (new password, Resend, audit) is tested in tests/portal/handler_test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const card = read('js/portal-business-card.js');
const biz = read('businesses.html');
const mailTs = read('supabase/functions/seller-portal-api/access-email.ts');
function load(src) { const ctx = { window: {}, console }; vm.createContext(ctx); vm.runInContext(src, ctx); return ctx.window; }
const P = load(card).BSDSellerPortal;
const active = { status: 'active', username: '23456', pending: false };

test('button for an active account (also before a first password); disabled with a message when the card has no valid email', () => {
  assert.equal(P.emailState({ owner_email: 'owner@example.com' }, null).show, false);
  assert.equal(P.emailState({ owner_email: 'owner@example.com' }, { ...active, status: 'blocked' }).show, false);
  assert.equal(P.emailState({ owner_email: 'owner@example.com' }, { ...active, pending: true }).enabled, true);
  const ok = P.emailState({ owner_email: '  owner@example.com ' }, active);
  assert.deepEqual([ok.show, ok.enabled, ok.email], [true, true, 'owner@example.com']);
  for (const bad of [null, '', '   ', 'no-at-sign', 'a b@c.com', 'x@y', '<x@y.com>']) {
    const s = P.emailState({ owner_email: bad }, active);
    assert.ok(s.show && !s.enabled && /אין מייל בכרטיס/.test(s.note), String(bad));
  }
  assert.match(card, /data-portal-email \$\{m\.enabled\?'':'disabled aria-describedby="portalEmailNote"'\}>שליחה במייל<\/button>/);
  assert.match(card, /emailState\(biz,eligible\(\)\?account:null\)/, 'only for a business with a signed agreement');
});

test('confirm dialog: business, owner, destination, sender, and the new-password warning; escapes everything', () => {
  const h = P.emailConfirmHtml({ internal_name: 'עסק <b>בדיקה</b>', owner_name: 'ישראל ישראלי' }, 'owner@example.com', '23456');
  assert.ok(h.includes('עסק &lt;b&gt;בדיקה&lt;/b&gt;') && h.includes('ישראל ישראלי') && h.includes('owner@example.com') && h.includes('baruch@bsd-bbi.co.il'));
  assert.ok(h.includes('בשליחה תיווצר סיסמה חדשה, והסיסמה הקודמת תפסיק לעבוד'));
  assert.ok(h.includes('«פורטל בעלי עסקים»') && h.includes('23456'));
  assert.ok(!/הסיסמה לא נשלחת|WhatsApp|וואטסאפ/.test(h), 'no old wording');
  assert.ok(/data-email-send[^>]*>שליחה</.test(h) && /data-email-cancel[^>]*>ביטול</.test(h));
  assert.match(card, /if\(!await confirmEmail\(biz,m\.email,account\.username\)\)return;/, 'nothing is sent without confirmation');
});

test('server builds the email; the browser never sees or builds the password', () => {
  assert.ok(!/\.password\b|password:/.test(card.slice(card.indexOf('function emailState'), card.indexOf('function emailLogText'))));
  assert.match(card, /api\('admin_email_access',\{business_id:biz\.id\}\)/);
  assert.ok(!/onboarding@resend\.dev/.test(card + mailTs));
  assert.ok(!/מטעמי אבטחה|וואטסאפ|WhatsApp/.test(mailTs), 'Baruch: no security line, no WhatsApp wording');
  assert.ok(mailTs.includes("'צוות BSD'") && mailTs.includes('«פורטל בעלי עסקים»'));
});

test('log: existing audit_log (no new table), last attempt shown in the card', () => {
  assert.match(card, /from\('audit_log'\)\.select\('occurred_at,details'\)\.eq\('action',EMAIL_LOG_ACTION\)\.eq\('record_id',biz\.id\)/);
  assert.match(card, /EMAIL_LOG_ACTION='portal_access_email'/);
  assert.equal(P.emailLogText(null), '');
  assert.match(P.emailLogText({ occurred_at: '2026-10-08T06:00:00Z', details: { status: 'sent', to: 'owner@example.com' } }), /נשלח אל owner@example\.com · 08[./]10[./]2026/);
  assert.match(P.emailLogText({ occurred_at: '2026-10-08T06:00:00Z', details: { status: 'failed', to: 'owner@example.com' } }), /נכשל/);
});

test('no other new buttons; cache-busted', () => {
  assert.equal((card.match(/data-portal-email /g) || []).length, 1, 'one «שליחה במייל» button');
  assert.equal((card.match(/<button/g) || []).length, 12, 'existing 7 + email button + confirm «שליחה»/«ביטול» + open-account choice «פתח ושלח»/«ביטול»');
  assert.match(biz, /js\/portal-business-card\.js\?v=20261008-4/);
});
