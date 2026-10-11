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

test('filled averages round DOWN to 2 significant digits; under 100 and losses keep the sign', () => {
  const r2 = E.roundDown2Sig;
  assert.equal(r2(431759), 430000);
  assert.equal(r2(2332974), 2300000);
  assert.equal(r2(3837919), 3800000);
  assert.equal(r2(335589), 330000);
  assert.equal(r2(240342), 240000);
  assert.equal(r2(95400), 95000);
  assert.equal(r2(100), 100);
  assert.equal(r2(101), 100);
  assert.equal(r2(95), 95);
  assert.equal(r2(7), 7);
  assert.equal(r2(0), 0);
  assert.equal(r2(-11376), -11000);
  assert.equal(r2(-335589), -330000);
  assert.equal(r2(-95), -95);
  assert.equal(r2(-101), -100);
});

test('years label: contiguous span, a gap is listed, one year is singular', () => {
  assert.equal(E.yearsLabel([2025, 2023, 2024]), 'ממוצע 3 שנים (2023–2025)');
  assert.equal(E.yearsLabel([2024, 2025]), 'ממוצע 2 שנים (2024–2025)');
  assert.equal(E.yearsLabel([2025]), 'ממוצע שנה (2025)');
  assert.equal(E.yearsLabel([2025, 2022, 2023]), 'ממוצע 3 שנים (2022, 2023, 2025)');
});

const WIDE = [40, 110, 180, 250, 320, 390];
function wideRow(y, labelWords, cells, p = 1){
  const out = []; let x = 620;
  labelWords.forEach(w => { x -= 30; out.push({ p, x, y, w: 25, s: w }); });
  cells.forEach((c, i) => { if (c === null) return; String(c).split(' ').forEach((part, k, arr) => out.push({ p, x: WIDE[i] - 40 + k * 3 - (arr.length - 1 - k) * 4, y, w: 40 - k, s: part })); });
  return out;
}
function wideHeader(y, years, extra){
  const out = [{ p: 1, x: 600, y, w: 22, s: 'סעיף' }];
  years.forEach((yr, i) => out.push({ p: 1, x: WIDE[i] - 23, y, w: 23, s: String(yr) }));
  if (extra) out.push({ p: 1, x: WIDE[extra.col] - 60, y, w: 30, s: extra.s });
  return out;
}

test('only the last 3 full years are averaged, then rounded down; preview shows exact and filled', () => {
  const items = [
    ...wideHeader(600, [2026, 2025, 2024, 2023, 2022, 2021], { col: 0, s: 'אינדיק' }),
    ...wideRow(575, ['הכנסות'], ['9,000,000', '463,518', '431,759', '400,000', '999,999', '100,000']),
    ...wideRow(550, ['רווח', 'הפעלה'], ['—', '(11,376)', '—', '—', '—', '—']),
    ...wideRow(525, ['רווח', 'נקי'], ['—', '95', '—', '—', '—', '—']),
  ];
  const r = E.parseFinanceTable(items);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.revenue.used.map(u => u.year), [2023, 2024, 2025], '2026 indicative and 2021–2022 older than the last 3 are out');
  assert.equal(r.exactAverages.annual_revenue, 431759);
  assert.equal(r.averages.annual_revenue, 430000);
  assert.equal(r.yearLabels.annual_revenue, 'ממוצע 3 שנים (2023–2025)');
  assert.ok(r.rows.revenue.skipped.some(s => s.year === 2022 && /3 השנים האחרונות/.test(s.why)));
  assert.ok(r.rows.revenue.skipped.some(s => s.year === 2026 && /אינדיקטיבית/.test(s.why)));
  assert.equal(r.exactAverages.operating_profit, -11376);
  assert.equal(r.averages.operating_profit, -11000);
  assert.equal(r.yearLabels.operating_profit, 'ממוצע שנה (2025)');
  assert.equal(r.exactAverages.net_profit, 95);
  assert.equal(r.averages.net_profit, 95, 'under 100 the integer average is written as-is');
  const preview = E.previewHtml({ file_name: 'synth.pdf', created_at: null }, r);
  assert.match(preview, /ממוצע 3 שנים \(2023–2025\)/);
  assert.match(preview, /ממוצע 431,759 → יוזן 430,000/);
  assert.match(preview, /2023: 400,000/);
  assert.match(preview, /2024: 431,759/);
  assert.match(preview, /2025: 463,518/);
  assert.match(preview, /יוזן ‎-11,000|יוזן -11,000/);
});

test('a gap does not count as a year with data; fewer than 3 full years use what exists', () => {
  const gapped = E.parseFinanceTable([
    ...wideHeader(600, [2025, 2024, 2023, 2022, 2021]),
    ...wideRow(575, ['הכנסות'], ['500,000', '—', '300,000', '200,000', '100,000']),
  ]);
  assert.deepEqual(gapped.rows.revenue.used.map(u => u.year), [2022, 2023, 2025]);
  assert.equal(gapped.exactAverages.annual_revenue, 333333);
  assert.equal(gapped.averages.annual_revenue, 330000);
  assert.equal(gapped.yearLabels.annual_revenue, 'ממוצע 3 שנים (2022, 2023, 2025)');
  const two = E.parseFinanceTable([
    ...header(600, [2025, 2024, 2023]),
    ...row(575, ['סה"כ', 'הכנסות'], ['200,000', '100,000', '—']),
  ]);
  assert.deepEqual(two.rows.revenue.used.map(u => u.year), [2024, 2025]);
  assert.equal(two.averages.annual_revenue, 150000);
  assert.equal(two.yearLabels.annual_revenue, 'ממוצע 2 שנים (2024–2025)');
});

test('years label is painted next to the finance fields; the module never writes businesses itself', () => {
  assert.match(html, /id="bizFinanceHeading"/);
  assert.match(src, /_econHint/);
  assert.match(src, /repaint\(bizId\)/);
  assert.doesNotMatch(src, /\.from\('businesses'\)\.(update|upsert|insert)/, 'saving happens only through the normal card save');
  assert.doesNotMatch(src, /econ_years|finance_years_label/);
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
