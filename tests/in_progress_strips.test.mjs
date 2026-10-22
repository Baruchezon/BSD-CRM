// 22.10.2026: «לקוחות בטיפול» (and returned cards on «לידים», same stagedRowHtml)
// render as a one-line strip. «לידים 2026» keeps its own table.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../leads-hub.html', import.meta.url), 'utf8');

function render(record, callOn){
  const start = html.indexOf('function stagedStripSource(');
  const end = html.indexOf('function canEditRecord(');
  const code = html.slice(start, end);
  const c = {
    record,
    result: '',
    CURRENT_TAB: 'in_progress',
    stagedTable: r => r.__staged === 'business' ? 'businesses' : 'leads',
    canEditRecord: () => true,
    canSendAgreement: () => true,
    notesTooltip: () => 'הערות',
    fmtDate: iso => iso ? '22.10.2026' : '—',
    esc(s){ if (s === undefined || s === null) return ''; return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  };
  vm.createContext(c);
  vm.runInContext(code + `\nresult = stagedRowHtml(record, ${callOn ? 'true' : 'false'});`, c);
  return c.result;
}

const longNotes = 'הערה ארוכה מאוד שחוזרת על עצמה '.repeat(40);

test('in-progress business and lead render as one compact strip with key fields only', () => {
  const biz = render({
    id: 'b1', __staged: 'business', crm_stage: 'in_progress', created_by: 'u',
    internal_name: 'מסעדה ארוכה מאוד בשם שלא נגמר באמצע הרחוב הראשי',
    business_number: 'BSD-B-1042', owner_phone: '0501234567', source: '',
    agreement_status: 'נשלח הסכם לחתימה', crm_stage_changed_at: '2026-10-22T12:00:00Z',
    notes: longNotes, city: 'תל אביב', owner_name: 'דנה'
  }, false);
  const lead = render({
    id: 'l1', __staged: 'buyer', crm_stage: 'in_progress', created_by: 'u',
    full_name: 'יוסי כהן', client_number: 'BSD-C-88', phone: '0520000000',
    source: 'אתר BSD החדש', status: 'ממתין לשיחה', notes: longNotes
  }, false);
  for (const row of [biz, lead]){
    assert.match(row, /class="staged-strip"/);
    assert.match(row, /class="crm-strip"/);
    assert.match(row, /crm-strip-ellip/);
    assert.match(row, /onclick="openStagedCard\('/);
    assert.match(row, /toggleFormsMenu\(event\)/);
    assert.match(row, /החזר ללידים/);
    assert.equal(row.includes(longNotes.trim()), false);
    assert.equal((row.match(/<tr\b/g) || []).length, 1);
    assert.equal((row.match(/<td\b/g) || []).length, 1);
  }
  assert.match(biz, /data-staged="business"/);
  assert.match(biz, />עסק</);
  assert.match(biz, /BSD-B-1042/);
  assert.match(biz, /מקור: עסקים/);
  assert.match(biz, /נשלח הסכם לחתימה · 22\.10\.2026/);
  assert.match(lead, /data-staged="lead"/);
  assert.match(lead, />ליד</);
  assert.match(lead, /BSD-C-88/);
  assert.match(lead, /מקור: מהאתר/);
  assert.match(lead, /openStagedCard\('l1'\)/);
});

test('returned-to-leads rows use the same strip and keep the move-to-in-progress action', () => {
  const row = render({
    id: 'b2', __staged: 'business', crm_stage: 'lead', created_by: 'u',
    internal_name: 'מאפייה', owner_phone: '0509999999', source: 'פייסבוק',
    notes: longNotes
  }, true);
  assert.match(row, /colspan="8"/);
  assert.match(row, /class="crm-strip"/);
  assert.match(row, /העבר ללקוחות בטיפול/);
  assert.match(row, /מקור: פייסבוק/);
  assert.match(row, /0509999999/);
  assert.equal(row.includes('notes-cell'), false);
  assert.equal(row.includes(longNotes.trim()), false);
});

test('strip CSS is a single line with text-overflow ellipsis, including on mobile', () => {
  const css = html.slice(html.indexOf('.crm-strip{'), html.indexOf('.crm-strip-menu{'));
  assert.match(css, /height:40px/);
  assert.match(css, /max-height:40px/);
  assert.match(css, /white-space:nowrap/);
  assert.match(css, /overflow:hidden/);
  assert.match(html, /\.crm-strip-ellip\{[^}]*text-overflow:ellipsis/);
  assert.match(html, /\.crm-strip-ellip\{[^}]*white-space:nowrap/);
  assert.match(html, /@media \(max-width:700px\)\{[\s\S]*table tr\.staged-strip > td\{display:block/);
});

test('לידים 2026 does not use the compact strip', () => {
  const review = html.slice(html.indexOf('async function renderY2026ReviewTable'), html.indexOf('function y2026AgreementSummary'));
  assert.equal(review.includes('crm-strip'), false);
  assert.equal(review.includes('stagedRowHtml'), false);
  const table = html.slice(html.indexOf('function renderTable()'), html.indexOf('function leadSourceBadge'));
  assert.match(table, /if \(r\.__staged\) return stagedRowHtml/);
  const y2026 = table.slice(table.indexOf("CURRENT_TAB === 'y2026'"));
  assert.equal(y2026.includes('crm-strip'), false);
  assert.equal(y2026.includes('stagedRowHtml'), false);
  assert.match(y2026, /notes-cell/);
});

test('in-progress tab switches the shared table into strip mode; other tabs do not', () => {
  const head = html.slice(html.indexOf('function renderLeadsTableHead()'), html.indexOf('async function setLeadCallStatus'));
  assert.match(head, /CURRENT_TAB === 'in_progress'/);
  assert.match(head, /staged-strips/);
});
