// 08.10.2026 (בקשת ברוך): «🔎 חקר מקדים» של דנה מוצג תמיד בראש כרטיס הקונה וכרטיס העסק -
// תצוגה בלבד (בלי כפתורים, בלי שדות), מאותה שורה (leads.pre_research / businesses.pre_research).
// קבצי «חקר שוק» של העסק: רק לפי business_id + document_type='market_research', שמות בלבד, מנהל/אדמין.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const leads = read('leads.html');
const biz = read('businesses.html');
function fnSrc(src, name){
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, name + ' missing');
  let i = src.indexOf('{', src.indexOf(')', start)), depth = 0;
  for (; i < src.length; i++){ if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
function load(src, names, extra = {}){
  const c = { esc, ...extra }; vm.createContext(c);
  for (const n of names) vm.runInContext(fnSrc(src, n), c);
  return c;
}

test('buyer card: research view at the top (before «מטפל כרגע» / «פרטים כלליים»), read-only, escaped, empty state', () => {
  const form = fnSrc(leads, 'openLeadForm');
  const at = form.indexOf("${lead ? leadPreResearchViewHtml(lead) : ''}");
  assert.ok(at > 0 && at < form.indexOf('id="handled_by"') && at < form.indexOf('פרטים כלליים'));
  assert.ok(at < form.indexOf('id="pre_research"'), 'shown above the existing edit box');
  const c = load(leads, ['preResearchViewBody', 'leadPreResearchViewHtml']);
  const html = c.leadPreResearchViewHtml({ pre_research: 'הערת דנה המזכירה (06.10.2026)\n<b>x</b> & "y"' });
  assert.match(html, /🔎 חקר מקדים/);
  assert.match(html, /הערת דנה המזכירה \(06\.10\.2026\)\n&lt;b&gt;x&lt;\/b&gt; &amp; &quot;y&quot;/);
  assert.ok(!/<(button|textarea|input|select|a)\b/.test(html), 'no buttons or fields');
  assert.match(html, /white-space:pre-wrap/); assert.match(html, /overflow-wrap:anywhere/); assert.match(html, /max-height:42vh;overflow-y:auto/);
  assert.match(c.leadPreResearchViewHtml({ pre_research: '   ' }), /עדיין אין חקר מקדים בכרטיס הזה/);
  assert.match(c.leadPreResearchViewHtml({}), /עדיין אין חקר מקדים בכרטיס הזה/);
});

test('buyer card: view follows the edit box (typing / server reload), never writes anything', () => {
  const c = load(leads, ['preResearchViewBody', 'syncLeadPreResearchView'], {
    document: { getElementById: id => ({ pre_research: { value: 'חדש <i>' }, leadPreResearchViewText: view }[id]) } });
  var view = { innerHTML: '' }; c.document = { getElementById: id => ({ pre_research: { value: 'חדש <i>' }, leadPreResearchViewText: view }[id]) };
  c.syncLeadPreResearchView();
  assert.equal(view.innerHTML, 'חדש &lt;i&gt;');
  assert.match(fnSrc(leads, 'openLeadForm') + leads, /preResearchBox\.addEventListener\('input', syncLeadPreResearchView\)/);
  assert.match(fnSrc(leads, 'saveLead'), /typeof syncLeadPreResearchView === 'function'/);
  assert.ok(!/supabaseClient/.test(fnSrc(leads, 'leadPreResearchViewHtml') + fnSrc(leads, 'syncLeadPreResearchView')));
});

test('business card: research view at the top of «פרטי עסק» (under זיהוי, before the name), read-only, escaped', () => {
  const form = fnSrc(biz, 'openBizForm');
  const at = form.indexOf("${biz ? bsdPreResearchViewHtml(biz) : ''}");
  assert.ok(at > form.indexOf('<div class="section-h">זיהוי</div>') && at < form.indexOf("fieldRow('internal_name'"));
  assert.ok(at < form.indexOf('bsdPreResearchFoldHtml(biz)'));
  const admin = load(biz, ['bsdPreResearchViewBody', 'bsdPreResearchViewHtml'], { CURRENT_PROFILE: { role: 'admin' } });
  const html = admin.bsdPreResearchViewHtml({ pre_research: 'מאומת <script>' });
  assert.match(html, /מאומת &lt;script&gt;/);
  assert.ok(!/<(button|textarea|input|select|a)\b/.test(html));
  assert.match(html, /id="bizResearchFiles"/);
  assert.match(admin.bsdPreResearchViewHtml({ pre_research: null }), /עדיין אין חקר מקדים בכרטיס הזה/);
  for (const role of ['agent', 'viewer', undefined]){
    const c = load(biz, ['bsdPreResearchViewBody', 'bsdPreResearchViewHtml'], { CURRENT_PROFILE: role ? { role } : null });
    assert.ok(!/bizResearchFiles/.test(c.bsdPreResearchViewHtml({ pre_research: 'x' })), 'file names: admin/manager only (' + role + ')');
  }
  const mgr = load(biz, ['bsdPreResearchViewBody', 'bsdPreResearchViewHtml'], { CURRENT_PROFILE: { role: 'manager' } });
  assert.match(mgr.bsdPreResearchViewHtml({}), /bizResearchFiles/);
});

test('business card: research files only by explicit business_id + market_research, active, names only, stale card ignored', async () => {
  const calls = [];
  const rows = [{ file_name: 'BSD-B-1 חקר שוק <x>.pdf', created_at: '2026-10-07' }, { file_name: null }];
  const q = { select(v){ calls.push(['select', v]); return q; }, eq(k, v){ calls.push(['eq', k, v]); return q; }, is(k, v){ calls.push(['is', k, v]); return q; },
    order(){ return Promise.resolve({ data: rows, error: null }); } };
  const el = { innerHTML: '' }; let formId = 'b1';
  const c = load(biz, ['bsdLoadResearchFiles'], { window: { supabaseClient: { from(t){ calls.push(['from', t]); return q; } } },
    document: { getElementById: id => id === 'bizResearchFiles' ? el : id === 'bizForm' ? { dataset: { bizId: formId } } : null } });
  await c.bsdLoadResearchFiles('b1');
  assert.deepEqual(calls.slice(0, 2), [['from', 'business_sale_files'], ['select', 'file_name, created_at']]);
  assert.deepEqual(calls.filter(x => x[0] !== 'from' && x[0] !== 'select'),
    [['eq', 'business_id', 'b1'], ['eq', 'document_type', 'market_research'], ['eq', 'status', 'active'], ['is', 'deleted_at', null]]);
  assert.match(el.innerHTML, /<b>BSD-B-1 חקר שוק &lt;x&gt;\.pdf<\/b> · <b>קובץ<\/b>/);
  assert.ok(!/storage_path|href|<a\b|<button/.test(el.innerHTML));
  el.innerHTML = ''; formId = 'other'; await c.bsdLoadResearchFiles('b1'); assert.equal(el.innerHTML, '', 'another card opened meanwhile');
  const c2 = load(biz, ['bsdLoadResearchFiles'], { window: { supabaseClient: { from(){ throw new Error('x'); } } }, document: { getElementById: () => el } });
  await c2.bsdLoadResearchFiles('b1'); // never throws
  assert.match(fnSrc(biz, 'openBizForm'), /if \(biz\) bsdLoadResearchFiles\(biz\.id\);/);
});

test('business card: view follows the edit box (typing, server refresh, restored draft)', () => {
  assert.match(fnSrc(biz, 'bsdInitPreResearchBox'), /box\.addEventListener\('input', bsdSyncPreResearchView\)/);
  assert.match(fnSrc(biz, 'bsdRevalidateOpenBizForm'), /typeof bsdSyncPreResearchView === 'function'/);
  const view = { innerHTML: '' };
  const c = load(biz, ['bsdPreResearchViewBody', 'bsdSyncPreResearchView'], { document: { getElementById: id => ({ pre_research: { value: '' }, bizPreResearchViewText: view }[id]) } });
  c.bsdSyncPreResearchView(); assert.match(view.innerHTML, /עדיין אין חקר מקדים/);
});

test('privacy: research view never reaches anonymous / AI / PDF / send code', () => {
  for (const name of ['bsdCollectAnonAiForm', 'bsdCollectInternalAiForm', 'bsdCollectOldTextsForMerge', 'computeAnonSourceFingerprint', 'generateAndSaveSummaryPdf'])
    assert.ok(!/PreResearchView|bsdLoadResearchFiles/.test(fnSrc(biz, name)), name);
  for (const f of ['listings.html', 'portal/portal.js', 'js/anonSummarySend.js', 'js/pdfPipeline.js', 'js/portal-business-card.js', 'matches-workspace.html', 'js/bsd-search.js'])
    assert.ok(!/PreResearchView|bsdLoadResearchFiles|pre_research/.test(read(f)), f);
});
