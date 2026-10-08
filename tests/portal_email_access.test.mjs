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

test('before sending: the FULL email from the server preview (from, to, BCC, subject, body), new-password warning, escapes everything', () => {
  const d = { from: 'צוות BSD <baruch@bsd-bbi.co.il>', to: 'owner@example.com', bcc: 'baruch@bsd-bbi.co.il', subject: 'האזור האישי שלך ב-BSD: פרטי כניסה', html: '<p>שלום "בעלים"</p><b>סיסמה חדשה תיווצר בעת השליחה</b>', password_note: 'סיסמה חדשה תיווצר בעת השליחה', username_known: true };
  const h = P.emailPreviewHtml(d, { internal_name: 'עסק <b>בדיקה</b>' });
  assert.ok(h.includes('עסק &lt;b&gt;בדיקה&lt;/b&gt;') && h.includes('owner@example.com') && h.includes('baruch@bsd-bbi.co.il') && h.includes('עותק מוסתר (BCC)') && h.includes('האזור האישי שלך ב-BSD: פרטי כניסה'));
  assert.match(h, /<iframe data-email-body sandbox="" title="תוכן המייל" srcdoc="&lt;p&gt;שלום &quot;בעלים&quot;&lt;\/p&gt;/, 'body shown as the owner gets it, in a sandboxed frame');
  assert.ok(h.includes('בשליחה תיווצר סיסמה חדשה, והסיסמה הקודמת תפסיק לעבוד'));
  assert.ok(!P.emailPreviewHtml({ ...d, username_known: false }).includes('data-new-password-warning'), 'no warning for a brand-new account');
  assert.ok(/data-email-send[^>]*>אישור ושליחה</.test(h) && /data-email-cancel[^>]*>ביטול</.test(h));
  assert.match(card, /if\(!await previewAndConfirm\(biz\.id,biz\)\)return;/, 'nothing is sent without approving the preview');
  assert.match(card, /api\('admin_email_preview',\{business_id:businessId\}\)/);
});

test('server builds the email; the browser never sees or builds the password', () => {
  assert.ok(!/\.password\b|password:/.test(card.slice(card.indexOf('function emailState'), card.indexOf('function credentialsHtml'))));
  assert.match(card, /res=await api\('admin_email_access',\{business_id:businessId\}\)/);
  assert.ok(!/onboarding@resend\.dev|resend\.com/i.test(card));
  assert.ok(!/onboarding@resend\.dev/.test(mailTs));
  assert.ok(!/מטעמי אבטחה|וואטסאפ|WhatsApp/.test(mailTs), 'Baruch: no security line, no WhatsApp wording');
  assert.ok(mailTs.includes("'צוות BSD'") && mailTs.includes('«פורטל בעלי עסקים»'));
});

test('log: existing audit_log (no new table); every portal email listed in the card', () => {
  assert.match(card, /from\('audit_log'\)\.select\('id,action,occurred_at,details'\)\.in\('action',\[EMAIL_LOG_ACTION,EMAIL_STATUS_ACTION\]\)\.eq\('record_id',biz\.id\)/);
  assert.match(card, /EMAIL_LOG_ACTION='portal_access_email'/);
  assert.match(card, /EMAIL_STATUS_ACTION='portal_access_email_status'/);
});

test('no other new buttons; cache-busted', () => {
  assert.equal((card.match(/data-portal-email /g) || []).length, 1, 'one «שליחה במייל» button');
  assert.equal((card.match(/<button/g) || []).length, 17, 'existing 7 + email button + preview «אישור ושליחה»/«ביטול» + open-account choice «פתח ושלח»/«ביטול» + «סגירה» (preview error, result, view) + list «רענון מצב»/«צפייה במייל»');
  assert.match(biz, /js\/portal-business-card\.js\?v=20261008-5/);
});
