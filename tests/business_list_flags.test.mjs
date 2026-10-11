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
  assert.deepEqual([...new Set(actions)], ['admin_delete','admin_detail','admin_email_access','admin_email_preview','admin_email_status','admin_open','admin_preview','admin_status'], 'only changes since 08.10: «שליחה במייל» (admin_email_access) + its preview and delivery status');
  assert.match(biz, new RegExp('js/portal-business-card\\.js\\?v=' + JSON.parse(read('version.json')).version));
});

function loadPortal(){
  const ctx = { window: {}, console, document: {}, location: { assign(){} } };
  vm.createContext(ctx);
  vm.runInContext(portalCard, ctx);
  return ctx.window.BSDSellerPortal;
}

test('connected portal tag reuses view-as-owner; לא / — / other roles stay plain', () => {
  const P = loadPortal();
  assert.equal(P.canPreviewAsOwner({ role: 'admin' }), true);
  assert.equal(P.canPreviewAsOwner({ role: 'manager' }), true);
  assert.equal(P.canPreviewAsOwner({ role: 'agent' }), false);
  assert.equal(P.canPreviewAsOwner(null), false);
  const yes = sandbox('admin', { PORTAL_ACCOUNT_BY_BIZ: { b1: true }, PORTAL_STATUS_KNOWN: true, window: { BSDSellerPortal: P } });
  const html = yes.businessFlagsRow(base);
  assert.match(html, /data-flag="portal"[^>]*title="צפייה בפורטל כבעל העסק"[^>]*data-portal-list-preview="b1"/);
  assert.match(html, /is-portal-preview/);
  assert.match(html, /class="biz-flag-long">מחובר לפורטל<\/span><span class="biz-flag-short">פורטל<\/span>/);
  assert.doesNotMatch(html, /<button|onclick/);
  const no = sandbox('manager', { PORTAL_STATUS_KNOWN: true, window: { BSDSellerPortal: P } });
  assert.match(no.businessFlagsRow(base), /data-flag="portal"/);
  assert.doesNotMatch(no.businessFlagsRow(base), /data-portal-list-preview|is-portal-preview|צפייה בפורטל כבעל העסק/);
  const unknown = sandbox('admin', { window: { BSDSellerPortal: P } });
  assert.doesNotMatch(unknown.businessFlagsRow(base), /data-portal-list-preview/);
  const agent = sandbox('agent', { PORTAL_ACCOUNT_BY_BIZ: { b1: true }, PORTAL_STATUS_KNOWN: true, window: { BSDSellerPortal: P } });
  assert.doesNotMatch(agent.businessFlagsRow(base), /data-flag="portal"|data-portal-list-preview/);
  assert.equal((portalCard.match(/#preview=/g) || []).length, 1, 'preview URL is built in openAsOwner only');
  assert.match(portalCard, /data-portal-preview'\)\)\{run\(\(\)=>openAsOwner\(biz\.id\)\);\}/);
  assert.match(biz, /document\.addEventListener\('click', onPortalListPreviewClick, true\)/);
  assert.match(biz, /\.biz-flag\.is-portal-preview\{cursor:pointer/);
});

test('list click calls openAsOwner and does not open the business card', async () => {
  const P = loadPortal();
  const calls = [];
  const ctx = {
    CURRENT_PROFILE: { role: 'admin' },
    window: { BSDSellerPortal: P },
    toast(m){ calls.push(['toast', m]); },
    console,
  };
  // The click handler must call the real exported function, not a copy.
  ctx.window.BSDSellerPortal = { canPreviewAsOwner: P.canPreviewAsOwner, openAsOwner(id){ calls.push(['open', id]); return Promise.resolve(); } };
  vm.createContext(ctx);
  vm.runInContext(fnSrc(biz, 'onPortalListPreviewClick'), ctx);
  const flag = {
    busy: null,
    getAttribute(n){ return n === 'data-portal-list-preview' ? 'b1' : this.busy; },
    setAttribute(n, v){ if (n === 'data-portal-preview-busy') this.busy = v; },
    removeAttribute(n){ if (n === 'data-portal-preview-busy') this.busy = null; },
  };
  const stopped = [];
  ctx.onPortalListPreviewClick({
    target: { closest(sel){ return sel === '[data-portal-list-preview]' ? flag : null; } },
    preventDefault(){ stopped.push('prevent'); },
    stopPropagation(){ stopped.push('stop'); },
  });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(stopped, ['prevent', 'stop']);
  assert.deepEqual(calls, [['open', 'b1']]);
  calls.length = 0; stopped.length = 0;
  ctx.CURRENT_PROFILE = { role: 'agent' };
  ctx.onPortalListPreviewClick({
    target: { closest(sel){ return sel === '[data-portal-list-preview]' ? flag : null; } },
    preventDefault(){ stopped.push('prevent'); },
    stopPropagation(){ stopped.push('stop'); },
  });
  assert.deepEqual(stopped, ['prevent', 'stop'], 'still does not open the card');
  assert.deepEqual(calls, [], 'agent is not allowed to impersonate');
  stopped.length = 0;
  ctx.CURRENT_PROFILE = { role: 'admin' };
  ctx.onPortalListPreviewClick({ target: { closest(){ return null; } }, preventDefault(){ stopped.push('prevent'); }, stopPropagation(){ stopped.push('stop'); } });
  assert.deepEqual(stopped, [], 'a plain tag click still reaches the row');
});

test('openAsOwner is admin_preview into #preview and closes the tab on failure', async () => {
  const opened = [];
  const assigned = [];
  const closed = [];
  let response = { ok: true, json: async () => ({ token: 'PREVIEWTOK', portal_url: 'https://site.example/portal/#old' }) };
  const tab = { location: { replace(u){ opened.push(u); } }, close(){ closed.push(1); } };
  const ctx = {
    window: {
      open(){ return tab; },
      BSD_CONFIG: { SELLER_PORTAL_API_URL: 'https://portal.example/api' },
      supabaseClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
    },
    fetch: async (_url, opts) => { ctx.lastBody = opts.body; return response; },
    location: { assign(u){ assigned.push(u); } },
    document: {},
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(portalCard, ctx);
  await ctx.window.BSDSellerPortal.openAsOwner('biz-9');
  assert.equal(ctx.lastBody, JSON.stringify({ action: 'admin_preview', business_id: 'biz-9' }));
  assert.deepEqual(opened, ['https://site.example/portal/#preview=PREVIEWTOK']);
  assert.deepEqual(assigned, []);
  ctx.window.open = () => null;
  opened.length = 0;
  await ctx.window.BSDSellerPortal.openAsOwner('biz-9');
  assert.deepEqual(assigned, ['https://site.example/portal/#preview=PREVIEWTOK']);
  response = { ok: false, json: async () => ({ error: 'preview_unavailable' }) };
  ctx.window.open = () => tab;
  await assert.rejects(() => ctx.window.BSDSellerPortal.openAsOwner('biz-9'), /החשבון אינו פתוח לצפייה/);
  assert.equal(closed.length, 1);
});
