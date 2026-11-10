import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSuggestions, scorePair, profileBuyer, profileBusiness } from '../supabase/functions/match-suggestions-report/engine.js';

const buyer = (o) => ({ id: 'b', full_name: 'דן', requested_field: o.field || '', requested_area: o.area || '', city: o.city || '', budget: o.budget ?? null, notes: o.notes || '' });
const biz = (o) => ({ id: o.id || 'z', internal_name: o.name, field: o.field, city: o.city || 'חיפה', asking_price: o.price ?? 600000, short_description: o.desc || '' });
const one = (b, z) => buildSuggestions({ buyers: [b], businesses: [z], matches: [], distributions: [], notes: [] });

test('same sector plus a price inside the budget lands at 75 or above', () => {
  const r = one(buyer({ field: 'מסעדה', budget: 800000, city: 'חיפה' }), biz({ name: 'מסעדת רוזה', field: 'מסעדה', price: 650000 }));
  const s = r.suggestions[0];
  assert.ok(s, 'suggested');
  assert.ok(s.score >= 75, 'score ' + s.score);
  assert.match(s.summary, /אותו תחום|התאמה גבוהה/);
  assert.ok(s.why.some(w => /בתוך התקציב/.test(w)));
});

test('a bakery is the same league as a restaurant buyer, but below an exact restaurant', () => {
  const b = buyer({ field: 'מסעדה', budget: 800000, city: 'חיפה' });
  const exact = one(b, biz({ id: 'rest', name: 'מסעדה', field: 'מסעדה', price: 650000 })).suggestions[0];
  const bakery = one(b, biz({ id: 'bake', name: 'בית מאפה', field: 'מאפייה', price: 650000 })).suggestions[0];
  const cafe = one(b, biz({ id: 'cafe', name: 'קפה', field: 'בית קפה', price: 650000 })).suggestions[0];
  assert.ok(exact && bakery && cafe);
  assert.ok(exact.score >= 75, 'exact ' + exact.score);
  assert.ok(bakery.score >= 61 && bakery.score < exact.score, 'bakery ' + bakery.score);
  assert.ok(cafe.score >= 61 && cafe.score < exact.score, 'cafe ' + cafe.score);
  assert.match(bakery.summary + bakery.why.join(' '), /ליגה/);
});

test('explicit exclusions disqualify the field and the food family', () => {
  const restaurant = biz({ name: 'מסעדה', field: 'מסעדה' });
  const bakery = biz({ id: 'bake', name: 'מאפייה', field: 'מאפייה' });
  const factory = biz({ id: 'fac', name: 'מפעל', field: 'עיבוד שבבי', desc: 'ייצור חלקי מתכת' });
  for (const notes of ['לא מסעדות', 'בלי הסעדה', 'מלבד מסעדות']) {
    const r = one(buyer({ field: '', notes, budget: 800000 }), restaurant);
    assert.equal(r.suggestions.length, 0, notes);
    assert.match(r.rejected[0].reason, /^פסול: הקונה שולל תחום/);
  }
  const noFood = one(buyer({ field: '', notes: 'מחפש עסק, לא מזון', budget: 800000 }), bakery);
  assert.equal(noFood.suggestions.length, 0);
  assert.match(noFood.rejected[0].reason, /מזון/);
  const kept = one(buyer({ field: '', notes: 'לא מסעדות. מחפש מאפייה', budget: 800000 }), bakery);
  assert.equal(kept.suggestions.length, 1, 'bakery survives לא מסעדות');
  const other = one(buyer({ field: 'מסעדה', notes: 'לא מזון' }), factory);
  assert.equal(other.suggestions.length, 0);
});

test('budget in range, up to 20 percent over, far over, and open to offers', () => {
  const base = { field: 'מסעדה', city: 'חיפה', area: '' };
  const inside = one(buyer({ ...base, budget: 800000 }), biz({ field: 'מסעדה', price: 650000 })).suggestions[0];
  const slight = one(buyer({ ...base, budget: 600000 }), biz({ field: 'מסעדה', price: 700000 })).suggestions[0];
  const far = scorePair(profileBuyer(buyer({ ...base, budget: 200000 })), profileBusiness(biz({ field: 'מסעדה', price: 650000 })));
  const open = one(buyer({ ...base, budget: 200000, notes: 'פתוח להצעות' }), biz({ field: 'מסעדה', price: 650000 })).suggestions[0];
  const none = one(buyer({ ...base, budget: null }), biz({ field: 'מסעדה', price: 650000 })).suggestions[0];
  assert.ok(inside.score >= 75, 'inside ' + inside.score);
  assert.ok(slight.score >= 61 && slight.score < inside.score, 'slight ' + slight.score);
  assert.ok(slight.why.some(w => /מעט מעל/.test(w)));
  assert.ok(far.score <= 60, 'far ' + far.score);
  assert.equal(one(buyer({ ...base, budget: 200000 }), biz({ field: 'מסעדה', price: 650000 })).suggestions.length, 0);
  assert.ok(open.score > far.score, 'open ' + open.score + ' vs far ' + far.score);
  assert.ok(open.why.concat(open.how.map(h => h.text)).some(t => /פתוח להצעות/.test(t)));
  assert.ok(none.score >= 61, 'no budget still scores ' + none.score);
  assert.ok(!none.caveats.some(c => /לא ידוע התקציב/.test(c)));
  const pair = scorePair(profileBuyer(buyer({ ...base, budget: 200000 })), profileBusiness(biz({ field: 'מסעדה', price: 650000 })));
  assert.ok(pair.score <= 60);
});
