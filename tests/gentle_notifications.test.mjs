// Gentle, controllable notifications (build 202610051500).
// Root cause of the endless new-lead popup: re-checked every 60s + on every load,
// "סגירה" was not remembered, and archived leads still in stage 'new' were included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = f => fs.readFileSync(root + f, 'utf8');
const app = read('app.html');

function loadModule() {
  const mem = {};
  const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const document = { readyState: 'complete', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } };
  const ctx = { window: {}, document, localStorage, Date, JSON, String, Object, parseInt, setTimeout };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/bsdNotify.js'), ctx);
  return { N: ctx.BSDNotify, mem };
}

test('new-lead query excludes archived leads', () => {
  const fn = app.slice(app.indexOf('async function checkNewLeadPopup'), app.indexOf('function showNewLeadPopup'));
  assert.match(fn, /\.eq\('website_intake_stage', 'new'\)/);
  assert.match(fn, /\.not\('is_archived', 'is', true\)/);
});

test('new-lead popup only shows leads that were not closed/snoozed, and never re-pops the same card', () => {
  const fn = app.slice(app.indexOf('async function checkNewLeadPopup'), app.indexOf('function showNewLeadPopup'));
  assert.match(fn, /BSDNotify\.isHidden\('lead', l\.id\)/);
  assert.match(fn, /BSDNotify\.allowed\('leads'\)/);
  assert.match(fn, /open\.dataset\.ids === ids\) return/);
  const show = app.slice(app.indexOf('function showNewLeadPopup'), app.indexOf('window.bsdOnLeadPush'));
  assert.match(show, /onDismiss: \(\) => ids\.forEach\(id => BSDNotify\.dismiss\('lead', id\)\)/);
  assert.match(show, /onSnooze/);
});

test('no blocking full-screen overlays left in the dashboard popups', () => {
  assert.doesNotMatch(app, /newLeadPopupOverlay|todayTasksCloseBtn|newMsgPopupCloseBtn/);
  for (const fn of ['showTasksPopup', 'showNewMessagesPopup', 'showNewLeadPopup']) {
    const body = app.slice(app.indexOf('function ' + fn), app.indexOf('\n}\n', app.indexOf('function ' + fn)));
    assert.match(body, /BSDNotify\.showCard/, fn);
    assert.doesNotMatch(body, /inset:0/, fn);
  }
});

test('tasks and messages respect mute', () => {
  assert.match(app, /if \(window\.BSDNotify && !BSDNotify\.allowed\('tasks'\)\) return;/);
  assert.match(app, /if \(window\.BSDNotify && !BSDNotify\.allowed\('messages'\)\) return;/);
});

test('every page that loads push.js also loads bsdNotify.js first (same build)', () => {
  const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
  let n = 0;
  for (const p of pages) {
    const s = read(p);
    if (!/js\/push\.js/.test(s)) continue;
    n++;
    const a = s.indexOf('js/bsdNotify.js?v=202610051500'), b = s.indexOf('js/push.js?v=202610051500');
    assert.ok(a > 0 && b > a, p);
  }
  assert.ok(n >= 10);
});

test('push while app is open: sound and auto-jump follow the settings', () => {
  const push = read('js/push.js');
  assert.match(push, /N\.soundAllowed\(\)/);
  assert.match(push, /N\.autoJump\(\) && document\.visibilityState === 'visible'/);
  assert.match(push, /N\.showCard\(/);
  assert.match(read('sw.js'), /postMessage\(\{ type: 'BSD_PUSH_SOUND', kind, url: targetUrl, title, body: options\.body \}\)/);
});

test('module: dismiss sticks, snooze expires, mute for an hour / by type / until turned on', () => {
  const { N, mem } = loadModule();
  assert.equal(N.isHidden('lead', 'a'), false);
  N.dismiss('lead', 'a');
  assert.equal(N.isHidden('lead', 'a'), true);
  assert.equal(N.isDismissed('lead', 'a'), true);
  N.snooze('lead', 'b', 3600e3);
  assert.equal(N.isHidden('lead', 'b'), true);
  const d = JSON.parse(mem.bsdNotifyDismissed_v1); d['lead:b'].until = Date.now() - 1; mem.bsdNotifyDismissed_v1 = JSON.stringify(d);
  assert.equal(N.isHidden('lead', 'b'), false, 'snooze expired');
  assert.equal(N.allowed('leads'), true);
  N.savePrefs({ leads: false });
  assert.equal(N.allowed('leads'), false);
  assert.equal(N.allowed('messages'), true);
  N.savePrefs({ leads: true });
  N.muteFor(3600e3);
  assert.equal(N.allowed('messages'), false);
  assert.equal(N.soundAllowed(), false);
  N.unmute();
  assert.equal(N.allowed('messages'), true);
  N.muteFor(-1);
  assert.equal(N.mutedAll(), true);
  N.unmute();
  N.muteUntilTomorrow();
  const until = N.prefs().muteUntil, t = new Date(until);
  assert.ok(until > Date.now() && t.getHours() === 8 && t.getMinutes() === 0);
  N.unmute();
  assert.equal(N.autoJump(), false, 'auto-jump is off by default');
});

test('module: old dismissals are pruned (60 days) and the list stays bounded', () => {
  const { N, mem } = loadModule();
  mem.bsdNotifyDismissed_v1 = JSON.stringify({ 'lead:old': { at: Date.now() - 61 * 864e5 } });
  N.dismiss('lead', 'new');
  const s = JSON.parse(mem.bsdNotifyDismissed_v1);
  assert.ok(!('lead:old' in s) && 'lead:new' in s);
  for (let i = 0; i < 900; i++) N.dismiss('msg', 'm' + i);
  assert.ok(Object.keys(JSON.parse(mem.bsdNotifyDismissed_v1)).length <= 800);
});
