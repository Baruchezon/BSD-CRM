// «התאמות AI חכמות» (05.10.2026): בדיקות למנוע (engine.js) ולחיבור לדף.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSuggestions, decorateForClient, budgetFromText, fem, MIN_SCORE } from '../supabase/functions/match-suggestions-report/engine.js';

const biz = (o) => ({ id: o.id, business_number: 'BSD-B-' + o.id, internal_name: o.name, field: o.field || '', category: '', city: o.city || '', region: '', asking_price: o.price ?? null, short_description: o.desc || '', anon_summary: '', notes: '', owner_phone: '050-1111111', website: o.website || '' });
const buyer = (o) => ({ id: o.id, client_number: 'BSD-C-' + o.id, full_name: o.name, phone: '052-2222222', email: 'x@example.com', city: o.city || '', requested_field: o.field || '', requested_categories: '', requested_area: o.area || '', budget: o.budget ?? null, notes: o.notes || '' });
const run = (buyers, businesses, extra = {}) => buildSuggestions({ buyers, businesses, matches: [], distributions: [], notes: [], ...extra });
const find = (r, b, z) => r.suggestions.find(s => s.buyer_id === b && s.business_id === z);

test('exact field + budget from notes + same city = high match with plain-Hebrew explanation', () => {
  const r = run([buyer({ id: 'b1', name: 'אשר חן', city: 'ראשון לציון', field: 'מסעדה', notes: 'מחפש מסעדה. תקציב בין 500-700 אלף שקל ומעוניין להיות פעיל' })],
                [biz({ id: 'z1', name: 'שווארמה הדר', field: 'מסעדה', city: 'ראשון לציון', price: 600000 })]);
  const s = find(r, 'b1', 'z1');
  assert.ok(s, 'suggested');
  assert.ok(s.score >= 75, 'high score ' + s.score);
  assert.equal(s.tier, 'high');
  assert.match(s.summary, /^התאמה גבוהה/);
  assert.ok(s.why.some(w => /בתוך התקציב/.test(w)));
  assert.ok(s.why.some(w => /בדיוק העיר/.test(w)));
  assert.ok(s.how.find(h => h.label === 'התאמת תחום').pts === 45);
  for (const t of [s.summary, ...s.why, ...s.caveats, ...s.how.map(h => h.text)]) assert.doesNotMatch(t, /score|tier|keyword|token|null|undefined|NaN/i, t);
});

test('budget parsing from free text', () => {
  assert.deepEqual([budgetFromText('תקציב בין 500-700 אלף').lo, budgetFromText('תקציב בין 500-700 אלף').hi], [500000, 700000]);
  assert.equal(budgetFromText('מחפש השקעה עד 1 מיליון ש"ח').hi, 1000000);
  assert.equal(budgetFromText('תקציב ההשקעה שלי הוא כ 100,000 עד 150,000').hi, 150000);
  assert.equal(budgetFromText('מכר את הרשת ב30 מיליון'), null);
  assert.equal(budgetFromText('מחזור 5 מיליון'), null);
});

test('only NEW pairs are suggested; an existing match is reported separately as already presented', () => {
  const buyers = [buyer({ id: 'b1', name: 'דן', city: 'ירושלים', field: 'מאפיה' })];
  const businesses = [biz({ id: 'z1', name: 'מאפיית שריינר', field: 'מאפיה', city: 'ירושלים' })];
  const r = run(buyers, businesses, { matches: [{ id: 'm1', buyer_id: 'b1', business_id: 'z1', status: 'מידע ראשוני נשלח' }] });
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.already_matched.length, 1);
  assert.equal(r.already_matched[0].existing_match.status, 'מידע ראשוני נשלח');
});

test('nothing below 50% is returned', () => {
  const r = run([buyer({ id: 'b1', name: 'רון', city: 'חיפה', notes: 'פתוח לכל תחום' })],
                [biz({ id: 'z1', name: 'מכבסת הדר', field: 'מכבסה', city: 'אילת', price: 300000 })]);
  assert.ok(r.suggestions.every(s => s.score >= MIN_SCORE));
  assert.equal(r.suggestions.length, 0);
});

test('online business: distance does not count against it', () => {
  const r = run([buyer({ id: 'b1', name: 'גיל', city: 'נהריה', notes: 'מחפש עסק של מסחר אלקטרוני, חנויות eBay' })],
                [biz({ id: 'z1', name: 'DY Web', city: 'תל אביב', desc: 'חברת מסחר אלקטרוני המנהלת חנויות eBay בשוק האמריקאי' })]);
  const s = find(r, 'b1', 'z1');
  assert.ok(s && s.online, 'online suggestion');
  assert.ok(s.how.find(h => h.label === 'מיקום').pts > 0);
  assert.ok(s.why.some(w => /באינטרנט/.test(w)));
});

test('factory far away: relocation caveat instead of a distance penalty', () => {
  const r = run([buyer({ id: 'b1', name: 'עומר', city: 'באר שבע', budget: 3500000, notes: 'מחפש מפעל ייצור' })],
                [biz({ id: 'z1', name: 'איזון תעשיות', field: 'תעשייה', city: 'בת ים', price: 3000000, desc: 'מפעל לעיבוד שבבי' })]);
  const s = find(r, 'b1', 'z1');
  assert.ok(s, 'suggested');
  assert.ok(s.relocatable);
  assert.ok(s.caveats.some(c => /אפשר להעביר/.test(c)));
  assert.ok(s.how.find(h => h.label === 'מיקום').pts >= 0);
});

test('what the buyer wrote he does NOT want blocks the pair', () => {
  const r = run([buyer({ id: 'b1', name: 'בני', city: 'חולון', notes: 'לא מעוניין במסעדות, לא מזון. מחפש סופרמרקט שכונתי באזור המרכז, לא בני ברק' })],
                [biz({ id: 'z1', name: 'פסטיטו', field: 'מסעדה', city: 'חולון', price: 500000 }), biz({ id: 'z2', name: 'מרקט הצפון', field: 'סופרמרקט', city: 'בני ברק' })]);
  assert.equal(r.suggestions.length, 0);
  assert.ok(r.rejected.some(x => x.business_id === 'z2' && /בני ברק/.test(x.reason)));
});

test('a past offer the buyer turned down (same type + same city) is not suggested again', () => {
  const r = run([buyer({ id: 'b1', name: 'שלומי', city: 'רמלה', field: 'קמעונאות מזון', notes: 'התעניין לגבי סופרמרקט בבני ברק, לא מעוניין. מתעניין בסופרמרקט בראשון לציון' })],
                [biz({ id: 'z1', name: 'ש איט מרקט', field: 'סופרמרקט', city: 'בני ברק' })]);
  assert.equal(r.suggestions.length, 0);
  assert.ok(r.rejected[0] && /כבר הציעו|כבר שמע/.test(r.rejected[0].reason), JSON.stringify(r.rejected));
});

test('buyer mentioned the business in the notes but no match exists -> flagged and boosted', () => {
  const r = run([buyer({ id: 'b1', name: 'עידן', city: 'יהוד', notes: 'הוא התקשר ומחפש מינימרקט, יש לו עניין בחלום מתוק בראשל"צ.' })],
                [biz({ id: 'z1', name: 'חלום מתוק מינימרקט', field: 'מינימרקט', city: 'ראשון לציון' })]);
  const s = find(r, 'b1', 'z1');
  assert.ok(s && s.mentioned);
  assert.ok(s.why[0].includes('בהערות כתוב'));
});

test('female buyer gets correct wording; quotes are left untouched', () => {
  const r = run([buyer({ id: 'b1', name: 'מאי דניאל', city: 'כפר יונה', notes: 'שמי מאי ואני נמצאת בחיפוש. מחפשת עסק הפצה B2B' })],
                [biz({ id: 'z1', name: 'גודסט', field: 'סיטונאות', city: 'נתניה', desc: 'יבואן ומפיץ' })]);
  const s = find(r, 'b1', 'z1');
  assert.ok(s, 'suggested');
  assert.ok(s.why.some(w => /מאי מחפשת/.test(w)), s.why.join(' | '));
  assert.equal(fem('הוא מחפש «הוא מחפש»'), 'היא מחפשת «הוא מחפש»');
});

test('contact details only for admin/manager', () => {
  const buyers = [buyer({ id: 'b1', name: 'דן', city: 'ירושלים', field: 'מאפיה' })];
  const businesses = [biz({ id: 'z1', name: 'מאפיית שריינר', field: 'מאפיה', city: 'ירושלים' })];
  const r = run(buyers, businesses);
  const agent = decorateForClient(r.suggestions, { buyers, businesses, fullAccess: false })[0];
  const admin = decorateForClient(r.suggestions, { buyers, businesses, fullAccess: true })[0];
  assert.equal(agent.buyer_info.phone, ''); assert.equal(agent.buyer_info.email, ''); assert.equal(agent.business_info.owner_phone, '');
  assert.equal(admin.buyer_info.phone, '052-2222222'); assert.equal(admin.business_info.owner_phone, '050-1111111');
  // תאימות לדף הישן
  assert.equal(admin.buyer, 'דן'); assert.equal(admin.business, 'מאפיית שריינר'); assert.ok(['blue', 'yellow'].includes(admin.tier)); assert.equal(admin.reason, admin.summary);
});

test('edge function: read-only, same auth, uses the engine; page + button wired', () => {
  const fn = readFileSync(new URL('../supabase/functions/match-suggestions-report/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /from '\.\/engine\.js'/);
  assert.match(fn, /callerProfile\.status === 'active' && \(fullAccess \|\| callerProfile\.can_use_ai_match === true\)/);
  assert.doesNotMatch(fn, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(fn, /anthropic|openai|generativelanguage/i);
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /🧠 התאמות AI חכמות/);
  assert.match(app, /function runAiMatchSuggestions\(\)\{\s*window\.location\.href = 'smart-matches\.html';/);
  const page = readFileSync(new URL('../smart-matches.html', import.meta.url), 'utf8');
  assert.match(page, /functions\/v1\/match-suggestions-report/);
  assert.match(page, /leads\.html\?open=/); assert.match(page, /businesses\.html\?open=/);
  assert.match(page, /למה זה מתאים/); assert.match(page, /מה לא מתאים \/ לשים לב/); assert.match(page, /איך הגענו ל-/);
  assert.match(page, /!fullAccess && !profile\.can_use_ai_match/);
});
