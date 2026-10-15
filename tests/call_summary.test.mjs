import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

test('bidi layout keeps a hebrew run logical for fontkit and wraps in logical order', () => {
  const visual = read('supabase/functions/exm-call-summary/visual.mjs');
  assert.match(visual, /from 'npm:bidi-js@1\.0\.3'/);
  assert.match(visual, /export function visualRuns/);
  // fontkit shapes Hebrew itself, so the hebrew run is returned in logical order
  assert.match(visual, /r\.hebrew \? \[\.\.\.r\.chars\]\.reverse\(\) : r\.chars/);
  assert.doesNotMatch(visual, /export function visualLine/);
  const wrap = visual.slice(visual.indexOf('export function wrapLogical')).replace(/^export /m, '');
  const c = {};
  vm.createContext(c);
  vm.runInContext(wrap + '\nthis.wrapLogical = wrapLogical;\n', c);
  const wrapped = c.wrapLogical('אחת שתיים שלוש', 6, v => v.length);
  assert.ok(wrapped.length > 1);
  assert.ok(wrapped.join(' ').includes('אחת'));
});

test('migration is additive: lead_documents, summary columns, admin RLS, leads/ storage, cron', () => {
  const sql = read('supabase/migrations/20261014220000_lead_documents_call_summary.sql');
  assert.match(sql, /create table if not exists public\.lead_documents/);
  assert.match(sql, /lead_id uuid not null references public\.leads\(id\) on delete cascade/);
  assert.match(sql, /category text not null default 'קובץ הקלטה'/);
  assert.match(sql, /using \(public\.is_admin\(\)\)/);
  assert.match(sql, /add column if not exists summary_status text not null default 'none'/);
  assert.match(sql, /add column if not exists summary_doc_id uuid/);
  assert.match(sql, /add column if not exists transcript text/);
  assert.match(sql, /summary_status = 'queued'/);
  assert.match(sql, /recording_status = 'available'/);
  assert.match(sql, /answered is true/);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = 'leads'/);
  assert.match(sql, /bsd-exm-call-summary-10min/);
  assert.match(sql, /'\*\/10 \* \* \* \*'/);
  assert.match(sql, /summary_attempts < 3/);
  const rollback = read('docs/call-summary-rollback.sql');
  assert.match(rollback, /drop table if exists public\.lead_documents/);
  assert.match(rollback, /cron\.unschedule\('bsd-exm-call-summary-10min'\)/);
  assert.match(rollback, /drop column if exists summary_status/);
});

test('summary function is token-guarded and uses whisper-1 plus claude-sonnet-5', () => {
  const src = read('supabase/functions/exm-call-summary/index.ts');
  assert.match(src, /x-bsd-token/);
  assert.match(src, /bsd_exm_secret/);
  assert.match(src, /EXM_API_KEY/);
  assert.match(src, /whisper-1/);
  assert.match(src, /language', 'he'/);
  assert.match(src, /claude-sonnet-5/);
  assert.match(src, /summary_status: 'done'/);
  assert.match(src, /research_status: 'done'/);
  assert.match(src, /leads\/\$\{call\.lead_id\}/);
  assert.match(src, /regenerate_call_id/);
  const pdf = read('supabase/functions/exm-call-summary/pdf.ts');
  assert.match(pdf, /embedFont/);
  assert.match(pdf, /noto-sans-hebrew@5\.2\.8/);
  assert.match(pdf, /hebrew-400-normal\.ttf/);
  assert.match(pdf, /latin-400-normal\.ttf/);
  assert.match(pdf, /visualRuns/);
  assert.match(read('supabase/functions/exm-call-summary/font.ts'), /HEBREW_FONT_B64/);
  assert.match(src, /summary_attempts \|\| 0\) >= 3 \? 'error' : 'queued'/);
  assert.doesNotMatch(src, /saleFile|whatsapp-send|whatsapp-webhook/);
});

test('lead card lists documents and conversion copies buyer_id or business_id', () => {
  const hub = read('leads-hub.html');
  assert.match(hub, /data-lead-docs data-lead-id=/);
  assert.match(hub, /carryLeadDocuments\(id, destination \? \{ business_id: destination\.id \} : \{ buyer_id: id \}\)/);
  assert.match(hub, /יש הקלטה/);
  assert.match(hub, /אין הקלטה/);
  assert.match(read('leads.html'), /data-lead-docs data-buyer-id=/);
  assert.match(read('businesses.html'), /data-lead-docs data-business-id=/);
  assert.match(read('calls.html'), /ממתינות לסיכום הקלטת שיחה/);
});

test('notes cell starts with the recording mark when the admin set is loaded', () => {
  const html = read('leads-hub.html');
  const start = html.indexOf('function rowNotesCell(');
  const code = html.slice(start, html.indexOf('function renderTable(', start));
  const c = { CURRENT_TAB: 'manual', esc: s => s };
  vm.createContext(c);
  vm.runInContext(code + '\nLEAD_HAS_RECORDING = new Set(["with"]);\n', c);
  assert.equal(c.rowNotesCell({ id: 'with', notes: 'הערה' }), 'יש הקלטה — הערה');
  assert.equal(c.rowNotesCell({ id: 'without', notes: '' }), 'אין הקלטה');
});
