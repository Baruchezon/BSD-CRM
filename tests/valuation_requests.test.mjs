import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const V = require('../js/valuation-requests.js');
const page = read('valuation-requests.html');
const hub = read('leads-hub.html');
const js = read('js/valuation-requests.js');
const sql = read('supabase/migrations/20261124193000_valuation_requests.sql');
const rb = read('supabase/migrations/rollback_20261124193000_valuation_requests.sql');

test('leads hub: one tab link «בקשות להערכות שווי» next to the other lead tabs', () => {
  const tabs = hub.slice(hub.indexOf('<div class="lead-tabs">'), hub.indexOf('id="y2026HiddenLinkWrap"'));
  assert.equal((tabs.match(/href="valuation-requests\.html"/g) || []).length, 1);
  assert.ok(tabs.includes('בקשות להערכות שווי'));
  assert.ok(tabs.indexOf('לקוחות בטיפול') < tabs.indexOf('בקשות להערכות שווי'));
});

test('page: build stamp, Hebrew RTL, wine/cream/gold, 5 slice buttons, no wrapping names', () => {
  const version = JSON.parse(read('version.json')).version;
  assert.match(page, new RegExp("var PAGE_BUILD = '" + version + "';"));
  assert.match(hub, new RegExp("var PAGE_BUILD = '" + version + "';"));
  assert.match(page, /<html lang="he" dir="rtl">/);
  for (const c of ['#3A0F20', '#F7EFE2', '#C9A24A']) assert.ok(page.includes(c), c);
  assert.equal(V.SLICES.length, 5);
  assert.match(page, /\.vrow span\{white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  assert.match(page, /js\/valuation-requests\.js\?v=\d{12}/);
});

test('screen: admin/manager only, reads the table, archive is soft via rpc, demo rows only on local', () => {
  assert.match(js, /\['admin', 'manager'\]\.includes\(profile\.role\)/);
  assert.match(js, /from\('valuation_requests'\)\.select\('\*'\)/);
  assert.match(js, /rpc\('set_valuation_request_archived'/);
  assert.ok(!/\.delete\(/.test(js), 'no deletes');
  assert.ok(!/\.(insert|update|upsert)\(/.test(js), 'no direct writes');
  assert.match(js, /file:\|http:\\\/\\\/\(localhost\|127\\\.0\\\.0\\\.1\)/);
  assert.match(js, /הערכת שווי מס׳ /);
});

test('helpers: Israel time, month buckets, value text, breakdown', () => {
  assert.equal(V.ilDateTime('2026-11-24T17:30:00Z'), '24.11.2026 19:30');
  assert.equal(V.ilMonthKey('2026-11-30T23:30:00Z'), '2026-12');
  assert.equal(V.monthLabel('2026-11'), 'נובמבר 2026');
  assert.equal(V.valueText({ result_kind: 'range', value_low: 700000, value_high: 1160000 }), '₪700K – ₪1.16M');
  assert.equal(V.valueText({ result_kind: 'not_profitable' }), 'לא רווחי – אין מכפיל');
  const rows = [
    { created_at: '2026-11-24T10:00:00Z', sector: 'food', staff: 'mid', business_age: 'old', profit: 300000, result_kind: 'range', value_low: 300000, value_high: 600000 },
    { created_at: '2026-11-20T10:00:00Z', sector: 'food', staff: 'none', business_age: 'young', profit: -5, result_kind: 'not_profitable' },
    { created_at: '2026-10-02T10:00:00Z', sector: 'online', staff: 'veteran', business_age: 'mid', profit: 1000000, result_kind: 'range', value_low: 2000000, value_high: 4000000, contact_at: '2026-10-02T10:05:00Z' }
  ];
  const s = V.summarize(rows);
  assert.equal(s.total, 3);
  assert.equal(s.withContact, 1);
  assert.deepEqual(s.months.map(m => [m.key, m.count]), [['2026-11', 2], ['2026-10', 1]]);
  const bySector = V.breakdown(rows, V.SLICES.find(x => x.id === 'sector'));
  assert.deepEqual(bySector[0], { key: 'מסעדות, בתי קפה ומזון', count: 2, pct: 67, avgMid: 450000 });
  const byValue = V.breakdown(rows, V.SLICES.find(x => x.id === 'value')).map(e => e.key);
  assert.deepEqual(byValue, ['250–500 אלף', '2–5 מיליון', 'לא רווחי']);
});

test('db: RLS on, read only for active admin/manager, anon writes only through validated rpc', () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /status = 'active' and p\.role in \('admin', 'manager'\)/);
  assert.match(sql, /revoke all on table public\.valuation_requests from public, anon, authenticated;/);
  assert.ok(!/grant (insert|update|delete)[^;]*valuation_requests/i.test(sql));
  assert.match(sql, /grant execute on function public\.submit_valuation_request\(jsonb\) to anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.valuation_calc\(text, numeric, jsonb\) from public, anon, authenticated;/);
  assert.match(sql, /rate limited/);
  assert.match(sql, /generated always as identity/);
  assert.match(rb, /revoke execute on function public\.submit_valuation_request\(jsonb\) from anon, authenticated;/);
  assert.ok(!/^\s*drop table/im.test(rb), 'rollback keeps the data');
});
