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
  assert.ok(h.includes('וואטסאפ') && h.includes('מייל') && h.includes('owner@example.com') && h.includes('info@bsd-bbi.co.il'));
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

test('an existing account loads its count and management actions without waiting for email history', async () => {
  const elements = new Map([
    '#sellerPortalEnabled', '[data-portal-opening]', '[data-portal-summary]',
    '[data-portal-error]', '[data-portal-controls]', '[data-portal-credentials]',
    '[data-portal-email-list]'
  ].map(selector => [selector, {
    querySelector: () => null,
    querySelectorAll: () => []
  }]));
  let click;
  const root = {
    querySelector: selector => elements.get(selector),
    addEventListener(event, callback) { if (event === 'click') click = callback; }
  };
  const signed = { id: 'business', agreement_status: 'יש הסכם חתום' };
  let detailAvailable = false;
  const actions = [];
  const ctx = {
    document: { getElementById: () => root },
    window: {
      BSD_CONFIG: { SELLER_PORTAL_API_URL: '/portal' },
      supabaseClient: {
        auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) },
        from: () => ({ select: () => ({ in: () => ({ eq: () => ({
          order: () => ({ limit: () => new Promise(() => {}) })
        }) }) }) })
      }
    },
    async fetch(_url, request) {
      actions.push(JSON.parse(request.body).action);
      return detailAvailable
        ? { ok: true, json: async () => ({
          business: signed,
          account: { username: '12345', status: 'active', pending: false, login_count: 6 }
        }) }
        : { ok: false, json: async () => ({ error: 'unavailable' }) };
    }
  };
  vm.runInNewContext(card, ctx);
  const mounted = ctx.window.BSDSellerPortal.mount({ id: signed.id, agreement_status: 'אין הסכם' });
  assert.equal(elements.get('#sellerPortalEnabled').disabled, true);
  await mounted;
  const controls = elements.get('[data-portal-controls]');
  assert.match(controls.innerHTML, /data-portal-retry/);
  detailAvailable = true;
  const retry = { hasAttribute: name => name === 'data-portal-retry' };
  await click({ target: { closest: selector => selector === '[data-portal-controls] button' ? retry : null } });
  assert.equal(elements.get('[data-portal-opening]').hidden, true);
  assert.match(elements.get('[data-portal-summary]').textContent, /מספר כניסות: 6/);
  assert.match(controls.innerHTML, /data-portal-preview/);
  assert.match(controls.innerHTML, /data-portal-block/);
  assert.match(controls.innerHTML, /data-portal-open\s*>/);
  assert.deepEqual(actions, ['admin_detail', 'admin_detail']);
});
