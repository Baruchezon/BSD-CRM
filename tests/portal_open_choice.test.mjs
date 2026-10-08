// 08.10.2026 (בקשת ברוך): «פתח חשבון בפורטל» first shows a choice — «וואטסאפ» (checked) / «מייל», one or
// both — then «פתח ושלח» / «ביטול». Same shared code for every business card and for a new business.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const card = read('js/portal-business-card.js');
const invite = read('js/portal-invite.js');
function load() { const ctx = { window: {}, console }; vm.createContext(ctx); vm.runInContext(invite, ctx); vm.runInContext(card, ctx); return ctx.window; }
const W = load(), P = W.BSDSellerPortal;

test('choice: WhatsApp checked by default, email checkbox with destination and sender, confirm + cancel', () => {
  const h = P.channelChoiceHtml({ internal_name: 'עסק <b>א</b>', owner_email: ' owner@example.com ' });
  assert.match(h, /<input type="checkbox" data-ch-wa checked/);
  assert.match(h, /<input type="checkbox" data-ch-mail {2}style/);
  assert.ok(h.includes('וואטסאפ') && h.includes('מייל') && h.includes('owner@example.com') && h.includes('baruch@bsd-bbi.co.il'));
  assert.ok(h.includes('עסק &lt;b&gt;א&lt;/b&gt;'));
  assert.match(h, /data-ch-ok[^>]*>פתח ושלח<\/button>/);
  assert.match(h, /data-ch-cancel[^>]*>ביטול<\/button>/);
});

test('no email on file: email checkbox shown but disabled, with a clear Hebrew note', () => {
  for (const bad of [null, '', 'no-at-sign', 'x@y']) {
    const h = P.channelChoiceHtml({ internal_name: 'עסק', owner_email: bad });
    assert.match(h, /data-ch-mail disabled/);
    assert.ok(h.includes('אין מייל בכרטיס'), String(bad));
  }
});

test('flow: every open-account path (card checkbox + new business) goes through the choice; WhatsApp-only = previous flow', () => {
  assert.match(card, /if\(on&&\(!exists\(\)\|\|account\.pending\)\)\{checkbox\.checked=false;const pick=await chooseChannels\(biz,\{reserve:true\}\);if\(!pick\)\{draw\(\);return;\}\n   if\(pick\.mail\)\{const ok=await previewAndConfirm\(biz\.id,biz,\{reserve:pick\.wa\}\);if\(!ok\)\{draw\(\);return;\}pick\.tab=ok\.tab;\}/, 'email chosen: the full email is shown and approved before anything is opened or sent');
  assert.match(card, /const openWith=async\(\{wa,mail,tab\}\)=>\{\n  if\(!mail\)return open\(tab\);/);
  assert.match(card, /const pick=await chooseChannels\(info\);if\(!pick\)return;\n if\(pick\.mail&&!await previewAndConfirm\(id,info\)\)return;\n const d=await api\('admin_open',\{business_id:id\}\);/);
  // Email uses the existing server action only; the browser never builds the email.
  // Every send (button, card checkbox, new business) goes through sendAndReport (one admin_email_access call).
  assert.equal((card.match(/api\('admin_email_access',/g) || []).length, 1);
  assert.equal((card.match(/sendAndReport\((biz\.id|id),/g) || []).length, 3);
  assert.ok(!/resend\.com/i.test(card));
  // The reset button keeps its old behaviour.
  assert.match(card, /'יצירת סיסמה ושליחה ב-WhatsApp':'איפוס סיסמה ושליחה ב-WhatsApp'/);
});

test('WhatsApp text when the password went by email: same template, no password inside', () => {
  const d = { username: '23456', password: 'SECRET-PW', name: 'בעלים', phone: '050-0000000', site: 'www.bsd-bbi.co.il' };
  const m = W.BSDPortalInvite.message(P.mailNoticeData(d, 'owner@example.com'));
  assert.ok(m.includes('שם משתמש: 23456') && m.includes('סיסמה: נשלחה אליך במייל (owner@example.com)') && !m.includes('SECRET-PW'));
});
