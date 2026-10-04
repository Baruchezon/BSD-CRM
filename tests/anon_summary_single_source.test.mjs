// 04.10.2026 - the anonymous summary lives in ONE field (businesses.anon_summary),
// AI approve saves straight into it and stays on the same screen, and no save
// writes stale text over it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
const start = html.indexOf('const BIZ_GUARDED_TEXT_FIELDS');
const end = html.indexOf('// שלב 1: יצירת טיוטה בלבד');
assert.ok(start > 0 && end > start, 'helper block found');
const code = html.slice(start, end);
const J = x => JSON.parse(JSON.stringify(x));
const stripComments = src => src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const fnBody = name => { const i = html.indexOf(name); assert.ok(i > 0, name); return html.slice(i, html.indexOf('\n}\n', i)); };

function harness({ server = {}, form = {}, baseline = null, cached = null, failRead = false } = {}) {
  const BIZ = 'biz-1';
  const row = { id: BIZ, updated_at: 't0', version: 1, anon_card_active: false, internal_name: 'הנחלה', owner_name: 'ישראל ישראלי', ...server };
  const writes = [], logs = [], toasts = [], cacheSets = [];
  const els = {};
  const el = (id, value) => (els[id] = { id, value, textContent: '', innerHTML: '', style: {}, dataset: {}, disabled: false, addEventListener() {}, scrollIntoView() {}, focus() {} });
  el('bizForm', ''); els.bizForm.dataset.bizId = BIZ;
  for (const [k, v] of Object.entries(form)) el(k, v);
  ['anonSummaryCount', 'saveAnonSummaryStatus', 'genAnonSummaryStatus', 'anonReadyBadge', 'anonGeneratedInfo', 'anonStaleWarning', 'bizFormError', 'saveAnonSummaryBtn'].forEach(id => el(id, ''));
  const db = {
    from() {
      let action = 'select', values;
      const q = { select() { return q; }, eq() { return q; }, update(v) { action = 'update'; values = v; return q; },
        maybeSingle() { return run(); }, then(ok, bad) { return run().then(ok, bad); } };
      async function run() {
        if (action === 'update') { writes.push({ ...values }); Object.assign(row, values, { updated_at: 't' + writes.length }); return { error: null }; }
        if (failRead) return { data: null, error: { message: 'down' } };
        return { data: { ...row }, error: null };
      }
      return q;
    },
  };
  const ALL_BIZ = [cached || { ...row }];
  const ctx = {
    window: { supabaseClient: db, BSDDataCache: { get: () => [{ id: BIZ, anon_summary: 'old' }], set: (k, u, v) => cacheSets.push(v), remove() {} } },
    document: { getElementById: id => els[id] || null, querySelector: () => null },
    ALL_BIZ, ARCHIVED_BIZ: [], CURRENT_PROFILE: { id: 'u1' },
    toast: m => toasts.push(m), bsdLogActivity: (...a) => logs.push(a), fmtDateTime: v => String(v), refreshAnonStaleWarning() {},
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.api={bsdPlanGuardedTextSave,bsdNormText,bsdAnonLeakScan,bsdSaveAnonSummaryOnly,bsdAfterAnonSaved,bsdResolveBizConflict,bsdCaptureBizFormBaseline,get baseline(){return BIZ_FORM_BASELINE},set baseline(v){BIZ_FORM_BASELINE=v}};', ctx);
  if (baseline) ctx.api.baseline = baseline;
  const raw = ctx.api;
  const api = new Proxy(raw, { get(t, k) { const v = t[k]; if (k === 'bsdPlanGuardedTextSave' || k === 'bsdAnonLeakScan') return (...a) => J(v(...a)); return v; } });
  return { api, row, writes, els, toasts, logs, cacheSets, ALL_BIZ, BIZ };
}

const LONG = Array.from({ length: 400 }, (_, i) => `שורה ${i + 1}: מחזור חודשי 180,000 ₪, שכירות 6% מהמחזור.`).join('\n');

test('plan: untouched fields are not sent, so a stale form can never write old text back', () => {
  const { api } = harness();
  const b = { form: { anon_summary: 'A', notes: 'N' }, db: { anon_summary: 'A', notes: 'N' } };
  const p = api.bsdPlanGuardedTextSave(b, { anon_summary: 'A', notes: 'N' }, { anon_summary: 'NEW ON SERVER' }, null);
  assert.deepEqual(p.skipped.sort(), ['anon_summary', 'notes']);
  assert.deepEqual(Object.keys(p.send), []);
});

test('plan: my change is sent when nobody else changed the field; conflict when the server changed it', () => {
  const { api } = harness();
  const b = { form: { anon_summary: 'A' }, db: { anon_summary: 'A' } };
  assert.deepEqual(api.bsdPlanGuardedTextSave(b, { anon_summary: 'B' }, { anon_summary: 'A' }).send, { anon_summary: 'B' });
  const c = api.bsdPlanGuardedTextSave(b, { anon_summary: 'B' }, { anon_summary: 'C' });
  assert.deepEqual(c.conflicts, ['anon_summary']); assert.deepEqual(c.send, {});
  assert.deepEqual(api.bsdPlanGuardedTextSave(b, { anon_summary: 'C' }, { anon_summary: 'C' }).conflicts, [], 'same text on both sides is not a conflict');
  assert.deepEqual(api.bsdPlanGuardedTextSave(b, { anon_summary: 'A' }, { anon_summary: 'A' }, { anon_summary: true }).send, { anon_summary: 'A' }, 'forced (AI edit) is sent');
  assert.deepEqual(api.bsdPlanGuardedTextSave(null, { anon_summary: 'X' }, null).send, { anon_summary: 'X' }, 'new business: no baseline, legacy behaviour');
});

test('plan: Windows line endings are not a change; long text passes through untouched', () => {
  const { api } = harness();
  const b = { form: { anon_summary: 'a\nb' }, db: { anon_summary: 'a\nb' } };
  assert.deepEqual(api.bsdPlanGuardedTextSave(b, { anon_summary: 'a\r\nb' }, null).skipped, ['anon_summary']);
  const p = api.bsdPlanGuardedTextSave(b, { anon_summary: LONG }, { anon_summary: 'a\r\nb' });
  assert.equal(p.send.anon_summary, LONG);
});

test('leak scan: phone / email / link / real names are caught', () => {
  const { api } = harness();
  const leaks = api.bsdAnonLeakScan([['תקציר', 'התקשרו 052-1234567 או a@b.co www.x.co ישראל ישראלי']], ['ישראל ישראלי', 'ab']);
  assert.equal(leaks.length, 4);
  assert.deepEqual(api.bsdAnonLeakScan([['תקציר', LONG]], ['הנחלה']), []);
});

test('save in the one place: full text with line breaks, only the summary field is written', async () => {
  const h = harness({ server: { anon_summary: 'ישן', anon_display_name: 'חנות ירקות' }, form: { anon_summary: LONG, anon_display_name: 'חנות ירקות', internal_name: 'הנחלה', owner_name: 'ישראל ישראלי' },
    baseline: { bizId: 'biz-1', form: { anon_summary: 'ישן', anon_display_name: 'חנות ירקות' }, db: { anon_summary: 'ישן', anon_display_name: 'חנות ירקות' } } });
  await h.api.bsdSaveAnonSummaryOnly('biz-1');
  assert.equal(h.writes.length, 1);
  assert.deepEqual(Object.keys(h.writes[0]), ['anon_summary']);
  assert.equal(h.row.anon_summary, LONG, 'saved in full, no cap, line breaks kept');
  assert.equal(h.els.anon_summary.value, LONG);
  assert.match(h.els.saveAnonSummaryStatus.textContent, /נשמר במלואו/);
  assert.equal(h.api.baseline.form.anon_summary, LONG, 'baseline moves forward so the next form save will not resend it');
  assert.ok(h.cacheSets.length >= 1, 'daily page cache updated with the fresh row');
});

test('save in the one place: someone else changed it meanwhile → nothing is overwritten until the user chooses', async () => {
  const h = harness({ server: { anon_summary: 'נוסח של ברוך מהשרת', anon_display_name: 'X' }, form: { anon_summary: 'הנוסח שלי', anon_display_name: 'X' },
    baseline: { bizId: 'biz-1', form: { anon_summary: 'ישן', anon_display_name: 'X' }, db: { anon_summary: 'ישן', anon_display_name: 'X' } } });
  await h.api.bsdSaveAnonSummaryOnly('biz-1');
  assert.equal(h.writes.length, 0);
  assert.equal(h.row.anon_summary, 'נוסח של ברוך מהשרת');
  assert.match(h.els.saveAnonSummaryStatus.innerHTML, /עודכן במקום אחר/);
  h.api.bsdResolveBizConflict('mine');
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.equal(h.row.anon_summary, 'הנוסח שלי', 'explicit choice saves my version');
});

test('save in the one place: identifying details are blocked before anything is written', async () => {
  const h = harness({ form: { anon_summary: 'בעלים: ישראל ישראלי 052-1234567', anon_display_name: 'X', owner_name: 'ישראל ישראלי' },
    baseline: { bizId: 'biz-1', form: { anon_summary: '', anon_display_name: 'X' }, db: { anon_summary: '', anon_display_name: 'X' } } });
  await h.api.bsdSaveAnonSummaryOnly('biz-1');
  assert.equal(h.writes.length, 0);
  assert.match(h.els.saveAnonSummaryStatus.textContent, /מידע מזהה/);
});

test('AI approve result is put in place: field, cache, baseline, badge - no rebuild of the card', async () => {
  const approved = 'תחום פעילות:\nירקות\n\nנתונים מרכזיים:\n• מחזור חודשי 180,000 ₪\n• שכירות 6% מהמחזור';
  const h = harness({ server: { anon_summary: approved, anon_display_name: 'חנות ירקות', anon_summary_generated_at: '2026-10-04T18:00:00Z' }, form: { anon_summary: 'ישן', anon_display_name: 'ישן' },
    baseline: { bizId: 'biz-1', form: { anon_summary: 'ישן', anon_display_name: 'ישן' }, db: { anon_summary: 'ישן', anon_display_name: 'ישן' } } });
  await h.api.bsdAfterAnonSaved('biz-1', { anon_summary: approved, anon_display_name: 'חנות ירקות' }, 'ai');
  assert.equal(h.els.anon_summary.value, approved);
  assert.equal(h.els.anon_display_name.value, 'חנות ירקות');
  assert.equal(h.ALL_BIZ[0].anon_summary, approved, 'in-memory list refreshed from the server');
  assert.equal(h.api.baseline.db.anon_summary, approved);
  assert.match(h.els.genAnonSummaryStatus.textContent, /נשמר במלואו/);
  assert.match(h.els.anonReadyBadge.textContent, /מוכן/);
});

test('approve flows no longer reload the list and reopen the card (that jumped to «פרטי עסק» with stale text)', () => {
  for (const name of ['async function confirmAnonDraft(', 'async function confirmInternalSummaryDraft(']) {
    const body = stripComments(fnBody(name));
    assert.doesNotMatch(body, /openBizForm\(|loadBusinesses\(/, name);
  }
  assert.match(fnBody('async function confirmAnonDraft('), /bsdAfterAnonSaved\(/);
});

test('regular save is guarded and silent AI auto-overwrite is off', () => {
  const save = fnBody('async function saveBiz(');
  assert.match(save, /bsdPlanGuardedTextSave\(BIZ_FORM_BASELINE, formVals, latest, force\)/);
  assert.match(save, /plan\.skipped\.forEach\(f => \{ delete payload\[f\]; \}\)/);
  assert.match(html, /const ANON_AUTO_REFRESH_ENABLED = false;/);
  assert.match(fnBody('async function maybeAutoRefreshAnonSummary('), /if \(!ANON_AUTO_REFRESH_ENABLED\)\{[\s\S]*?return;/);
});

test('display keeps line breaks and full text everywhere the published summary is shown', () => {
  const listings = fs.readFileSync(new URL('../listings.html', import.meta.url), 'utf8');
  assert.match(listings, /\.card-body \.desc\{[^}]*white-space:pre-wrap/);
  assert.match(html, /white-space:pre-wrap;">\$\{esc\(b\.anon_summary\)\}/, 'buyer-match card');
  assert.match(html, /white-space:pre-wrap;max-height:50vh;overflow-y:auto;">\$\{esc\(biz\.anon_summary\)\}/, 'preview card');
  assert.doesNotMatch(html, /anon_summary[^\n]{0,40}\.(slice|substring|substr)\(/, 'no truncation of the summary');
});

test('site admin no longer writes the summary (one editor only)', () => {
  const js = fs.readFileSync(new URL('../js/site-admin-v2.js', import.meta.url), 'utf8');
  const save = js.slice(js.indexOf('async function saveBusiness('), js.indexOf('\n', js.indexOf('async function saveBusiness(')));
  assert.doesNotMatch(save, /anon_summary:|anon_display_name:/);
  const page = fs.readFileSync(new URL('../site-admin-v3.html', import.meta.url), 'utf8');
  assert.match(page, /id="bizSummary" class="textarea" readonly/);
});
