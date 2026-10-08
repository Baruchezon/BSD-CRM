// 08.10.2026 (בקשת ברוך): «איפה העסק מופץ» in the seller portal (all portals, one shared page).
// Three channels from fields staff already tick per deal in the CRM; Baruch's two texts verbatim;
// booleans only from the API; no new CRM buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const js = read('portal/portal.js');
const html = read('portal/index.html');
const css = read('portal/portal.css');
const handler = read('supabase/functions/seller-portal-api/handler.ts');

const FIRST = 'החשיפה הראשונה מתבצעת מול קונים פוטנציאליים הרשומים במאגר הקונים של החברה.';
const PRIVACY = 'בכל ערוצי הפרסום החומרים מוצגים תמיד באופן אנונימי. המידע המלא והאמיתי על העסק נמסר אך ורק למי שחתם על הסכם שמירת סודיות מול החברה, ורק לאחר בחינה מעמיקה של יכולותיו ושל רצונו האמיתי לרכוש את העסק.';

function renderer() {
  const start = js.indexOf('const DIST_CHANNELS=');
  const end = js.indexOf('async function load(){');
  assert.ok(start > 0 && end > start, 'renderer block found');
  const ctx = { esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
  vm.createContext(ctx);
  vm.runInContext(js.slice(start, end) + ';this.distributionHtml=distributionHtml;', ctx);
  return ctx.distributionHtml;
}

test('exact channel labels and Baruch\'s two texts', () => {
  for (const label of ['הופץ ללקוחות VIP', 'הופץ לכל סוכני BSD', 'הופץ במערכות המדיה של BSD']) assert.ok(js.includes(label), label);
  assert.ok(js.includes(FIRST) && js.includes(PRIVACY));
});

test('first-exposure line only once distribution started; privacy paragraph always, below the channels', () => {
  const render = renderer();
  const none = render({ channels: { vip: false, agents: false, media: false }, started: false });
  assert.ok(!none.includes(FIRST) && none.includes(PRIVACY));
  const some = render({ channels: { vip: false, agents: true, media: false }, started: true });
  assert.ok(some.includes(FIRST) && some.includes(PRIVACY));
  assert.ok(some.indexOf('dist-channels') < some.indexOf(FIRST) && some.indexOf(FIRST) < some.indexOf(PRIVACY), 'order: channels, first line, paragraph');
  assert.equal((some.match(/class="dist-channel on"/g) || []).length, 1);
  assert.equal((some.match(/class="dist-channel off"/g) || []).length, 2);
  for (const bad of [null, undefined, {}, { channels: null }, { channels: { vip: null, agents: 'true', media: 1 } }]) {
    const out = render(bad);
    assert.ok(!out.includes('✓') && !out.includes('dist-channel on'), 'uncertain -> never ✓');
    assert.equal((out.match(/טרם בוצע/g) || []).length, 3, 'uncertain -> all three «טרם בוצע»');
  }
  assert.ok(!render({ channels: { vip: 'yes', agents: 1, media: true }, started: true }).includes('dist-channel on"><span class="dist-mark" aria-hidden="true">✓</span><span class="dist-label">הופץ ללקוחות VIP'), 'only strict true ticks');
});

test('shared page for every portal: home + reports containers, no inline styles (CSP), cache-busted', () => {
  assert.ok(html.includes('id="homeDistribution"') && html.includes('id="reportsDistribution"'));
  assert.ok(!/style="/.test(html.slice(html.indexOf('id="dashboard"'))), 'no inline style attributes in the dashboard');
  assert.ok(!/style="/.test(js.slice(js.indexOf('const DIST_CHANNELS='), js.indexOf('async function load(){'))));
  assert.ok(html.includes('portal.js?v=20261008-1') && html.includes('portal.css?v=20261008-1'));
  assert.ok(/@media\(max-width:1050px\)\{\.dist-channels\{grid-template-columns:1fr/.test(css), 'tablet/phone: one channel per row');
});

test('API: three booleans from existing CRM fields, never blocks the dashboard', () => {
  assert.ok(handler.includes("from('vip_business_publications').select('business_id,enabled')"));
  assert.ok(handler.includes("distribution_status==='all_authorized'"));
  assert.ok(/public_listing_active===true&&b\.anon_card_active===true&&b\.listing_status==='active'&&b\.is_archived===false/.test(handler), 'media = live on the website (public_business_listings rule)');
  assert.ok(/try\{distribution=await ownerDistribution\(business\.id\);\}catch\{distribution=\{channels:\{vip:false,agents:false,media:false\},started:false\};\}/.test(handler));
  assert.ok(!/asking_price|profit|revenue/.test(handler.slice(handler.indexOf('const ownerDistribution'), handler.indexOf('const publicFiles'))));
});

test('no new buttons in the CRM', () => {
  assert.ok(!read('businesses.html').includes('איפה העסק מופץ'));
});

const NOT_STARTED = 'ההפצה עדיין לא התחילה. ברגע שתתחיל, הערוצים יסומנו כאן.';
test('uniform on every portal: same structure/wording/order for all 8 channel combinations; only ✓/state and the one data-driven line differ', () => {
  const render = renderer();
  const skeleton = html => html.replace(/class="dist-channel (on|off)"/g, 'class="dist-channel X"').replace(/aria-hidden="true">(✓)?</g, 'aria-hidden="true"><').replace(/>(בוצע|טרם בוצע)</g, '>STATE<').replace(/<p class="(dist-first|muted dist-note)">[^<]*<\/p>/, '<p LINE></p>');
  const outs = [];
  for (const vip of [false, true]) for (const agents of [false, true]) for (const media of [false, true]) {
    const out = render({ channels: { vip, agents, media }, started: vip || agents || media });
    const any = vip || agents || media;
    assert.equal(out.includes(FIRST), any); assert.equal(out.includes(NOT_STARTED), !any, 'not-started line exactly when all three are off');
    assert.equal((out.match(/<li /g) || []).length, 3); assert.ok(out.includes(PRIVACY));
    outs.push(skeleton(out));
  }
  assert.equal(new Set(outs).size, 1, 'identical skeleton');
  // position: same single place in the shared page (home after the update panel, reports tab after the reports list)
  assert.equal((html.match(/id="homeDistribution"/g) || []).length, 1);
  assert.ok(html.indexOf('id="updateTitle"') < html.indexOf('id="homeDistribution"') && html.indexOf('id="homeDistribution"') < html.indexOf('id="homeFiles"'));
  assert.ok(html.indexOf('id="reportList"') < html.indexOf('id="reportsDistribution"'));
  // no per-business branching in the renderer or the call site
  const block = js.slice(js.indexOf('const DIST_CHANNELS='), js.indexOf('async function load(){'));
  assert.ok(!/business_number|internal_name|\.id\b|username/.test(block));
  assert.ok(/const dist=distributionHtml\(data\.distribution\);\$\('homeDistribution'\)\.innerHTML=dist;\$\('reportsDistribution'\)\.innerHTML=dist;/.test(js));
});
