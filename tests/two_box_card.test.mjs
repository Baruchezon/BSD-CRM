// 06.10.2026 (אושר ע"י ברוך 15:22) - כרטיס עסק עם שתי תיבות טקסט בלבד:
// «📋 כל המידע על העסק (פנימי)» (short_description) ו«⭐ התקציר האנונימי» (anon_summary).
// הערות / תקציר פנימי / שם אנונימי כפול / PDF מהתקציר הקצר - מוסתרים, לא נמחקים.
// בלי כפתורים חדשים. + התאמות AI לסוכן: רק שדות אנונימיים ורק עסקים ששוחררו אליו.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { scopeBusinessesForAgent, decorateForClient } from '../supabase/functions/match-suggestions-report/engine.js';

const html = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
const lib = fs.readFileSync(new URL('../supabase/functions/generate-anonymous-card/lib.ts', import.meta.url), 'utf8');
const improve = fs.readFileSync(new URL('../supabase/functions/improve-business-text/index.ts', import.meta.url), 'utf8');
const fnSrc = name => {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name + ' missing');
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++){ if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
};
const hiddenWrapper = id => {
  const i = html.indexOf(`id="${id}"`);
  assert.ok(i > 0, id);
  const open = html.lastIndexOf('<div', i);
  return html.slice(open, html.indexOf('>', open) + 1);
};

test('card markup: only two visible free-text boxes, the rest hidden (not deleted)', () => {
  assert.match(html, /📋 כל המידע על העסק \(פנימי\)/);
  assert.equal((html.match(/<textarea id="short_description"/g) || []).length, 1);
  assert.equal((html.match(/<textarea id="anon_summary"/g) || []).length, 1);
  // notes + internal summary still in the form (save payload untouched), inside display:none wrappers
  assert.match(html, /<div id="bizLegacyNotesHidden" style="display:none;">[\s\S]{0,300}<textarea id="notes" readonly/);
  assert.match(html, /<div id="bizLegacyInternalSummaryHidden" style="display:none;">[\s\S]{0,300}<textarea id="internal_business_summary" readonly/);
  assert.match(hiddenWrapper('bizAnonNameLegacyField'), /display:none/);
  assert.match(html, /<div style="display:none;margin-top:8px;"><!-- 06\.10\.2026[^]*?הפק PDF מהתקציר הקצר הזה/);
  // the notes section header (its own tab) is gone
  assert.ok(!/<span>הערות<\/span>/.test(html));
});

test('no new buttons: one AI button on the full box, recording button moved (not added)', () => {
  assert.equal((html.match(/onclick="improveFieldWithAI\('short_description'\)"/g) || []).length, 1);
  assert.equal((html.match(/onclick="improveFieldWithAI\('notes'\)"/g) || []).length, 0);
  assert.equal((html.match(/onclick="openNotesRecording\(/g) || []).length, 1);
  assert.match(html, /textareaId:'short_description', currentProfile:CURRENT_PROFILE\}\)">🎙️ הקלט הערות/);
  assert.equal((html.match(/id="genAnonSummaryBtn"/g) || []).length, 1);
  assert.equal((html.match(/id="saveAnonSummaryBtn"/g) || []).length, 1);
  assert.equal((html.match(/id="genInternalSummaryBtn"/g) || []).length, 0);
});

test('old text is shown read-only (folded) and merged by the AI button', () => {
  const env = new Function('bsdNormText', 'esc', fnSrc('bsdOldTextsFoldHtml') + '; return bsdOldTextsFoldHtml;');
  const norm = v => (v == null ? '' : String(v));
  const fold = env(norm, x => String(x))({ notes: 'הערה ישנה 050-1234567', internal_business_summary: 'תקציר ישן' });
  assert.match(fold, /<details id="bizOldTextsFold"/);
  assert.match(fold, /הערה ישנה 050-1234567/);
  assert.match(fold, /תקציר ישן/);
  assert.ok(!/<button/.test(fold));
  assert.equal(env(norm, String)({ notes: '', internal_business_summary: null }), '');

  const els = { notes: { value: 'הערה ישנה' }, internal_business_summary: { value: 'כבר בתיבה' } };
  const collect = new Function('document', 'bsdNormText', fnSrc('bsdCollectOldTextsForMerge') + '; return bsdCollectOldTextsForMerge;')({ getElementById: id => els[id] || null }, norm);
  const extras = collect('טקסט בתיבה. כבר בתיבה.');
  assert.deepEqual(JSON.parse(JSON.stringify(extras)), [{ label: 'הערות (שדה ישן)', text: 'הערה ישנה' }]);
  assert.match(fnSrc('runAiImprove'), /bsdCollectOldTextsForMerge\(sourceText\)/);
  assert.match(fnSrc('runAiImprove'), /invokeImproveTextFn\([^)]*extras\)/);
  assert.match(fnSrc('invokeImproveTextFn'), /body\.extra_texts = extraTexts/);
});

test('improve edge function: optional extra_texts (backward compatible), ~8000 tokens, truncation is an error', () => {
  assert.match(improve, /normalizeExtraTexts\(body\.extra_texts\)/);
  assert.match(improve, /if \(!sourceText && !extras\.length\)/);
  assert.match(improve, /max_tokens: 8000/);
  assert.match(improve, /stop_reason === 'max_tokens'/);
  assert.match(improve, /אחד את כולם לטקסט אחד מלא/);
});

const regionMap = src => JSON.parse(src.match(/\/\*REGION_MAP_START\*\/([\s\S]*?)\/\*REGION_MAP_END\*\//)[1]);
test('region map in the page is identical to the edge function', () => {
  assert.deepEqual(regionMap(html), regionMap(lib));
  assert.ok(Object.keys(regionMap(lib)).includes('אזור המרכז'));
});

function ruleEnv(){
  const start = html.indexOf('// אזור רחב לפי עיר - העתק זהה');
  const end = html.indexOf('function bsdFindCachedBiz(bizId){');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(html.slice(start, end) + ';this.api={bsdAnonRuleScan,bsdDeriveRegionFromCity,bsdEffectiveRegion};', ctx);
  return ctx.api;
}
test('manual anonymous save: same city / address / profit rules as the server confirm', () => {
  const { bsdAnonRuleScan, bsdDeriveRegionFromCity } = ruleEnv();
  assert.equal(bsdDeriveRegionFromCity('ראשון לציון'), 'אזור המרכז');
  assert.equal(bsdDeriveRegionFromCity('הרצליה גליל ים'), 'אזור השרון');
  assert.equal(bsdDeriveRegionFromCity('קרית אונו'), 'אזור המרכז');
  assert.equal(bsdDeriveRegionFromCity('באר שבע'), 'אזור הדרום');
  assert.equal(bsdDeriveRegionFromCity('עיר לא ידועה'), '');
  const scan = (t, city, region = '') => bsdAnonRuleScan([['תקציר אנונימי', t]], city, region);
  assert.equal(scan('עסק פעיל באזור המרכז, מחזור 2 מיליון ₪', 'ראשון לציון').length, 0);
  assert.ok(scan('עסק באזור ראשון לציון', 'ראשון לציון').some(h => h.includes('העיר')));
  assert.ok(scan('עסק פעיל ורווחי', 'ראשון לציון').some(h => h.includes('רווח')));
  assert.ok(scan('רווח נקי 25,000 ₪', '').length > 0);
  assert.equal(scan('מרווח חניה גדול', '').length, 0);
  assert.ok(scan('ממוקם ברחוב הרצל 12', '').some(h => h.includes('כתובת')));
  assert.equal(scan('עסק באזור ירושלים', 'ירושלים').length, 0); // the allowed region contains the city name
});

test('general save checks the new rules only when the anonymous text was edited', () => {
  const save = fnSrc('saveBiz');
  assert.match(save, /const anonEdited = /);
  assert.match(save, /if \(anonEdited\) bsdAnonRuleScan\(/);
  assert.match(fnSrc('bsdSaveAnonSummaryOnly'), /bsdAnonRuleScan\(/);
});

test('smart matches for agents: only released businesses, anonymous fields only', () => {
  const biz = [
    { id: 'a', internal_name: 'שם אמיתי', anon_display_name: 'משחקייה אינדור', field: 'פנאי', city: 'יבנה', website: 'x.co.il', address: 'הרצל 1',
      net_profit: 300000, operating_profit: 350000, annual_revenue: 1200000, asking_price: 900000, anon_card_show_price: false, owner_phone: '050', anon_summary: 'תקציר' },
    { id: 'b', internal_name: 'עסק שלי', field: 'מזון', city: 'חולון', net_profit: 1, website: 'y', owner_phone: '052', anon_summary: null },
    { id: 'c', internal_name: 'לא שוחרר', field: 'מזון', anon_summary: 'יש' },
    { id: 'd', internal_name: 'בלי תקציר', field: 'מזון', anon_summary: '' },
    { id: 'e', internal_name: 'מחיר מוצג', anon_display_name: '', field: 'קמעונאות', asking_price: 500000, anon_card_show_price: true, anon_summary: 'יש' },
  ];
  const scoped = scopeBusinessesForAgent(biz, { a: 'anonymous', b: 'full', c: 'none', d: 'anonymous', e: 'anonymous' });
  assert.deepEqual(scoped.map(x => x.id), ['a', 'b', 'e']);
  const a = scoped.find(x => x.id === 'a');
  assert.equal(a.internal_name, null); assert.equal(a.website, null); assert.equal(a.address, null);
  assert.equal(a.net_profit, null); assert.equal(a.operating_profit, null); assert.equal(a.asking_price, null);
  assert.equal(a.city, 'יבנה'); assert.equal(a.annual_revenue, 1200000);
  assert.equal(a.short_description, null); assert.equal(a.notes, null); assert.equal(a.internal_business_summary, null);
  assert.equal(scoped.find(x => x.id === 'e').anon_display_name, 'עסק בתחום קמעונאות');
  assert.equal(scoped.find(x => x.id === 'e').asking_price, 500000);
  assert.equal(scoped.find(x => x.id === 'b').internal_name, 'עסק שלי'); // full access = as before
  assert.equal(scoped.find(x => x.id === 'b').owner_phone, null);
  const out = decorateForClient([{ buyer_id: 'q', business_id: 'a', score: 70, tier: 'good', summary: '' }], { buyers: [{ id: 'q', full_name: 'קונה' }], businesses: scoped, fullAccess: false });
  assert.equal(out[0].business, 'משחקייה אינדור');
  assert.equal(out[0].business_info.website, '');
  assert.equal(out[0].business_info.net_profit, null);
  assert.ok(!JSON.stringify(out).includes('שם אמיתי'));
});
