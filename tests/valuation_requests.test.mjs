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
const sql2 = read('supabase/migrations/20261124203000_valuation_requests_employees_turnover.sql');
const rb2 = read('supabase/migrations/rollback_20261124203000_valuation_requests_employees_turnover.sql');

test('leads hub: one tab link «בקשות להערכות שווי» next to the other lead tabs', () => {
  const tabs = hub.slice(hub.indexOf('<div class="lead-tabs">'), hub.indexOf('id="y2026HiddenLinkWrap"'));
  assert.equal((tabs.match(/href="valuation-requests\.html"/g) || []).length, 1);
  assert.ok(tabs.includes('בקשות להערכות שווי'));
  assert.ok(tabs.indexOf('לקוחות בטיפול') < tabs.indexOf('בקשות להערכות שווי'));
});

test('page: build stamp, Hebrew RTL, wine/cream/gold, 6 slice buttons, no wrapping names', () => {
  const version = JSON.parse(read('version.json')).version;
  assert.match(page, new RegExp("var PAGE_BUILD = '" + version + "';"));
  assert.match(hub, new RegExp("var PAGE_BUILD = '" + version + "';"));
  assert.match(page, /<html lang="he" dir="rtl">/);
  for (const c of ['#3A0F20', '#F7EFE2', '#C9A24A']) assert.ok(page.includes(c), c);
  assert.equal(V.SLICES.length, 6);
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

test('v2: first 5 slices — industry, headcount, value, profit, turnover (age and seniority only in details)', () => {
  assert.deepEqual(V.SLICES.map(x => x.id).slice(0, 5), ['sector', 'employees', 'value', 'profit', 'turnover']);
  assert.deepEqual(V.EMPLOYEE_BUCKETS.map(b => b[2]), ['0 (רק הבעלים)', '1–2', '3–5', '6–10', '11–20', '21–50', '51+']);
  assert.deepEqual(V.TURNOVER_BUCKETS.map(b => b[2]), ['עד מיליון', '1–3 מיליון', '3–5 מיליון', '5–10 מיליון', '10–20 מיליון', 'מעל 20 מיליון']);
  const emp = V.SLICES.find(x => x.id === 'employees');
  const tur = V.SLICES.find(x => x.id === 'turnover');
  const cases = [[0, '0 (רק הבעלים)'], [2, '1–2'], [3, '3–5'], [10, '6–10'], [11, '11–20'], [50, '21–50'], [51, '51+'], [null, 'לא צוין']];
  for (const [n, k] of cases) assert.equal(emp.key({ employees_count: n, staff: 'veteran' }), k, String(n));
  for (const [n, k] of [[999999, 'עד מיליון'], [1000000, '1–3 מיליון'], [4500000, '3–5 מיליון'], [5000000, '5–10 מיליון'], [19999999, '10–20 מיליון'], [20000000, 'מעל 20 מיליון'], [null, 'לא צוין']])
    assert.equal(tur.key({ annual_turnover: n }), k, String(n));
  const rows = [{ employees_count: 4 }, { employees_count: null }, { employees_count: 0 }, { employees_count: 60 }];
  assert.deepEqual(V.breakdown(rows, emp).map(e => e.key), ['0 (רק הבעלים)', '3–5', '51+', 'לא צוין']);
  assert.equal(V.employeesText({ employees_count: 0 }), '0 (רק הבעלים)');
  assert.equal(V.employeesText({ employees_count: 12 }), '12 עובדים');
  assert.equal(V.employeesText({}), '—');
  assert.equal(V.turnoverText({ annual_turnover: 2500000 }), '₪2.5M');
  // details panel keeps seniority and business age; the row shows headcount · turnover
  assert.ok(V.QUESTIONS.some(q => q[0] === 'staff') && V.QUESTIONS.some(q => q[0] === 'business_age'));
  assert.match(js, /detailRow\('מספר עובדים'/);
  assert.match(js, /detailRow\('מחזור שנתי'/);
  assert.match(js, /class="c-size"/);
  assert.ok(page.includes('<span>עובדים · מחזור</span>'));
});

test('v2 db: optional employees/turnover, never a 400, calc untouched, rollback keeps data', () => {
  assert.match(sql2, /add column if not exists employees_count integer/);
  assert.match(sql2, /add column if not exists annual_turnover numeric/);
  assert.match(sql2, /employees_count between 0 and 100000/);
  assert.match(sql2, /annual_turnover between 0 and 10000000000/);
  assert.ok(!/valuation_calc\(text, numeric, jsonb\)\s*returns/.test(sql2), 'valuation_calc not redefined');
  assert.ok(!/raise exception[^;]*(employees|turnover)/.test(sql2), 'no rejection for the new keys');
  assert.match(sql2, /grant execute on function public\.submit_valuation_request\(jsonb\) to anon, authenticated;/);
  assert.ok(!/^\s*alter table[^;]*drop column/im.test(rb2), 'rollback keeps the columns');
});

const sql3 = read('supabase/migrations/20261124221000_valuation_attempt_ordinal_and_repeat_alert.sql');
const rb3 = read('supabase/migrations/rollback_20261124221000_valuation_attempt_ordinal_and_repeat_alert.sql');

test('v3: pad to 3 digits, repeat badge from attempt 2, 6th slice, summary counts', () => {
  assert.equal(V.padRequestNumber(1), '001');
  assert.equal(V.padRequestNumber(2), '002');
  assert.equal(V.padRequestNumber(100), '100');
  assert.equal(V.padRequestNumber(null), '—');
  assert.equal(V.visitorAttemptLabel({ visitor_attempt_no: 1 }), 'בקשה 1 של המבקר');
  assert.equal(V.visitorAttemptLabel({ visitor_attempt_no: 3 }), 'בקשה 3 של המבקר');
  assert.equal(V.visitorAttemptLabel({}), '');
  assert.equal(V.isRepeatVisitor({ visitor_attempt_no: 1 }), false);
  assert.equal(V.isRepeatVisitor({ visitor_attempt_no: 2 }), true);
  assert.deepEqual(V.SLICES.map(x => x.id), ['sector', 'employees', 'value', 'profit', 'turnover', 'repeat']);
  assert.equal(V.SLICES[5].title, 'שימוש חוזר / חסימות');
  const rows = [
    { id: 'a', created_at: '2026-11-24T10:00:00Z', visitor_key: 'vid:11111111-1111-4111-8111-111111111111', visitor_attempt_no: 1, profit: 300000, result_kind: 'range', value_low: 300000, value_high: 600000 },
    { id: 'b', created_at: '2026-11-24T11:00:00Z', visitor_key: 'vid:11111111-1111-4111-8111-111111111111', visitor_attempt_no: 2, profit: 310000, result_kind: 'range', value_low: 310000, value_high: 620000 },
    { id: 'c', created_at: '2026-11-24T12:00:00Z', visitor_key: 'vid:22222222-2222-4222-8222-222222222222', visitor_attempt_no: 1, profit: 200000, result_kind: 'range', value_low: 200000, value_high: 400000 }
  ];
  const blocks = [{ attempt_no: 4, visitor_key: 'vid:11111111-1111-4111-8111-111111111111', is_test: false }];
  const s = V.summarize(rows, blocks);
  assert.equal(s.repeatVisitors, 1);
  assert.equal(s.blockedAttempts, 1);
  assert.equal(s.total, 3);
  assert.match(js, /from\('valuation_request_blocks'\)\.select\('\*'\)/);
  assert.match(js, /badge-rep/);
  assert.ok(page.includes('בקשה של המבקר'));
  assert.ok(page.includes('sumRepeat') && page.includes('sumBlocks'));
  assert.ok(page.includes('שימוש חוזר') || js.includes('שימוש חוזר / חסימות'));
  assert.match(js, /⚠ שימוש חוזר/);
});

test('v3 db: visitor_attempt_no on success, blocks keep attempt_no, alert path does not flip send flags', () => {
  assert.match(sql3, /visitor_attempt_no/);
  assert.match(sql3, /attempt_no integer/);
  assert.match(sql3, /valuation_repeat_alert_auth/);
  assert.match(sql3, /valuation_repeat_alert_sends/);
  assert.match(sql3, /valuation_request_blocks_notify/);
  assert.match(sql3, /valuation-repeat-alert/);
  assert.match(sql3, /x-bsd-valuation-alert-token/);
  assert.match(sql3, /valuation_repeat_alert_send_test/);
  assert.ok(!/update[^;]*(sending_enabled|dry_run|vip_send_enabled|request_details_enabled|bsd_alert_dispatch_auth)/is.test(sql3));
  assert.ok(!/set\s+(sending_enabled|dry_run|vip_send_enabled|request_details_enabled)/i.test(sql3));
  assert.match(rb3, /drop trigger if exists valuation_request_blocks_notify_trg/);
  assert.match(rb3, /drop function if exists public\.valuation_request_blocks_notify/);
  assert.match(rb3, /create or replace function public\.submit_valuation_request\(p jsonb\)/);
});
