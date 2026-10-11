// 11.10.2026 (Baruch, build 202610111800): the «ממוצע 3 שנים (2023–2025)» label from the
// econ-analysis fill is saved in businesses.financials_avg_meta and shown again on load.
// Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../js/econAnalysisFill.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
const mig = fs.readFileSync(new URL('../supabase/migrations/20261011122532_businesses_financials_avg_meta.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../docs/financials-avg-meta-rollback.sql', import.meta.url), 'utf8');
const J = v => JSON.parse(JSON.stringify(v));

// --- tiny DOM stub, enough for initCard / repaint / toggle / savePatch ---
function makeDom(values){
  const els = {};
  const mk = (id, value) => {
    const listeners = {};
    const label = { children: [], appendChild(c){ this.children.push(c); c.parentLabel = this; } };
    const el = { id, value: value === undefined ? '' : String(value), checked: false, disabled: false, dataset: {}, style: {}, innerHTML: '', textContent: '',
      parentElement: { querySelector: () => label }, label,
      addEventListener(t, fn){ (listeners[t] = listeners[t] || []).push(fn); },
      dispatchEvent(ev){ (listeners[ev.type] || []).forEach(fn => fn(ev)); },
      remove(){ delete els[this.id]; if (this.parentLabel){ const a = this.parentLabel.children; a.splice(a.indexOf(this), 1); } } };
    els[id] = el; return el;
  };
  Object.entries(values).forEach(([k, v]) => mk(k, v));
  mk('bizFinanceHeading', ''); mk('econFillPreview', '');
  const document = {
    getElementById: id => els[id] || null,
    createElement: () => mk('__tmp' + Math.random(), ''),
  };
  // createElement'd hints get their real id assigned later; re-key on id set
  const realCreate = document.createElement;
  document.createElement = () => { const e = realCreate(); const tmp = e.id; return new Proxy(e, { set(t, k, v){ if (k === 'id'){ delete els[tmp]; els[v] = t; } t[k] = v; return true; } }); };
  return { els, document };
}
function load(values){
  const { els, document } = makeDom(values);
  class Event { constructor(type){ this.type = type; } }
  const ctx = { window: {}, document, Event, console };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return { E: ctx.window.BSDEconFill, els, ctx };
}
const hint = (els, k) => els[k + '_econHint'] ? els[k + '_econHint'].textContent : '';
const SAVED = { annual_revenue: { label: 'ממוצע 3 שנים (2023–2025)', years: [2023, 2024, 2025], source_file_id: 'f-1', filled_at: '2026-10-11T12:00:00Z' },
  operating_profit: { label: 'ממוצע 3 שנים (2023–2025)', years: [2023, 2024, 2025], source_file_id: 'f-1', filled_at: '2026-10-11T12:00:00Z' },
  net_profit: { label: 'ממוצע 2 שנים (2024–2025)', years: [2024, 2025], source_file_id: 'f-1', filled_at: '2026-10-11T12:00:00Z' } };

test('migration is additive only, and the rollback removes only what it added', () => {
  const code = mig.replace(/--.*$/gm, '');
  assert.match(code, /add column if not exists financials_avg_meta jsonb/);
  assert.doesNotMatch(code, /drop column|alter column|update\s+public\.businesses|create (or replace )?view|policy|grant|revoke/i);
  assert.match(rollback, /drop column if exists financials_avg_meta/);
  assert.doesNotMatch(rollback.replace(/--.*$/gm, ''), /annual_revenue|net_profit|operating_profit/);
});

test('planMeta: fill wins while the value is kept; a hand edit drops only that field', () => {
  const { E } = load({});
  const base = { annual_revenue: '1000000', operating_profit: '200000', net_profit: '150000' };
  assert.deepEqual(J(E.planMeta(SAVED, null, base, base)), SAVED, 'nothing touched -> saved labels stay');
  const edited = { ...base, net_profit: '160000' };
  const out = J(E.planMeta(SAVED, null, base, edited));
  assert.deepEqual(Object.keys(out), ['annual_revenue', 'operating_profit']);
  assert.equal(J(E.planMeta(SAVED, null, base, { annual_revenue: '', operating_profit: '', net_profit: '' })), null, 'emptied fields carry no label');
  assert.deepEqual(J(E.planMeta(SAVED, null, base, { ...base, annual_revenue: '1,000,000' })).annual_revenue, SAVED.annual_revenue, 'same number, other formatting');
  const pending = { net_profit: { label: 'ממוצע 3 שנים (2022–2024)', years: [2022, 2023, 2024], source_file_id: 'f-2', filled_at: 'x', value: 120000 } };
  const filled = J(E.planMeta(SAVED, pending, base, { ...base, net_profit: '120000' }));
  assert.equal(filled.net_profit.label, 'ממוצע 3 שנים (2022–2024)');
  assert.equal(filled.net_profit.source_file_id, 'f-2');
  assert.ok(!('value' in filled.net_profit), 'the amount is never stored in the meta');
  assert.equal(filled.annual_revenue.label, SAVED.annual_revenue.label);
  const fillThenEdit = J(E.planMeta(SAVED, pending, base, { ...base, net_profit: '125000' }));
  assert.ok(!fillThenEdit.net_profit, 'edited after the fill -> its label goes, even though an older one was saved');
});

test('metaPatch: nothing sent when unchanged; null when every label is gone', () => {
  const { E } = load({});
  assert.deepEqual(J(E.metaPatch(SAVED, J(SAVED))), {});
  assert.deepEqual(J(E.metaPatch(null, null)), {});
  assert.deepEqual(J(E.metaPatch(SAVED, null)), { financials_avg_meta: null });
  assert.deepEqual(J(E.metaPatch(null, { net_profit: SAVED.net_profit })), { financials_avg_meta: { net_profit: SAVED.net_profit } });
  assert.equal(E.cleanMeta({ net_profit: { label: '' }, asking_price: { label: 'x' } }), null, 'only the three fields, only real labels');
  assert.equal(E.cleanMeta([1, 2]), null);
});

test('card open: saved labels painted; manual edit removes only that hint; save patch follows', () => {
  const { E, els } = load({ annual_revenue: '1000000', operating_profit: '200000', net_profit: '150000', asking_price: '900000' });
  E.initCard({ id: 'b-1', financials_avg_meta: SAVED });
  assert.equal(hint(els, 'annual_revenue'), 'ממוצע 3 שנים (2023–2025)');
  assert.equal(hint(els, 'net_profit'), 'ממוצע 2 שנים (2024–2025)');
  assert.equal(els.bizFinanceHeading.textContent, 'נתונים כספיים', 'labels differ -> plain heading');
  assert.deepEqual(J(E.savePatch('b-1')), {}, 'a plain save does not touch the column');
  els.net_profit.value = '170000'; els.net_profit.dispatchEvent({ type: 'input' });
  assert.equal(hint(els, 'net_profit'), '');
  assert.equal(hint(els, 'annual_revenue'), 'ממוצע 3 שנים (2023–2025)');
  assert.equal(els.bizFinanceHeading.textContent, 'נתונים כספיים · ממוצע 3 שנים (2023–2025)');
  const p = J(E.savePatch('b-1'));
  assert.deepEqual(Object.keys(p.financials_avg_meta), ['annual_revenue', 'operating_profit']);
  els.asking_price.value = '1'; // asking price never matters
  assert.deepEqual(Object.keys(J(E.savePatch('b-1')).financials_avg_meta), ['annual_revenue', 'operating_profit']);
});

// synthetic table helpers (same layout as the generator PDFs: RTL labels right, year columns right-aligned)
const COLS = [100, 180, 260, 340];
function row(y, labelWords, cells, p = 1){
  const out = []; let x = 520;
  labelWords.forEach(w => { x -= 30; out.push({ p, x, y, w: 25, s: w }); });
  cells.forEach((c, i) => { if (c === null) return; out.push({ p, x: COLS[i] - 40, y, w: 40, s: String(c) }); });
  return out;
}
const header = (y, years) => [{ p: 1, x: 500, y, w: 22, s: 'סעיף' }, ...years.map((yr, i) => ({ p: 1, x: COLS[i] - 23, y, w: 23, s: String(yr) }))];
function loadCard(values){
  const { document } = makeDom(values);
  class Event { constructor(type){ this.type = type; } }
  const c = { window: {}, document, Event, console };
  vm.createContext(c); vm.runInContext(src, c);
  return { F: c.window.BSDEconFill, document };
}

test('fill via the checkbox -> labels saved with years + source file; untick restores saved state', async () => {
  const { F, document } = loadCard({ annual_revenue: '500', operating_profit: '', net_profit: '7' });
  F._io.latestAnalysisFile = async () => ({ id: 'file-9', file_name: 'ניתוח.pdf', created_at: '2026-10-11', storage_path: 'x' });
  F._io.pdfItemsOf = async () => [...header(600, [2025, 2024, 2023]), ...row(575, ['הכנסות'], ['1,300,000', '1,200,000', '1,100,000']), ...row(550, ['רווח', 'נקי'], ['90,000', '—', '—'])];
  F._io.financialReportFiles = async () => { throw new Error('fallback must not run when the analysis has a table'); };
  F.initCard({ id: 'b-2', financials_avg_meta: null });
  assert.deepEqual(J(F.savePatch('b-2')), {});
  const box = { checked: true, disabled: false };
  await F.toggle('b-2', box);
  assert.equal(document.getElementById('annual_revenue').value, '1200000');
  assert.equal(document.getElementById('net_profit').value, '90000');
  assert.equal(document.getElementById('operating_profit').value, '', 'no row in the analysis -> untouched');
  assert.equal(document.getElementById('annual_revenue_econHint').textContent, 'ממוצע 3 שנים (2023–2025)');
  const meta = J(F.savePatch('b-2')).financials_avg_meta;
  assert.deepEqual(Object.keys(meta), ['annual_revenue', 'net_profit']);
  assert.deepEqual(meta.annual_revenue.years, [2023, 2024, 2025]);
  assert.equal(meta.net_profit.label, 'ממוצע שנה (2025)');
  assert.equal(meta.annual_revenue.source_file_id, 'file-9');
  assert.ok(meta.annual_revenue.filled_at);
  assert.doesNotMatch(JSON.stringify(meta), /1200000|90000/, 'no amounts in the meta');
  box.checked = false;
  await F.toggle('b-2', box);
  assert.equal(document.getElementById('annual_revenue').value, '500');
  assert.equal(document.getElementById('annual_revenue_econHint'), null);
  assert.deepEqual(J(F.savePatch('b-2')), {});
});

test('wiring in businesses.html: init on open, refresh from server, patch on save, forget after save', () => {
  assert.match(html, /window\.BSDEconFill\.initCard\(biz\);\n[^\n]*\n\s*bsdCaptureBizFormBaseline\(biz\);/);
  assert.ok(html.indexOf('BSDEconFill.initCard(biz)') < html.indexOf('bsdRestoreBizCardDraft(biz);'), 'baseline taken before a saved draft is restored');
  assert.match(html, /window\.BSDEconFill\.refreshSaved\(bizId, fresh\)/);
  const save = html.slice(html.indexOf('async function saveBiz('), html.indexOf('async function saveBiz(') + 30000);
  assert.match(save, /if \(bizId && window\.BSDEconFill\) Object\.assign\(payload, window\.BSDEconFill\.savePatch\(bizId\)\);/);
  assert.ok(save.indexOf('savePatch(bizId)') < save.indexOf(".from('businesses').update(payload)"));
  assert.match(save, /window\.BSDEconFill\.forget\(bizId\)/);
});
