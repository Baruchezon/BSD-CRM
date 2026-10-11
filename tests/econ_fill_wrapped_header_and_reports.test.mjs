// 11.10.2026 (Baruch): the econ fill failed on an analysis whose year titles wrap over two
// lines and whose revenue row is called «מכירות» (Arketa layout). Plus the fallback to the
// business's financial reports. Synthetic numbers only - the layout mirrors the real PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../js/econAnalysisFill.js', import.meta.url), 'utf8');
const J = v => JSON.parse(JSON.stringify(v));
function load(dom){
  const ctx = { window: {}, console, document: dom || { getElementById: () => null }, Event: class { constructor(t){ this.type = t; } } };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const E = ctx.window.BSDEconFill;
  return { E, parse: (items, o) => J(E.parseFinanceTable(items, o)) };
}
const T = (y, x, r, s, p = 1) => ({ p, x, y, w: r - x, s });

// Coordinates as pdf.js gives them for the real file: years at y=532, a second title line
// at y=515, «פרמטר» in between, the 2026 title «ינואר–יולי 2026 (לא / מבוקר)» sticking out
// to the right of its year, «*» before the 2025 amounts, words instead of numbers.
function wrappedTable(){
  return [
    T(564, 424, 493, 'פיננסי'), T(564, 462, 494, 'סיכום'), T(564, 497, 531, 'טבלת'),
    T(524, 517, 550, 'פרמטר'),
    T(532, 391, 415, '2023'), T(515, 378, 382, '('), T(515, 382, 411, 'מבוקר'), T(515, 411, 415, ')'),
    T(532, 317, 340, '2024'), T(515, 304, 307, '('), T(515, 307, 337, 'מבוקר'), T(515, 337, 340, ')'),
    T(532, 194, 212, 'בוחן'), T(532, 215, 236, 'מאזן'), T(532, 236, 240, ')'), T(532, 242, 266, '2025'), T(515, 238, 242, '('), T(515, 242, 266, 'בלבד'),
    T(532, 70, 83, 'לא'), T(532, 83, 87, ')'), T(532, 90, 113, '2026'), T(532, 116, 130, 'יולי'), T(532, 130, 135, '–'), T(532, 135, 158, 'ינואר'),
    T(515, 125, 128, '('), T(515, 128, 158, 'מבוקר'),
    T(489, 519, 550, 'מכירות'), T(489, 368, 415, '1,000,000'), T(489, 294, 340, '1,100,000'), T(489, 212, 216, '*'), T(489, 219, 266, '1,250,000'), T(489, 111, 158, '700,000'),
    T(464, 527, 550, 'עלות'), T(464, 499, 524, 'המכר'), T(464, 368, 415, '300,000'), T(464, 294, 340, '310,000'), T(464, 219, 266, '320,000'), T(464, 111, 158, '200,000'),
    T(438, 531, 550, 'רווח'), T(438, 505, 528, 'גולמי'), T(438, 368, 415, '700,000'), T(438, 294, 340, '790,000'), T(438, 219, 266, '930,000'), T(438, 111, 158, '500,000'),
    T(413, 524, 550, 'שיעור'), T(413, 503, 521, 'רווח'), T(413, 477, 500, 'גולמי'), T(413, 385, 415, '70.0%'), T(413, 310, 340, '71.8%'), T(413, 236, 266, '74.4%'), T(413, 128, 158, '71.4%'),
    T(387, 517, 549, 'הוצאות'), T(387, 495, 514, 'שכר'), T(387, 368, 415, '250,000'), T(387, 294, 340, '260,000'), T(387, 180, 266, 'נדרש פירוט נוסף **'),
    // a two-line label: words above and below the line with the numbers
    T(361, 517, 550, 'הוצאות'), T(361, 486, 514, 'מכירה'), T(361, 449, 480, 'הנהלה'), T(353, 368, 415, '400,000'), T(353, 294, 340, '410,000'), T(353, 180, 266, 'נדרש פירוט נוסף'), T(344, 517, 550, 'וכלליות'),
    T(318, 531, 550, 'רווח'), T(318, 497, 528, 'תפעולי'), T(318, 463, 467, '('), T(318, 467, 490, 'EBIT'), T(318, 490, 494, ')'),
    T(318, 368, 415, '300,000'), T(318, 294, 340, '200,000'), T(318, 180, 266, 'נדרש מידע נוסף **'), T(318, 70, 158, 'נדרש מידע נוסף'),
    T(293, 511, 549, 'EBITDA'), T(293, 486, 509, 'גולמי'), T(293, 368, 415, '350,000'), T(293, 294, 340, '250,000'),
    T(267, 517, 550, 'הוצאות'), T(267, 492, 514, 'מימון'), T(267, 368, 415, '(10,000)'), T(267, 294, 340, '(12,000)'),
    T(242, 522, 550, 'מענקי'), T(242, 490, 519, 'חרבות'), T(242, 466, 487, 'ברזל'), T(242, 368, 415, '5,000'), T(242, 294, 340, '6,000'), T(225, 527, 550, 'פעמי'),
    T(199, 531, 550, 'רווח'), T(199, 514, 528, 'נקי'), T(199, 368, 415, '210,000'), T(199, 294, 340, '(15,000)'), T(199, 180, 266, 'נדרש מידע נוסף'), T(199, 120, 158, 'לא ידוע'),
  ];
}

test('wrapped year titles + «מכירות»: audited / trial-balance years count, months-range year does not', () => {
  const { parse } = load();
  const r = parse(wrappedTable(), { currentYear: 2026 });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.years.map(y => [y.year, y.included]), [[2023, true], [2024, true], [2025, true], [2026, false]]);
  assert.match(r.years.find(y => y.year === 2026).note, /ינואר/);
  assert.equal(r.rows.revenue.label, 'מכירות');
  assert.deepEqual(r.rows.revenue.used.map(u => [u.year, u.value]), [[2023, 1000000], [2024, 1100000], [2025, 1250000]]);
  assert.equal(r.exactAverages.annual_revenue, 1116667);
  assert.equal(r.averages.annual_revenue, 1100000);
  assert.deepEqual(r.rows.operating.used.map(u => u.year), [2023, 2024], '«נדרש מידע נוסף» is no number');
  assert.equal(r.averages.operating_profit, 250000);
  assert.equal(r.yearLabels.operating_profit, 'ממוצע 2 שנים (2023–2024)');
  assert.deepEqual(r.rows.net.used.map(u => [u.year, u.value]), [[2023, 210000], [2024, -15000]]);
  assert.equal(r.averages.net_profit, 97000);
  assert.ok(!r.rows.revenue.used.some(u => u.value === 300000), 'עלות המכר is not revenue');
});

test('a year that has not ended yet is never averaged, even without a «partial» note', () => {
  const { parse } = load();
  const COLS = [100, 180, 260];
  const items = [{ p: 1, x: 500, y: 600, w: 22, s: 'סעיף' }, ...[2026, 2025, 2024].map((yr, i) => ({ p: 1, x: COLS[i] - 23, y: 600, w: 23, s: String(yr) })),
    { p: 1, x: 490, y: 575, w: 30, s: 'הכנסות' }, ...['900,000', '800,000', '600,000'].map((v, i) => ({ p: 1, x: COLS[i] - 40, y: 575, w: 40, s: v }))];
  const r = parse(items, { currentYear: 2026 });
  assert.deepEqual(r.rows.revenue.used.map(u => u.year), [2024, 2025]);
  assert.equal(r.averages.annual_revenue, 700000);
  const later = parse(items, { currentYear: 2027 });
  assert.deepEqual(later.rows.revenue.used.map(u => u.year), [2024, 2025, 2026]);
});

test('revenue row names', () => {
  const { E } = load();
  ['מכירות', 'סה"כ מכירות', 'מכירות נטו', 'הכנסות ממכירות', 'הכנסות', 'סה"כ הכנסות', 'מחזור'].forEach(l => assert.equal(E.rowKind(l), 'revenue', l));
  ['עלות המכר', 'הוצאות מכירה, הנהלה וכלליות', 'הכנסות מימון', 'רווח גולמי'].forEach(l => assert.notEqual(E.rowKind(l), 'revenue', l));
});

test('which business files count as financial reports', () => {
  const { E } = load();
  const yes = [['דוח כספי', 'scan.pdf', 'b/1.pdf'], ['מסמך כללי', 'דוחות כספיים 2024.pdf', 'b/2.pdf'], ['מסמך כללי', 'רווח והפסד 2025.pdf', 'b/3.pdf'],
    ['other', 'מאזן בוחן 12-2025.pdf', 'b/sale-file/other/4.pdf'], ['מסמך כללי', 'דוח הכנסות והוצאות.pdf', 'b/5.pdf']];
  const no = [['מסמך כללי', '1788682927560_valuation.pdf', 'b/1788682927560_valuation.pdf'], ['economic_analysis', 'ניתוח כלכלי והערכת שווי.pdf', 'b/x.pdf'],
    ['דוחות פעילות שיווקית', 'דוח סיכום הפצה.pdf', 'b/seller-portal-ad-reports/1.pdf'], ['exec_summary', 'תקציר עסק מלא.pdf', 'b/1_full.pdf'], ['דוח כספי', 'דוח.xlsx', 'b/d.xlsx']];
  yes.forEach(a => assert.equal(E.isFinancialReport(...a), true, a[1]));
  no.forEach(a => assert.equal(E.isFinancialReport(...a), false, a[1]));
});

test('mergeReportResults: newest report wins per year, last 3 full years, file shown per year', () => {
  const { E, parse } = load();
  const COLS = [100, 180];
  const stmt = (years, rev, op, net) => [{ p: 1, x: 500, y: 600, w: 22, s: 'סעיף' }, ...years.map((yr, i) => ({ p: 1, x: COLS[i] - 23, y: 600, w: 23, s: String(yr) })),
    { p: 1, x: 470, y: 575, w: 50, s: 'הכנסות' }, ...rev.map((v, i) => ({ p: 1, x: COLS[i] - 40, y: 575, w: 40, s: v })),
    { p: 1, x: 490, y: 550, w: 30, s: 'רווח' }, { p: 1, x: 455, y: 550, w: 30, s: 'תפעולי' }, ...op.map((v, i) => ({ p: 1, x: COLS[i] - 40, y: 550, w: 40, s: v })),
    { p: 1, x: 490, y: 525, w: 30, s: 'רווח' }, { p: 1, x: 455, y: 525, w: 30, s: 'נקי' }, ...net.map((v, i) => ({ p: 1, x: COLS[i] - 40, y: 525, w: 40, s: v }))];
  const newer = { file: { id: 'f2', file_name: 'דוחות כספיים 2025.pdf' }, res: E.parseFinanceTable(stmt([2025, 2024], ['1,500,000', '1,400,000'], ['200,000', '150,000'], ['120,000', '90,000']), { currentYear: 2026 }) };
  const older = { file: { id: 'f1', file_name: 'דוחות כספיים 2023.pdf' }, res: E.parseFinanceTable(stmt([2023, 2022], ['1,300,000', '1,000,000'], ['100,000', '80,000'], ['60,000', '50,000']), { currentYear: 2026 }) };
  const restated = { file: { id: 'f0', file_name: 'ישן 2024.pdf' }, res: E.parseFinanceTable(stmt([2024, 2023], ['9,999,999', '9,999,999'], ['1', '1'], ['1', '1']), { currentYear: 2026 }) };
  const r = J(E.mergeReportResults([newer, older, restated]));
  assert.equal(r.ok, true);
  assert.equal(r.fallback, true);
  assert.deepEqual(r.rows.revenue.used.map(u => [u.year, u.value, u.file]), [[2023, 1300000, 'דוחות כספיים 2023.pdf'], [2024, 1400000, 'דוחות כספיים 2025.pdf'], [2025, 1500000, 'דוחות כספיים 2025.pdf']]);
  assert.equal(r.averages.annual_revenue, 1400000);
  assert.equal(r.averages.operating_profit, 150000);
  assert.equal(r.averages.net_profit, 90000);
  assert.equal(r.yearLabels.net_profit, 'ממוצע 3 שנים (2023–2025)');
  assert.ok(r.rows.revenue.skipped.some(s => s.year === 2022 && /3 השנים/.test(s.why)));
  const html = E.previewHtml({ file_name: 'דוחות כספיים', analysisName: 'ניתוח.pdf' }, r);
  assert.match(html, /2024: 1,400,000 \(«דוחות כספיים 2025\.pdf»\)/);
  assert.match(html, /מתוך הדוחות הכספיים בקבצי העסק/);
  assert.equal(E.mergeReportResults([]).ok, false);
  assert.equal(E.mergeReportResults([{ file: { id: 'x', file_name: 'x' }, res: { ok: false } }]).ok, false);
  void parse;
});

function dom(values){
  const els = {};
  const mk = (id, value) => {
    const label = { appendChild(c){ c.parentLabel = this; } };
    const el = { id, value: value === undefined ? '' : String(value), style: {}, innerHTML: '', textContent: '', parentElement: { querySelector: () => label },
      addEventListener(){}, dispatchEvent(){}, remove(){ delete els[this.id]; } };
    return (els[id] = el);
  };
  Object.entries(values).forEach(([k, v]) => mk(k, v));
  mk('bizFinanceHeading'); mk('econFillPreview');
  return { getElementById: id => els[id] || null, createElement: () => { const e = mk('__t' + Math.random()); return new Proxy(e, { set(t, k, v){ if (k === 'id'){ delete els[t.id]; els[v] = t; } t[k] = v; return true; } }); } };
}

test('toggle: analysis without a year table -> financial reports in the business files are used', async () => {
  const d = dom({ annual_revenue: '', operating_profit: '', net_profit: '', asking_price: '2000000' });
  const { E } = load(d);
  const COLS = [100, 180];
  const items = [{ p: 1, x: 500, y: 600, w: 22, s: 'סעיף' }, ...[2025, 2024].map((yr, i) => ({ p: 1, x: COLS[i] - 23, y: 600, w: 23, s: String(yr) })),
    { p: 1, x: 470, y: 575, w: 50, s: 'מכירות' }, ...['2,000,000', '1,000,000'].map((v, i) => ({ p: 1, x: COLS[i] - 40, y: 575, w: 40, s: v }))];
  E._io.latestAnalysisFile = async () => ({ id: 'an-1', file_name: 'ניתוח בלי טבלה.pdf', storage_path: 'a' });
  E._io.financialReportFiles = async () => [{ id: 'r-1', file_name: 'רווח והפסד 2025.pdf', storage_path: 'r' }];
  E._io.pdfItemsOf = async p => (p === 'a' ? [{ p: 1, x: 300, y: 600, w: 40, s: 'טקסט' }] : items);
  E.initCard({ id: 'b-9', financials_avg_meta: null });
  const box = { checked: true, disabled: false };
  await E.toggle('b-9', box);
  assert.equal(box.checked, true);
  assert.equal(d.getElementById('annual_revenue').value, '1500000');
  assert.equal(d.getElementById('asking_price').value, '2000000', 'asking price untouched');
  assert.match(d.getElementById('econFillPreview').innerHTML, /רווח והפסד 2025\.pdf/);
  assert.match(d.getElementById('econFillPreview').innerHTML, /ניתוח בלי טבלה\.pdf/);
  const meta = J(E.savePatch('b-9')).financials_avg_meta;
  assert.equal(meta.annual_revenue.label, 'ממוצע 2 שנים (2024–2025)');
  assert.equal(meta.annual_revenue.source_file_id, 'r-1');
});

test('toggle: no table and no reports -> clear message, nothing changed', async () => {
  const d = dom({ annual_revenue: '5', operating_profit: '6', net_profit: '7' });
  const { E } = load(d);
  E._io.latestAnalysisFile = async () => ({ id: 'an-1', file_name: 'ניתוח בלי טבלה.pdf', storage_path: 'a' });
  E._io.financialReportFiles = async () => [];
  E._io.pdfItemsOf = async () => [];
  E.initCard({ id: 'b-8', financials_avg_meta: null });
  const box = { checked: true, disabled: false };
  await E.toggle('b-8', box);
  assert.equal(box.checked, false);
  assert.equal(d.getElementById('annual_revenue').value, '5');
  const msg = d.getElementById('econFillPreview').innerHTML;
  assert.match(msg, /אין דוח כספי/);
  assert.match(msg, /לא שונה דבר/);
  assert.deepEqual(J(E.savePatch('b-8')), {});
});
