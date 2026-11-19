import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {buildOwnerMatches} from '../supabase/functions/seller-portal-api/matches.ts';

const page = readFileSync(new URL('../smart-matches.html', import.meta.url), 'utf8');
const saveFunction = page.slice(page.indexOf('const matchPairKey'), page.indexOf('function cardHtml'));

function registrationFixture(insertResult, lookupResult) {
  const result = {id: 'match', status: 'התאמה חדשה'};
  const suggestion = {business_id: 'business', buyer_id: 'buyer'};
  const DATA = {suggestions: [suggestion], already_matched: []};
  const button = {dataset: {businessId: 'business', buyerId: 'buyer'}};
  const inserts = [];
  const lookups = [];
  const notifications = [];
  const query = {
    insert(row) { inserts.push(row); return this; },
    select() { return this; },
    single() { return insertResult ?? {data: result, error: null}; },
    eq(column, value) { lookups.push([column, value]); return this; },
    maybeSingle() { return lookupResult; }
  };
  const context = {
    window: {supabaseClient: {from(table) { assert.equal(table, 'matches'); return query; }}},
    profileId: 'staff', DATA, pendingMatches: new Set(),
    document: {querySelectorAll: () => DATA.suggestions.length ? [button] : []},
    render() {}, saveView() {}, console: {warn() {}},
    toast(...args) { notifications.push(args); }
  };
  const save = runInNewContext(saveFunction + '\nsaveSuggestedMatch', context);
  return {save, button, inserts, lookups, notifications, DATA};
}

test('registering saves only the selected buyer and business, once during a double click', async () => {
  const f = registrationFixture();
  await Promise.all([f.save(f.button), f.save(f.button)]);
  assert.equal(f.inserts.length, 1);
  assert.deepEqual({...f.inserts[0]}, {
    business_id: 'business', buyer_id: 'buyer', counterparty_type: 'buyer',
    status: 'התאמה חדשה', match_source: 'התאמות AI', created_by: 'staff'
  });
  assert.equal(f.DATA.already_matched[0].existing_match.id, 'match');
  assert.equal(f.DATA.suggestions.length, 0);
});

test('a duplicate finds the existing pair without changing its current status', async () => {
  const existing = {id: 'existing', status: 'במשא ומתן'};
  const f = registrationFixture({error: {code: '23505'}}, {data: existing, error: null});
  await f.save(f.button);
  assert.deepEqual(f.lookups, [['business_id', 'business'], ['buyer_id', 'buyer']]);
  assert.equal(f.DATA.already_matched[0].existing_match, existing);
});

test('a failed save leaves the suggestion available for another attempt', async () => {
  const f = registrationFixture({error: {code: '42501'}});
  await f.save(f.button);
  assert.equal(f.DATA.already_matched.length, 0);
  assert.equal(f.DATA.suggestions.length, 1);
  assert.equal(f.button.disabled, false);
  assert.equal(f.notifications[0][1], true);
});

test('seller sees requested criteria and verified sends, with registration kept distinct from contact', () => {
  const input = {
    businessId: 'business',
    matches: [
      {id: 'm', business_id: 'business', buyer_id: 'buyer', status: 'התאמה חדשה', match_source: 'התאמות AI'},
      {id: 'other', business_id: 'other-business', buyer_id: 'buyer', status: 'התאמה חדשה'}
    ],
    buyers: [{id: 'buyer', type: 'buyer', full_name: 'קונה לדוגמה', requested_field: 'מאפייה', requested_area: 'המרכז', agreement_status: 'נשלח הסכם לחתימה'}],
    anonSends: [
      {business_id: 'business', buyer_id: 'buyer', delivery_status: 'failed'},
      {business_id: 'other-business', buyer_id: 'buyer', delivery_status: 'sent'}
    ]
  };
  const saved = buildOwnerMatches(input);
  assert.equal(saved.rows.length, 1);
  assert.equal(saved.rows[0].looking_for, 'מאפייה · המרכז');
  assert.equal(saved.rows[0].agreement.key, 'sent');
  assert.equal(saved.rows[0].anonymous_sent, false);
  assert.equal(saved.summary.contacted, 0);

  input.anonSends.push({business_id: 'business', buyer_id: 'buyer', delivery_status: 'sent'});
  input.buyers[0].requested_area = '050 000 0000';
  const sent = buildOwnerMatches(input);
  assert.equal(sent.rows[0].looking_for, 'מאפייה');
  assert.equal(sent.rows[0].anonymous_sent, true);
  assert.equal(sent.summary.contacted, 1);
});
