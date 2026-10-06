// 06.10.2026 - כפתורי ה-AI בכרטיס העסק עובדים על מה שכתוב כרגע על המסך.
// התקציר האנונימי: בלי עיר, כתובת, רווחים, שמות, טלפונים והערות; מחיר רק אם "הצג מחיר".
// תיאור/הערות/תקציר פנימי: מסדרים ומתקנים בלי לקצר ובלי להשמיט פרטים.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
const fnSrc = name => {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name + ' missing');
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++){ if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
};
function makeEnv(values){
  const document = { getElementById: id => (id in values) ? (typeof values[id] === 'boolean' ? { checked: values[id], value: 'on' } : { value: values[id] }) : null };
  const src = ['bsdAiFormVal','bsdAiFormChecked','bsdCollectAnonAiForm','bsdCollectInternalAiForm'].map(fnSrc).join('\n');
  return new Function('document', src + '\nreturn { bsdCollectAnonAiForm, bsdCollectInternalAiForm };')(document);
}
const screen = {
  anon_summary: 'טקסט שכתבתי בתיבה', internal_business_summary: 'תקציר פנימי', short_description: 'תיאור עם עיר',
  field: 'משחקיות', category: 'פנאי', city: 'כפר קאסם', region: 'אזור המרכז', address: 'הרצל 12',
  internal_name: 'סטאר לנד', owner_name: 'יוסי', owner_phone: '0521234567', notes: 'ליד: דנה 050-1111111',
  annual_revenue: '1200000', operating_profit: '350000', net_profit: '280000', employees_count: '6', years_active: '2',
  asking_price: '900000', sale_reason: 'מעבר לחו"ל', anon_card_show_price: false, anon_card_show_reason: false,
};

test('anonymous AI input = screen values, never city/address/profit/names/notes', () => {
  const { bsdCollectAnonAiForm } = makeEnv(screen);
  const f = bsdCollectAnonAiForm();
  assert.equal(f.anon_text, 'טקסט שכתבתי בתיבה');
  assert.equal(f.internal_summary, 'תקציר פנימי');
  assert.equal(f.region, 'אזור המרכז');
  const json = JSON.stringify(f);
  for (const bad of ['כפר קאסם', 'הרצל', '350000', '280000', 'סטאר לנד', 'יוסי', '0521234567', 'ליד: דנה', '900000', 'מעבר לחו"ל']) {
    assert.ok(!json.includes(bad), 'must not send: ' + bad);
  }
  assert.equal(f.show_price, false);
});

test('anonymous AI input: asking price / sale reason only when ticked', () => {
  const { bsdCollectAnonAiForm } = makeEnv({ ...screen, anon_card_show_price: true, anon_card_show_reason: true });
  const f = bsdCollectAnonAiForm();
  assert.equal(f.asking_price, '900000');
  assert.equal(f.sale_reason, 'מעבר לחו"ל');
});

test('internal full summary input = screen values incl. the box itself', () => {
  const { bsdCollectInternalAiForm } = makeEnv(screen);
  const f = bsdCollectInternalAiForm();
  assert.equal(f.internal_business_summary, 'תקציר פנימי');
  assert.equal(f.short_description, 'תיאור עם עיר');
  assert.equal(f.notes, 'ליד: דנה 050-1111111');
  assert.equal(f.annual_revenue, '1200000');
});

test('buttons send the screen form to the edge functions (no new buttons)', () => {
  assert.match(html, /invokeAnonCardFn\(\{ business_id: bizId, form: bsdCollectAnonAiForm\(\) \}\)/);
  assert.match(html, /invokeBusinessSummaryFn\(\{ business_id: bizId, mode: 'internal_full', form: bsdCollectInternalAiForm\(\) \}\)/);
  assert.equal((html.match(/id="genAnonSummaryBtn"/g) || []).length, 1);
  // 06.10.2026 (אושר ע"י ברוך): «תקציר עסקי פנימי מלא» מוסתר - שתי תיבות בלבד, בלי כפתור נוסף.
  assert.equal((html.match(/id="genInternalSummaryBtn"/g) || []).length, 0);
  assert.ok(!html.includes('ה-AI כתב לפי הנתונים השמורים'));
});

test('edge functions: no shortening, room for long text, truncation is an error', () => {
  const read = n => fs.readFileSync(new URL(`../supabase/functions/${n}/index.ts`, import.meta.url), 'utf8');
  const improve = read('improve-business-text');
  assert.match(improve, /max_tokens: 8000/);
  assert.match(improve, /stop_reason === 'max_tokens'/);
  assert.match(improve, /אל תקצר/);
  assert.ok(!improve.includes('תמציתי'), 'description must not ask for a concise rewrite');
  const summary = read('generate-business-summary');
  assert.match(summary, /mode === 'short' \? 400 : 4000/);
  assert.match(summary, /stop_reason === 'max_tokens'/);
  assert.match(summary, /body\.form/);
  const anon = read('generate-anonymous-card') + fs.readFileSync(new URL('../supabase/functions/generate-anonymous-card/lib.ts', import.meta.url), 'utf8');
  assert.match(anon, /max_tokens: 3000/);
  assert.match(anon, /stop_reason === 'max_tokens'/);
  assert.match(anon, /רווחיות - אסור לחלוטין/);
  assert.match(anon, /generateSummary\(biz, body\.form\)/);
  assert.ok(!/factsAvailable\.push\(`רווח/.test(anon), 'profit must never be sent to the anonymous AI');
  assert.ok(!/עיר=\$\{biz\.city/.test(anon), 'city must never be sent to the anonymous AI');
});
