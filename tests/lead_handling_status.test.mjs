// 09.10.2026 (בקשת ברוך): «מצב טיפול» בכרטיס הליד (leads-hub.html) - leads.handling_status.
// ארבעה ערכים בדיוק, ברירת מחדל «לא טופל», רשימה נפתחת בלבד (בלי כפתור חדש),
// נשמרת דרך «שמור» / «שמור והעבר», ונשלחת לשרת רק אם שונתה בכרטיס.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const hub = read('leads-hub.html');
const VALUES = ['לא טופל', 'טופל', 'סטנד ביי', 'לחזור עם תשובה'];
function fnSrc(src, name){
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, name + ' missing');
  let i = src.indexOf('{', src.indexOf(')', start)), depth = 0;
  for (; i < src.length; i++){ if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const consts = hub.slice(hub.indexOf('const LEAD_HANDLING_STATUSES'), hub.indexOf('function leadHandlingStatusValue('));
function load(extra = {}){
  const c = { esc, ...extra }; vm.createContext(c);
  vm.runInContext(consts.replace(/^const /gm, 'var '), c);
  for (const n of ['leadHandlingStatusValue', 'leadHandlingStatusFieldHtml', 'leadHandlingStatusEdit']) vm.runInContext(fnSrc(hub, n), c);
  return c;
}
const options = html => [...html.matchAll(/<option value="([^"]*)"\s*(selected)?>([^<]*)<\/option>/g)].map(m => ({ value: m[1], selected: !!m[2], label: m[3] }));

test('field: exactly the four options in order, a select only (no button), tablet/phone friendly', () => {
  const c = load();
  assert.deepEqual([...c.LEAD_HANDLING_STATUSES], VALUES);
  const html = c.leadHandlingStatusFieldHtml({ handling_status: 'סטנד ביי' });
  assert.match(html, /<label for="wlHandlingStatus"[^>]*>מצב טיפול<\/label>/);
  assert.deepEqual(options(html).map(o => o.value), VALUES);
  assert.deepEqual(options(html).map(o => o.label), VALUES);
  assert.deepEqual(options(html).filter(o => o.selected).map(o => o.value), ['סטנד ביי']);
  assert.ok(!/<(button|input|textarea|a)\b/.test(html), 'no new buttons or other fields');
  assert.match(html, /width:100%;max-width:100%;box-sizing:border-box/);
  assert.match(html, /font-size:16px/, 'no iOS zoom on focus');
  assert.match(html, /min-height:44px/, 'touch target');
  assert.match(html, /data-orig="סטנד ביי"/);
});

test('default «לא טופל» for new/old rows and unknown values', () => {
  const c = load();
  for (const r of [null, {}, { handling_status: null }, { handling_status: '' }, { handling_status: 'משהו אחר' }]){
    assert.equal(c.leadHandlingStatusValue(r), 'לא טופל');
    assert.deepEqual(options(c.leadHandlingStatusFieldHtml(r)).filter(o => o.selected).map(o => o.value), ['לא טופל']);
  }
  for (const v of VALUES) assert.equal(c.leadHandlingStatusValue({ handling_status: v }), v);
});

test('save: sent only when changed on the card; invalid value is refused; no card = nothing', () => {
  const el = { value: 'לא טופל', dataset: { orig: 'לא טופל' } };
  const c = load({ document: { getElementById: id => id === 'wlHandlingStatus' ? el : null } });
  assert.equal(c.leadHandlingStatusEdit(), undefined);
  el.value = 'לחזור עם תשובה'; assert.equal(c.leadHandlingStatusEdit(), 'לחזור עם תשובה');
  el.dataset.orig = 'טופל'; el.value = 'טופל'; assert.equal(c.leadHandlingStatusEdit(), undefined);
  el.value = 'לא טופל'; assert.equal(c.leadHandlingStatusEdit(), 'לא טופל');
  el.value = 'x'; assert.throws(() => c.leadHandlingStatusEdit(), /מצב טיפול/);
  const none = load({ document: { getElementById: () => null } });
  assert.equal(none.leadHandlingStatusEdit(), undefined);
});

test('card wiring: shown under the card header near «סטטוס», read by the shared payload of «שמור» and «שמור והעבר», locked while saving', () => {
  const form = fnSrc(hub, 'renderWebsiteLeadConversationForm');
  const at = form.indexOf('${leadHandlingStatusFieldHtml(r)}');
  assert.ok(at > form.indexOf("סטטוס: <b>") && at < form.indexOf('id="wlName"'));
  const payload = fnSrc(hub, 'readLeadCardPayload');
  assert.match(payload, /const handlingStatus = leadHandlingStatusEdit\(\);\s*if \(handlingStatus !== undefined\) payload\.handling_status = handlingStatus;/);
  assert.match(fnSrc(hub, 'saveLeadOnly'), /readLeadCardPayload\(source\.data\)/);
  assert.match(fnSrc(hub, 'saveWebsiteLeadTransfer'), /readLeadCardPayload\(source\.data\)/);
  assert.match(fnSrc(hub, 'setLeadCardBusy'), /if \(handling\) handling\.disabled = busy;/);
  assert.match(fnSrc(hub, 'openReadOnly'), /\['מצב טיפול', leadHandlingStatusValue\(r\)\]/);
});

test('migration: additive column, NOT NULL default «לא טופל», CHECK with the four values; rollback drops only it', () => {
  const sql = read('migrations/2026-10-09_lead_handling_status.sql');
  assert.match(sql, /add column if not exists handling_status text not null default 'לא טופל'/);
  assert.match(sql, /check \(handling_status in \('לא טופל','טופל','סטנד ביי','לחזור עם תשובה'\)\)/);
  assert.ok(!/\b(drop|update|delete|truncate)\b/i.test(sql.replace(/^--.*$/gm, '')), 'additive only');
  const undo = read('migrations/2026-10-09_lead_handling_status_rollback.sql').replace(/^--.*$/gm, '');
  assert.deepEqual(undo.trim().split('\n'), [
    'alter table public.leads drop constraint if exists leads_handling_status_check;',
    'alter table public.leads drop column if exists handling_status;']);
});
