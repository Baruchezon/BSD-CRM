// 08.10.2026 (בקשת ברוך): ברשימת העסקים, מתחת לשם ולמספר העסק, שלוש תגיות כן/לא:
// מוצג לציבור / מוצג ל-VIP / מחובר לפורטל. תצוגה וקריאה בלבד - בלי כפתורים חדשים,
// בלי כתיבה לבסיס הנתונים ובלי שינוי הגדרות.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const biz = read('businesses.html');
const portalCard = read('js/portal-business-card.js');

function fnSrc(src, name){
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, name + ' missing');
  let i = src.indexOf('{', src.indexOf(')', start)), depth = 0;
  for (; i < src.length; i++){ if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}

function sandbox(profileRole, extra = {}){
  const ctx = {
    CURRENT_PROFILE: profileRole ? { id: 'u1', role: profileRole } : null,
    VIP_PUBLICATION_BY_BIZ: {}, VIP_STATUS_KNOWN: false,
    PORTAL_ACCOUNT_BY_BIZ: {}, PORTAL_STATUS_KNOWN: false,
    businessIndicatorGen: 1,
    esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])),
    console: { warn(){} },
    window: {},
    ...extra,
  };
  vm.createContext(ctx);
  for (const name of ['isShownOnPublicSite','isPortalConnected','bizFlag','businessFlagsRow','loadSellerPortalStatuses']){
    vm.runInContext(fnSrc(biz, name), ctx);
  }
  return ctx;
}
const flags = html => Object.fromEntries([...html.matchAll(/data-flag="(\w+)"[^>]*>[\s\S]*?<b>([^<]+)<\/b>/g)].map(m => [m[1], m[2]]));
const base = { id: 'b1', public_listing_active: true, anon_card_active: true, listing_status: 'active', is_archived: false, agreement_status: 'יש הסכם חתום' };

test('public = exactly the website view rule (public_business_listings)', () => {
  const c = sandbox('admin');
  assert.equal(c.isShownOnPublicSite(base), true);
  assert.equal(c.isShownOnPublicSite({ ...base, anon_card_active: false }), false, 'flag on but anon card off is NOT on the website');
  assert.equal(c.isShownOnPublicSite({ ...base, public_listing_active: false }), false);
  assert.equal(c.isShownOnPublicSite({ ...base, listing_status: 'sold' }), false);
  assert.equal(c.isShownOnPublicSite({ ...base, is_archived: true }), false);
  const view = fs.readdirSync(path.join(root, 'migrations')).map(f => read('migrations/' + f)).join('\n');
  assert.match(view, /public_listing_active\s*=\s*true[\s\S]{0,80}anon_card_active\s*=\s*true/i);
});

test('admin sees three כן/לא tags; VIP and portal show — until loaded (never a false "לא")', () => {
  const c = sandbox('admin');
  assert.deepEqual(flags(c.businessFlagsRow(base)), { public: 'כן', vip: '—', portal: '—' });
  c.VIP_STATUS_KNOWN = true; c.PORTAL_STATUS_KNOWN = true;
  assert.deepEqual(flags(c.businessFlagsRow(base)), { public: 'כן', vip: 'לא', portal: 'לא' });
  c.VIP_PUBLICATION_BY_BIZ.b1 = true; c.PORTAL_ACCOUNT_BY_BIZ.b1 = true;
  assert.deepEqual(flags(c.businessFlagsRow(base)), { public: 'כן', vip: 'כן', portal: 'כן' });
});

test('portal = active account AND the same login conditions the portal server checks', () => {
  const c = sandbox('manager', { PORTAL_ACCOUNT_BY_BIZ: { b1: true }, PORTAL_STATUS_KNOWN: true });
  assert.equal(c.isPortalConnected(base), true);
  assert.equal(c.isPortalConnected({ ...base, agreement_status: 'נשלח הסכם לחתימה' }), false);
  assert.equal(c.isPortalConnected({ ...base, is_archived: true }), false);
  assert.equal(c.isPortalConnected({ ...base, id: 'other' }), false);
});

test('agents see only the public tag (VIP/portal are manager data)', () => {
  const c = sandbox('agent', { VIP_STATUS_KNOWN: true, PORTAL_STATUS_KNOWN: true });
  assert.deepEqual(flags(c.businessFlagsRow(base)), { public: 'כן' });
});

test('portal loader is read-only: only admin_overview, active + issued password', async () => {
  const calls = [];
  const c = sandbox('admin', { window: { BSDSellerPortal: { api: async (action) => { calls.push(action); return { accounts: [
    { business_id: 'b1', status: 'active', pending: false },
    { business_id: 'b2', status: 'blocked', pending: false },
    { business_id: 'b3', status: 'active', pending: true },
    { business_id: 'b4', status: 'deleted', pending: false },
  ] }; } } } });
  await c.loadSellerPortalStatuses(1);
  assert.deepEqual(calls, ['admin_overview']);
  assert.deepEqual(Object.keys(c.PORTAL_ACCOUNT_BY_BIZ), ['b1']);
  assert.equal(c.PORTAL_STATUS_KNOWN, true);
  const agent = sandbox('agent', { window: { BSDSellerPortal: { api: async () => { throw new Error('must not be called'); } } } });
  await agent.loadSellerPortalStatuses(1);
  assert.equal(agent.PORTAL_STATUS_KNOWN, false);
});

test('no new buttons, name search stays, tags sit right under the name and number', () => {
  const row = fnSrc(biz, 'businessFlagsRow') + fnSrc(biz, 'bizFlag');
  assert.doesNotMatch(row, /<button|onclick|<input/);
  assert.match(biz, /<input type="text" id="fSearch"/);
  const cell = fnSrc(biz, 'businessIdentityCell');
  assert.ok(cell.indexOf('record-number-slot') < cell.indexOf('businessFlagsRow(b)'));
  assert.ok(cell.indexOf('businessFlagsRow(b)') < cell.indexOf('record-sub-line'));
  assert.doesNotMatch(cell, /publicListingBadge|vipPublicationBadge/, 'old duplicate badges replaced by the tags');
});

test('portal card only announces its state; nothing else changed in its actions', () => {
  assert.match(portalCard, /bsd:seller-portal-changed/);
  const actions = [...portalCard.matchAll(/api\('(admin_\w+)'/g)].map(m => m[1]).sort();
  assert.deepEqual([...new Set(actions)], ['admin_delete','admin_detail','admin_email_access','admin_open','admin_preview','admin_status'], 'only change since 08.10: «שליחה במייל» (admin_email_access)');
  assert.match(biz, /js\/portal-business-card\.js\?v=20261008-4/);
});
