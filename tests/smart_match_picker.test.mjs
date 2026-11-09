import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../js/bsd-search.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(new URL('../js/smart-match-picker.js', import.meta.url), 'utf8'), ctx);
const pick = ctx.BSDSmartPick;

const businesses = [
  { id: 'z1', name: 'איזון תעשיות', number: 'BSD-B-2607-1019', detail: 'תעשייה · בת ים', phones: ['054-2424999'] },
  { id: 'z2', name: "צ'ילוקה טאקרייה מסעדה מקסיקנית", number: 'BSD-B-2610-1100', detail: 'מסעדה · תל אביב', phones: [] },
  { id: 'z3', name: 'אלונה שכטר בע"מ', number: 'BSD-B-2610-1104', id_number: '515555555', detail: 'אסתטיקה · נתניה', phones: ['050-5345001'] },
  { id: 'z4', name: ' DY Web', number: 'BSD-B-2608-1058', detail: 'תל אביב', phones: ['050-6504488'] },
  { id: 'z5', name: 'דקור הנגב מטבחים', number: 'BSD-B-2610-1088', detail: 'נגריה · באר שבע', phones: ['054-7394080'] },
];
const buyers = [
  { id: 'b1', name: 'אשר חן', number: 'BSD-C-100', detail: 'מסעדה · מרכז', phones: ['052-5337339'] },
  { id: 'b2', name: 'מאיה לוי', number: 'BSD-C-200', detail: 'מאפייה · ירושלים', phones: ['054-1112233'] },
];

test('one or two letters find a real business, ignoring geresh, quotes, spaces and case', () => {
  assert.equal(pick.matches(businesses, '').length, 0);
  assert.equal(pick.matches(businesses, 'אי')[0].name, 'איזון תעשיות');
  assert.equal(pick.matches(businesses, 'ציל')[0].id, 'z2');
  assert.equal(pick.matches(businesses, "צ'יל")[0].id, 'z2');
  assert.equal(pick.matches(businesses, 'בעמ')[0].id, 'z3');
  assert.equal(pick.matches(businesses, 'dy')[0].id, 'z4');
  assert.equal(pick.matches(businesses, 'דקור  הנגב')[0].id, 'z5');
});

test('search also matches business number, company id and phone', () => {
  assert.equal(pick.matches(businesses, '1088')[0].id, 'z5');
  assert.equal(pick.matches(businesses, 'BSD-B-2607-1019')[0].id, 'z1');
  assert.equal(pick.matches(businesses, '515555555')[0].id, 'z3');
  assert.equal(pick.matches(businesses, '0506504488')[0].id, 'z4');
  assert.equal(pick.matches(businesses, '054-242-4999')[0].id, 'z1');
});

test('buyers match the same way and both lists sort in Hebrew', () => {
  assert.equal(pick.matches(buyers, 'אש')[0].name, 'אשר חן');
  assert.equal(pick.matches(buyers, '0525337339')[0].id, 'b1');
  assert.equal(pick.matches(buyers, 'מא').length, 1);
  const sorted = pick.sortRows(businesses.concat(buyers));
  const names = sorted.map(r => r.name.trim());
  assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b, 'he')));
  assert.ok(pick.matches(businesses, 'א').length >= 2);
  assert.ok(pick.matches(buyers, 'מ').length >= 1);
});

test('score buckets keep 75, 61, 50 and the rest in that order', () => {
  const b = pick.scoreBucket;
  assert.equal(b(99), 'high');
  assert.equal(b(75), 'high');
  assert.equal(b(74), 'good');
  assert.equal(b(61), 'good');
  assert.equal(b(60), 'mid');
  assert.equal(b(50), 'mid');
  assert.equal(b(49), 'low');
  assert.equal(b(0), 'low');
  assert.equal(pick.defaultBucket({ high: 2, good: 4, mid: 1, low: 9 }), 'high');
  assert.equal(pick.defaultBucket({ high: 0, good: 3, mid: 1, low: 0 }), 'good');
  assert.equal(pick.defaultBucket({ high: 0, good: 0, mid: 0, low: 5 }), 'low');
  assert.equal(pick.defaultBucket({}), 'all');
  assert.equal(pick.BUCKETS.map(x => x.id).join(','), 'high,good,mid,low');
});

test('business search can narrow by sector and status, then group and sort', () => {
  const rows = [
    { id: 'a', name: 'איזון תעשיות', field: 'תעשייה', status: 'פעיל', created_at: '2026-07-01', match_count: 2, number: 'BSD-B-1' },
    { id: 'b', name: 'מאפיית פארין', field: 'מאפייה', status: 'יש הסכם חתום', created_at: '2026-09-02', match_count: 5, number: 'BSD-B-2' },
    { id: 'c', name: 'דולצה מיה', field: 'מאפייה', status: 'פעיל', created_at: '2026-08-01', match_count: 1, number: 'BSD-B-3' },
  ];
  const named = pick.businessView(rows, { query: 'מ', sort: 'name', group: true });
  assert.equal(named.groups.map(g => g.label).join('|'), 'מאפייה');
  assert.equal(named.rows.map(r => r.id).join(','), 'c,b');
  const newest = pick.businessView(rows, { query: '', field: 'מאפייה', sort: 'new', group: false });
  assert.equal(newest.rows.map(r => r.id).join(','), 'b,c');
  const popular = pick.businessView(rows, { status: 'פעיל', sort: 'matches', group: true });
  assert.equal(popular.rows.map(r => r.id).join(','), 'a,c');
  assert.equal(pick.businessView(rows, { query: '' }).rows.length, 0);
});

test('back moves one smart-matches screen at a time', () => {
  assert.equal(pick.planSmartStep('picker', 'results'), 'push');
  assert.equal(pick.planSmartStep(undefined, 'results'), 'push');
  assert.equal(pick.planSmartStep('results', 'results'), 'replace');
  assert.equal(pick.planSmartStep('results', 'picker'), 'back');
});

test('the smart matches screen uses one search box and runs on the click', () => {
  const page = fs.readFileSync(new URL('../smart-matches.html', import.meta.url), 'utf8');
  assert.match(page, /BSDSmartPick\.matches/);
  assert.match(page, /chooseTarget/);
  assert.match(page, /loadSuggestions\(\)/);
  assert.doesNotMatch(page, /בחר עסק מהרשימה/);
  assert.match(page, /עסק<\/button><button type="button" data-v="buyer">קונה/);
  assert.match(page, /75% ומעלה/);
  assert.match(page, /61%–74%/);
  assert.match(page, /50%–60%/);
  assert.match(page, /מתחת ל-50%/);
  assert.match(page, /id="smListScroll"/);
  assert.match(page, /bucket: STATE\.bucket/);
  assert.match(page, /listScroll/);
  assert.match(page, /קיבוץ לפי תחום/);
  assert.match(page, /לפי מספר התאמות/);
  assert.match(page, /function smartBack\(\)\{ history\.back\(\); \}/);
  assert.match(page, /history\.pushState/);
  assert.match(page, /popstate/);
  assert.doesNotMatch(page, /חזרה ללוח הבקרה/);
  assert.match(page, /selectBucket/);
  assert.match(page, /scrollTop = 0/);
  assert.doesNotMatch(page, /id="fMin"/);
});
