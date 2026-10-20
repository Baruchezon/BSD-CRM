// 20.10.2026 (בקשת ברוך): «קובי (מטבחים)» — שם + סוגריים עם שם העסק / תחום, בלידים ידניים ומהאתר בלבד.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const hub = fs.readFileSync(new URL('../leads-hub.html', import.meta.url), 'utf8');
function fnSrc(name){
  const start = hub.search(new RegExp(`function ${name}\\(`)); assert.ok(start >= 0, name);
  let i = hub.indexOf('{', hub.indexOf(')', start)), d = 0;
  for (; i < hub.length; i++){ if (hub[i]==='{') d++; else if (hub[i]==='}' && --d===0) break; }
  return hub.slice(start, i + 1);
}
const c = {}; vm.createContext(c);
vm.runInContext(fnSrc('leadBusinessLabel') + fnSrc('leadNameWithBusinessLabel'), c);
test('priority: business_name > label > business_field > requested_field', () => {
  assert.equal(c.leadNameWithBusinessLabel('קובי', { business_name: 'מטבחי קובי', lead_business_label: 'מטבחים' }), 'קובי (מטבחי קובי)');
  assert.equal(c.leadNameWithBusinessLabel('קובי', { lead_business_label: 'מטבחים', business_field: 'x' }), 'קובי (מטבחים)');
  assert.equal(c.leadNameWithBusinessLabel('נתנאל', { business_field: 'בית קפה' }), 'נתנאל (בית קפה)');
  assert.equal(c.leadNameWithBusinessLabel('דני', { requested_field: ' מינימרקט ' }), 'דני (מינימרקט)');
});
test('no label -> no brackets, nothing invented', () => {
  assert.equal(c.leadNameWithBusinessLabel('יוסי', { intake_conversation_summary: 'מתעניין במאפייה' }), 'יוסי');
  assert.equal(c.leadNameWithBusinessLabel('—', { business_name: 'x' }), '—');
});
test('long labels are shortened', () => {
  assert.ok(c.leadBusinessLabel({ requested_field: 'א'.repeat(50) }).length <= 30);
});
test('only manual/website tabs use it', () => {
  assert.match(fnSrc('rowNameCell'), /CURRENT_TAB === 'manual' \|\| CURRENT_TAB === 'seller'\) \? leadNameWithBusinessLabel/);
  assert.match(fnSrc('isCallStatusTab'), /'manual'.*'seller'/);
});
