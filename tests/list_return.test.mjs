import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { URL, URLSearchParams };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../js/listReturn.js', import.meta.url), 'utf8'), ctx);
const R = ctx.BSDListReturn;

function run(stack, plan){
  for (const op of plan.ops){
    if (op.op === 'replace') stack[stack.length - 1] = { url: op.url, state: op.state };
    else stack.push({ url: op.url, state: op.state });
  }
  return stack;
}
function back(stack){
  if (stack.length > 1) stack.pop();
  return stack[stack.length - 1];
}

test('card url keeps the hub return marker and drops open=', () => {
  const url = R.cardUrl('/repo/leads.html?open=abc&from=leads-hub', 'abc');
  const u = new URL(url, 'https://bsd.local');
  assert.equal(u.searchParams.get('card'), 'abc');
  assert.equal(u.searchParams.get('from'), 'leads-hub');
  assert.equal(u.searchParams.get('open'), null);
  assert.equal(R.cameFromHub(url), true);
});

test('list url drops the card but keeps filters that live in the query', () => {
  const url = R.listUrl('/repo/leads.html?card=abc&view=archive&from=leads-hub');
  const u = new URL(url, 'https://bsd.local');
  assert.equal(u.searchParams.get('card'), null);
  assert.equal(u.searchParams.get('view'), 'archive');
  assert.equal(u.searchParams.get('from'), 'leads-hub');
});

test('opening a hub card pushes history so Back stays on the filtered list', () => {
  const list = { v: 1, tab: 'manual', search: 'דנה', scroll: { x: 0, y: 640 }, anchorId: 'L1' };
  const stack = [{ url: '/app.html', state: null }, { url: '/leads-hub.html', state: null }];
  run(stack, R.planCardEntry({
    href: '/leads-hub.html',
    state: null,
    cardType: 'hub-lead',
    listType: 'leads-hub',
    recordId: 'L1',
    listSnapshot: list
  }));
  assert.equal(stack.length, 3);
  assert.equal(stack[2].state.bsdCardType, 'hub-lead');
  assert.equal(stack[1].state.bsdListType, 'leads-hub');
  assert.equal(stack[1].state.list.search, 'דנה');
  assert.equal(stack[1].state.list.scroll.y, 640);
  const landed = back(stack);
  assert.equal(landed.url, '/leads-hub.html');
  assert.equal(landed.state.list.anchorId, 'L1');
  assert.notEqual(landed.url, '/app.html');
});

test('a card opened from the hub does not insert a buyers-list entry in front of Back', () => {
  const stack = [
    { url: '/app.html', state: null },
    { url: '/leads-hub.html', state: { bsdListType: 'leads-hub', list: { v: 1, search: 'חיפה', scroll: { y: 900 } } } }
  ];
  stack.push({ url: '/leads.html?open=L9&from=leads-hub', state: null });
  run(stack, R.planCardEntry({
    href: '/leads.html?open=L9&from=leads-hub',
    state: null,
    fromHub: true,
    cardType: 'lead',
    listType: 'leads',
    recordId: 'L9'
  }));
  assert.equal(stack.length, 3, 'must not push a synthetic buyers-list entry');
  assert.match(stack[2].url, /card=L9/);
  assert.match(stack[2].url, /from=leads-hub/);
  assert.equal(stack[2].state.bsdFrom, 'leads-hub');
  const landed = back(stack);
  assert.equal(landed.url, '/leads-hub.html');
  assert.equal(landed.state.list.search, 'חיפה');
  assert.equal(landed.state.list.scroll.y, 900);
});

test('buyers list keeps its own filter snapshot under the card', () => {
  const list = { v: 1, type: 'partner', search: 'אביב', view: 'active', scroll: { y: 420 } };
  const stack = [{ url: '/app.html', state: null }, { url: '/leads.html', state: null }];
  run(stack, R.planCardEntry({
    href: '/leads.html',
    state: null,
    cardType: 'lead',
    listType: 'leads',
    recordId: 'B2',
    listSnapshot: list
  }));
  assert.equal(stack[1].state.list.type, 'partner');
  assert.equal(stack[1].state.list.scroll.y, 420);
  const landed = back(stack);
  assert.equal(landed.url, '/leads.html');
  assert.equal(landed.state.bsdListType, 'leads');
  assert.notEqual(landed.url, '/app.html');
});

test('reopening a card replaces the card entry instead of stacking another Back step', () => {
  const stack = [{ url: '/leads-hub.html', state: { bsdListType: 'leads-hub', list: { v: 1, search: 'א' } } }];
  run(stack, R.planCardEntry({
    href: '/leads-hub.html', state: null, cardType: 'hub-lead', listType: 'leads-hub', recordId: 'A', listSnapshot: { v: 1, search: 'א' }
  }));
  run(stack, R.planCardEntry({
    href: stack[stack.length - 1].url,
    state: stack[stack.length - 1].state,
    cardType: 'hub-lead',
    listType: 'leads-hub',
    recordId: 'B',
    listSnapshot: { v: 1, search: 'א' }
  }));
  assert.equal(stack.length, 2);
  assert.match(stack[1].url, /card=B/);
  assert.equal(back(stack).state.list.search, 'א');
});

test('leads hub and buyers pages wire Back through the shared history plan', () => {
  const hub = fs.readFileSync(new URL('../leads-hub.html', import.meta.url), 'utf8');
  const leads = fs.readFileSync(new URL('../leads.html', import.meta.url), 'utf8');
  const biz = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
  assert.match(hub, /planCardEntry/);
  assert.match(hub, /leaveHubForCard/);
  assert.match(hub, /restoreHubListState/);
  assert.match(leads, /planCardEntry/);
  assert.match(leads, /restoreLeadsListState/);
  assert.match(biz, /bsdFrom === 'leads-hub'/);
  assert.doesNotMatch(leads, /location\.href = 'leads-hub\.html'/);
});
