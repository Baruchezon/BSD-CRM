// תיק מכירה: מחיקה רק של הקבצים המסומנים. «בחר הכל» מסמן ומבטל את כולם.
// אין כפתור «מחיקת הכל» / «מחק הכל».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../js/saleFileModule2.js', import.meta.url), 'utf8');

test('the sale-file list has no delete-everything button', () => {
  assert.doesNotMatch(src, /מחיקת הכל|מחק הכל/);
  assert.match(src, /בחר הכל/);
  assert.match(src, /מחק נבחרים/);
  assert.match(src, /class="sf-file-check"/);
});

function boot(){
  const state = {
    panel: { innerHTML: '' },
    selectAll: { checked: false, indeterminate: false },
    boxes: [],
    updates: [],
    toasts: [],
    confirms: [],
    reloaded: 0,
    reopened: null,
  };
  const ctx = {
    window: { supabaseClient: { from(table){
      return {
        update(payload){
          return { in(_col, ids){ return { eq(col, val){
            state.updates.push({ table, payload, ids: Array.from(ids), eq: [col, val] });
            return Promise.resolve({ error: null });
          } }; } };
        },
        insert(){ return Promise.resolve({ error: null }); },
      };
    } } },
    console,
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])),
    toast(msg){ state.toasts.push(msg); },
    confirm(msg){ state.confirms.push(msg); return state.confirmResult; },
    isAndroidMobile(){ return false; },
    fmtDateTime(){ return ''; },
    document: {
      getElementById(id){
        if (id === 'saleFileCategoryPanel') return state.panel;
        if (id === 'sfSelectAll') return state.selectAll;
        return null;
      },
      querySelectorAll(sel){
        const s = String(sel);
        if (s.includes('sf-file-check:checked')) return state.boxes.filter(b => b.checked);
        if (s.includes('sf-file-check')) return state.boxes;
        return [];
      },
      createElement(){ return { style: {}, appendChild(){}, setAttribute(){} }; },
      head: { appendChild(){} },
    },
    state,
  };
  ctx.confirmResult = true;
  state.confirmResult = true;
  Object.defineProperty(ctx, 'confirmResult', { get(){ return state.confirmResult; }, set(v){ state.confirmResult = v; } });
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext(`CURRENT_PROFILE = { id: 'admin-1', role: 'admin' }; SF_CURRENT_BIZ = 'biz-1';`, ctx);
  return { ctx, state };
}

const market = (id, name) => ({
  id, file_name: name, category: 'other', document_type: 'market_research',
  storage_path: 'p/' + id, confidentiality_level: 2, source: 'auto_generated',
  created_at: '2026-10-01T00:00:00Z', version_number: 1,
});

test('each managed file gets a checkbox, and בחר הכל checks and unchecks all of them', () => {
  const { ctx, state } = boot();
  vm.runInContext(`SF_FILES_BY_CATEGORY = { market_research: ${JSON.stringify([market('a', 'חקר שוק.pdf'), market('b', 'חקר שוק 2.pdf')])} };`, ctx);
  ctx.openSaleFileCategory('biz-1', 'market_research');
  const html = state.panel.innerHTML;
  assert.equal((html.match(/class="sf-file-check"/g) || []).length, 2);
  assert.match(html, /בחר הכל/);
  assert.match(html, /מחק נבחרים/);
  assert.doesNotMatch(html, /מחיקת הכל|מחק הכל/);

  state.boxes = [
    { checked: false, dataset: { fileId: 'a' } },
    { checked: false, dataset: { fileId: 'b' } },
  ];
  ctx.sfToggleSelectAll(true);
  assert.deepEqual(state.boxes.map(b => b.checked), [true, true]);
  assert.equal(state.selectAll.checked, true);
  ctx.sfToggleSelectAll(false);
  assert.deepEqual(state.boxes.map(b => b.checked), [false, false]);
  assert.equal(state.selectAll.checked, false);
});

test('מחק נבחרים deletes only the checked files, and does nothing if none are checked', async () => {
  const { ctx, state } = boot();
  vm.runInContext(`SF_FILES_BY_CATEGORY = { market_research: ${JSON.stringify([market('a', 'חקר שוק.pdf'), market('b', 'חקר שוק 2.pdf')])} }; SF_OPEN_CATEGORY = 'market_research';`, ctx);
  ctx.loadSaleFileModule = async () => { state.reloaded += 1; };
  ctx.openSaleFileCategory = (biz, cat) => { state.reopened = [biz, cat]; };

  state.boxes = [{ checked: false, dataset: { fileId: 'a' } }];
  await ctx.deleteSelectedSaleFiles();
  assert.deepEqual(state.updates, []);
  assert.equal(state.toasts.at(-1), 'לא נבחרו קבצים למחיקה');

  state.boxes = [
    { checked: true, dataset: { fileId: 'a' } },
    { checked: false, dataset: { fileId: 'b' } },
  ];
  state.confirmResult = false;
  await ctx.deleteSelectedSaleFiles();
  assert.deepEqual(state.updates, []);
  assert.match(state.confirms.at(-1), /חקר שוק\.pdf/);
  assert.doesNotMatch(state.confirms.at(-1), /חקר שוק 2/);

  state.confirmResult = true;
  await ctx.deleteSelectedSaleFiles();
  assert.equal(state.updates.length, 1);
  assert.deepEqual(state.updates[0].ids, ['a']);
  assert.deepEqual(state.updates[0].eq, ['business_id', 'biz-1']);
  assert.equal(state.updates[0].payload.status, 'deleted');
  assert.equal(state.reloaded, 1);
  assert.deepEqual(state.reopened, ['biz-1', 'market_research']);
});
