// 11.10.2026 (Baruch): «🔄 החלף בקובץ חדש» on every sale-file row + «מלא מהניתוח הכלכלי האחרון».
// Synthetic fixtures only (laid out like the real generator PDFs: one pdf.js item per word,
// RTL label column on the right, year columns right-aligned) - no real business data here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../js/econAnalysisFill.js', import.meta.url), 'utf8');
const sale = fs.readFileSync(new URL('../js/saleFileModule2.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(src, ctx);
const E0 = ctx.window.BSDEconFill;
// results come from another vm realm: round-trip through JSON for deepEqual
const E = { ...E0, parseFinanceTable: items => JSON.parse(JSON.stringify(E0.parseFinanceTable(items))) };

// helper: a row = label words (right side) + one cell text per column (right edge aligned)
const COLS = [100, 180, 260, 340];
function row(y, labelWords, cells, p = 1){
  const out = []; let x = 520;
  labelWords.forEach(w => { x -= 30; out.push({ p, x, y, w: 25, s: w }); });
  cells.forEach((c, i) => { if (c === null) return; String(c).split(' ').forEach((part, k, arr) => out.push({ p, x: COLS[i] - 40 + k * 3 - (arr.length - 1 - k) * 4, y, w: 40 - k, s: part })); });
  return out;
}
const header = (y, years, extra) => {
  const out = [{ p: 1, x: 500, y, w: 22, s: 'סעיף' }];
  years.forEach((yr, i) => out.push({ p: 1, x: COLS[i] - 23, y, w: 23, s: String(yr) }));
  if (extra) out.push({ p: 1, x: COLS[extra.col] - 60, y, w: 30, s: extra.s });
  return out;
};

test('averages every real year, skips "—" / 0 / indicative columns, never reads %', () => {
  const items = [
    { p: 1, x: 400, y: 640, w: 40, s: 'טבלת' }, { p: 1, x: 360, y: 640, w: 40, s: 'סיכום' },
    ...header(600, [2026, 2025, 2024, 2023], { col: 0, s: 'אינדיק' }),
    ...row(575, ['הכנסות'], ['900,000', '1,200,000', '1,000,000', '800,000']),
    ...row(550, ['%', 'רווח', 'גולמי'], ['—', '30.0%', '25.0%', '20.0%']),
    ...row(525, ['רווח', '(הפסד)', 'הפעלה'], ['—', '300,000', '( 60,000 )', '0']),
    ...row(500, ['רווח', 'נקי'], ['—', '200,000', '—', '100,000']),
    ...row(440, ['הערה', 'כללית', '2024', '2025'], ['5', '6', '7', '8']),
  ];
  const r = E.parseFinanceTable(items);
  assert.equal(r.ok, true);
  assert.deepEqual(r.years.map(y => [y.year, y.included]), [[2023, true], [2024, true], [2025, true], [2026, false]]);
  assert.equal(r.averages.annual_revenue, 1000000, '(800k+1M+1.2M)/3, 2026 indicative excluded');
  assert.deepEqual(r.rows.operating.used.map(u => u.year), [2024, 2025], '2023 = 0 skipped');
  assert.equal(r.averages.operating_profit, 120000, 'loss in parentheses counts as negative');
  assert.deepEqual(r.rows.net.used.map(u => u.year), [2023, 2025], '"—" year skipped, not averaged as 0');
  assert.equal(r.averages.net_profit, 150000);
  assert.ok(!('asking_price' in r.averages), 'asking price is never computed');
});

test('a missing row leaves that field alone; no year table => clear message, nothing changed', () => {
  const r = E.parseFinanceTable([...header(600, [2023, 2024]), ...row(575, ['סה"כ', 'הכנסות'], ['500,000', '700,000'])]);
  assert.equal(r.ok, true);
  assert.equal(r.rows.net, null); assert.equal(r.averages.net_profit, undefined);
  assert.equal(r.averages.annual_revenue, 600000);
  const none = E.parseFinanceTable([{ p: 1, x: 300, y: 600, w: 40, s: 'תקופה' }, ...row(575, ['הכנסות'], ['631,729'])]);
  assert.equal(none.ok, false);
  assert.match(none.message, /לא שונה דבר/);
});

test('money parsing', () => {
  assert.equal(E.parseMoney('1,568,894'), 1568894);
  assert.equal(E.parseMoney('()11,376'), -11376);
  assert.equal(E.parseMoney('~**1,139,531'), 1139531);
  assert.equal(E.parseMoney('—'), null);
  assert.equal(E.parseMoney('48.2%'), null);
});

test('checkbox: admin/manager only, placed under the finance fields, asking price untouched', () => {
  assert.match(html, /fieldRow\('net_profit','רווח נקי'[^\n]*\n\s*\$\{biz && window\.BSDEconFill \? window\.BSDEconFill\.rowHtml\(biz\.id\) : ''\}/);
  assert.match(src, /function canUse\(\)\{[\s\S]*sfIsAdminOrManager/);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /asking_price/);
});

test('sale files: replace is offered on every managed row (also generated docs) and retires the old row softly', () => {
  assert.match(sale, /\$\{canManage \? `<button[^`]*replaceSaleFile\([^`]*🔄 החלף בקובץ חדש<\/button>` : ''\}/);
  const fn = sale.slice(sale.indexOf('async function replaceSaleFile'), sale.indexOf('// דחיסת תמונה'));
  assert.match(fn, /update\(\{ status: 'deleted', deleted_at:/);
  assert.doesNotMatch(fn, /storage\.from\([^)]*\)\.remove|\.delete\(\)/, 'never hard-deletes');
  assert.ok(fn.indexOf("admin_publish_business") < fn.indexOf("status: 'deleted'"), 'VIP is re-pointed before the old file is retired');
  const del = sale.slice(sale.indexOf('async function deleteSaleFile'), sale.indexOf('// שלב 7'));
  assert.match(del, /anonymous_file_id === fileId/);
});
