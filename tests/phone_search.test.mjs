// 08.10.2026 (בקשת ברוך): חיפוש טלפון בכל הרשימות בלי תלות במקפים / רווחים / +972,
// וקונה עם הסכם חתום מופיע תמיד ברשימת הקונים (גם אם עדיין מסומן כפנייה מהאתר).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const ctx = {}; vm.createContext(ctx); vm.runInContext(read('js/bsd-search.js'), ctx);
const S = ctx.BSDSearch;

test('bsd-search: same number in any format matches', () => {
  const stored = ['052-5337339', '0525337339', '052 533 7339', '+972-52-533-7339', '+972 (0)52 5337339', '00972525337339', '972525337339'];
  const typed = ['0525337339', '052-5337339', '052 533 7339', '+972525337339', '+972 52-533-7339', '972525337339', '00972-52-5337339', '5337339', '533-7339'];
  for (const p of stored) for (const q of typed) assert.equal(S.phoneMatch(q, [p]), true, `${q} vs ${p}`);
  assert.equal(S.phoneKey('+972-52-533-7339'), '0525337339');
  assert.equal(S.phoneKey('052-5337339'), '0525337339');
});

test('bsd-search: not a phone search -> no phone match (names, short digits, empty, other numbers)', () => {
  for (const q of ['סופיאן', 'abc 052', '', '  ', '05', '1', null, undefined]) assert.equal(S.phoneMatch(q, ['052-5337339']), false, String(q));
  assert.equal(S.phoneMatch('0541111111', ['052-5337339']), false);
  assert.equal(S.phoneMatch('0525337339', [null, '', undefined]), false);
  assert.equal(S.phoneMatch('0525337339', [null, '052-5337339']), true);
  assert.equal(S.phoneQuery('9725'), '9725'); // half-typed prefix is never turned into "05"
});

const LISTS = [
  ['leads.html', /BSDSearch\.phoneMatch\(search, \[l\.phone, l\.phone2\]\)/],
  ['businesses.html', /BSDSearch\.phoneMatch\(search, \[b\.owner_phone\]\)/],
  ['leads-hub.html', /BSDSearch\.phoneMatch\(search, \[r\.phone\]\)/],
  ['leads-hub.html', /BSDSearch\.phoneMatch\(search, \[r\.phone, r\.phone2, r\.owner_phone\]\)/],
  ['matches-workspace.html', /BSDSearch\.phoneMatch\(q, \[cp\?\.phone, cp\?\.phone2\]\)/],
];
test('every list loads js/bsd-search.js and adds phone matching as an extra OR (old search kept)', () => {
  for (const [file, re] of LISTS){
    const src = read(file);
    assert.match(src, /<script src="js\/bsd-search\.js\?v=\d+"><\/script>/, file);
    assert.match(src, re, file);
    assert.match(src, /window\.BSDSearch &&|if \(!window\.BSDSearch\) return false;/, file + ' guarded if the helper is missing');
  }
  assert.match(read('leads.html'), /if \(!hay\.includes\(search\) && !\(window\.BSDSearch/);
  assert.match(read('businesses.html'), /if \(!hay\.includes\(search\) && !\(window\.BSDSearch/);
  assert.match(read('matches-workspace.html'), /if \(q && !matchSearchHay\(m\)\.includes\(q\) && !matchPhoneHit\(m, q\)\) return false;/);
});

// Runs the real buyers-list filter from leads.html against sample rows.
function buyersList(rows, { search = '', type = 'all', agreement = 'all', createdBy = 'all' } = {}){
  const src = read('leads.html');
  const helper = src.match(/function leadHasSignedAgreement\(l\)\{[^\n]*\}/)[0];
  const start = src.indexOf('let rows = ALL_LEADS.filter(l=>{');
  const end = src.indexOf('\n  });', start);
  const body = src.slice(start, end + 6);
  const c = { ALL_LEADS: rows, search: search.trim().toLowerCase(), type, agreement, createdBy, window: { BSDSearch: S }, BSDSearch: S, out: null };
  vm.createContext(c);
  vm.runInContext(`${helper}\n${body}\nout = rows;`, c);
  return c.out.map(r => r.id);
}
const base = { type: 'buyer', is_archived: false, website_intake_stage: null, agreement_status: 'אין הסכם' };
const ROWS = [
  { ...base, id: 'sofian', full_name: 'סופיאן טוויל', phone: '052-5337339', agreement_status: 'יש הסכם חתום', agreement_signed: true },
  { ...base, id: 'omer', full_name: 'עומר יהודה', phone: '050-1234567', website_intake_stage: 'contacted', agreement_status: 'יש הסכם חתום' },
  { ...base, id: 'signedFlagOnly', full_name: 'דגל חתום', phone: '050-7654321', website_intake_stage: 'new', agreement_signed: true },
  { ...base, id: 'openNoAgreement', full_name: 'פנייה פתוחה', phone: '050-1111111', website_intake_stage: 'contacted' },
  { ...base, id: 'training', full_name: 'הדרכה', phone: '050-2222222', website_intake_stage: 'training', agreement_status: 'נשלח הסכם לחתימה' },
  { ...base, id: 'seller', type: 'seller', full_name: 'מוכר', phone: '050-3333333', agreement_status: 'יש הסכם חתום' },
  { ...base, id: 'partner', type: 'partner', full_name: 'שותף', phone: '+972-54-444-4444', website_intake_stage: 'new', agreement_status: 'יש הסכם חתום' },
];

test('buyers list: signed agreement always shown, even while still marked as a website enquiry', () => {
  assert.deepEqual(buyersList(ROWS), ['sofian', 'omer', 'signedFlagOnly', 'partner']);
  assert.deepEqual(buyersList(ROWS, { type: 'buyer' }), ['sofian', 'omer', 'signedFlagOnly']);
  assert.deepEqual(buyersList(ROWS, { agreement: 'יש הסכם חתום' }), ['sofian', 'omer', 'partner']);
});

test('buyers list: phone search without dashes / with +972, name search unchanged', () => {
  assert.deepEqual(buyersList(ROWS, { search: '0525337339' }), ['sofian']);
  assert.deepEqual(buyersList(ROWS, { search: '052-5337339' }), ['sofian']);
  assert.deepEqual(buyersList(ROWS, { search: '+972 52 533 7339' }), ['sofian']);
  assert.deepEqual(buyersList(ROWS, { search: '0544444444' }), ['partner']);
  assert.deepEqual(buyersList(ROWS, { search: 'סופיאן' }), ['sofian']);
  assert.deepEqual(buyersList(ROWS, { search: 'עומר' }), ['omer']);
  assert.deepEqual(buyersList(ROWS, { search: '0501111111' }), []); // open enquiry without agreement stays in the leads list only
});

test('build bumped on every touched page and version.json', () => {
  const v = JSON.parse(read('version.json')).version;
  for (const f of ['leads.html', 'businesses.html', 'leads-hub.html', 'matches-workspace.html'])
    assert.match(read(f), new RegExp(`var PAGE_BUILD = '${v}';`), f);
});
