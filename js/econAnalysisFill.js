// ============================================================
// BSD CRM - «מלא מהניתוח הכלכלי האחרון» (Baruch, 11.10.2026)
// ------------------------------------------------------------
// One checkbox under «נתונים כספיים». When ticked it reads the NEWEST active
// economic-analysis PDF of this business from the sale file (business_sale_files,
// bucket business-files - the same file the card and the seller portal show),
// finds its yearly financial summary table, and fills - in the form only -
//   מחזור שנתי  = average of the yearly revenue values
//   רווח תפעולי = average of the yearly operating-profit values
//   רווח נקי    = average of the yearly net-profit values
// There is no structured copy of the analysis anywhere (the generator writes only
// a PDF), so the table is read from the PDF text with pdf.js, by position.
// Rules: מחיר מבוקש is never touched. Empty / zero / "—" years are skipped, and
// columns marked as partial/indicative/estimated are excluded. Only the 3 most
// recent years that still have a real number are averaged (fewer, if fewer exist).
// The number written into the field is that average rounded DOWN to 2 significant
// digits (magnitude; under 100 the integer average is kept). A field whose row
// is missing in the analysis is left as it is. Nothing is saved here: the values
// are shown with the years used, and Baruch confirms by pressing the normal save.
// 11.10.2026 (build 202610111800): year titles may wrap over 2-3 lines («2025 (מאזן בוחן» /
// «בלבד)»), revenue may be called «מכירות». A column is left out only when its title
// says partial / estimate / a months range, or the year has not ended yet - «מבוקר»,
// «לא מבוקר», «מאזן בוחן» are full years. If the analysis has no yearly table (or
// there is no analysis), the financial-report PDFs in the CRM business files are read
// the same way (newest report wins per year) and the preview names the file of every
// year. The Drive «דוחות» folder is not connected to the CRM, so only reports that
// were uploaded to the business files are found.
// The years label is shown next to each filled field and in the section heading.
// 11.10.2026 (build 202610111800, approved by Baruch): the label is saved with the
// normal «שמור» into businesses.financials_avg_meta (jsonb, years + source file
// only, never amounts) and painted again every time the card opens. A field that
// is edited by hand after the fill (or after load) loses ONLY its own label; the
// other fields keep theirs. Unticking restores what was in the fields before (and
// the labels that were saved). The checkbox itself is admin/manager only.
// ============================================================
(function(){
  const PDFJS_VER = '4.10.38';
  const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/`;
  const FIELDS = [
    { key: 'annual_revenue',   label: 'מחזור שנתי',  row: 'revenue' },
    { key: 'operating_profit', label: 'רווח תפעולי', row: 'operating' },
    { key: 'net_profit',       label: 'רווח נקי',    row: 'net' },
  ];
  const YEAR_RE = /^(19[89]\d|20[0-4]\d)$/;
  const HEADER_NOISE_RE = /^(\(|\)|\*+|\.|,|:|-|–|₪|ש|ח|"|״|'|׳|ש"ח|ש״ח)$/;
  const FINANCE_HEADING = 'נתונים כספיים';
  // A year column is left out only when its header says the period is partial or
  // not real (months range, «חלקי», «אינדיקטיבי», estimate/forecast). «(מבוקר)»,
  // «לא מבוקר», «מאזן בוחן בלבד», «זמני» are full years and stay in.
  const PARTIAL_RE = /(חלקי|אינדיק|מוערך|הערכ|אומדן|משוער|צפי|צפוי|תחזית|תקציב|חודש|רבעון|מחצית|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|YTD|partial|estimat|forecast|budget|\bQ[1-4]\b|\bH[12]\b|\d{1,2}\/\d{1,2})/i;
  const MONEY_TOKEN_RE = /\d{1,3}(,\d{3})+|\d{4,}/;

  // Integer shekels. |n| < 100 stays as that integer. Otherwise keep the first
  // two digits and zero the rest (floor of the magnitude — a loss of -11,376
  // becomes -11,000, never -12,000).
  function roundDown2Sig(n){
    if (n === null || n === undefined || !isFinite(Number(n))) return n;
    const sign = Number(n) < 0 ? -1 : 1;
    let abs = Math.abs(Math.trunc(Number(n)));
    if (abs < 100) return sign * abs;
    let factor = 1;
    while (abs >= 100){
      abs = Math.floor(abs / 10);
      factor *= 10;
    }
    return sign * abs * factor;
  }

  // [2023, 2024, 2025] → «ממוצע 3 שנים (2023–2025)». A gap is listed, not spanned.
  function yearsLabel(years){
    const ys = (years || []).map(Number).filter(y => isFinite(y)).sort((a, b) => a - b);
    const n = ys.length;
    if (!n) return '';
    if (n === 1) return 'ממוצע שנה (' + ys[0] + ')';
    const contiguous = ys.every((y, i) => i === 0 || y === ys[i - 1] + 1);
    const span = contiguous ? (ys[0] + '–' + ys[n - 1]) : ys.join(', ');
    return 'ממוצע ' + n + ' שנים (' + span + ')';
  }

  function normLabel(tokens){
    // RTL words come out in visual order, so brackets are mirrored: swap them back.
    return tokens.slice().sort((a, b) => b.x - a.x).map(t => t.s === '(' ? ')' : t.s === ')' ? '(' : t.s).join(' ')
      .replace(/\s*(["'״׳])\s*/g, '$1').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+/g, ' ').trim();
  }

  // '1,568,894' -> 1568894 ; '(11,376)' / '()11,376' / '-11,376' -> -11376 ;
  // '—', '', '48.2%' -> null (missing / a percentage, never a money value).
  function parseMoney(text){
    const t = String(text || '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
    if (!t || /%/.test(t)) return null;
    const digits = t.replace(/[^0-9.,]/g, '');
    if (!/\d/.test(digits)) return null;
    const n = Number(digits.replace(/,/g, ''));
    if (!isFinite(n)) return null;
    const neg = (/\(/.test(t) && /\)/.test(t)) || /^[-−–]\s*\d/.test(t.replace(/[~*₪\s]/g, '')) || /\d[-−]$/.test(t.replace(/[~*₪\s]/g, ''));
    return neg ? -n : n;
  }

  function groupLines(items){
    const lines = [];
    const sorted = items.slice().sort((a, b) => a.p - b.p || b.y - a.y || a.x - b.x);
    for (const it of sorted){
      const last = lines[lines.length - 1];
      if (last && last.p === it.p && Math.abs(last.y - it.y) <= 3) last.tokens.push(it);
      else lines.push({ p: it.p, y: it.y, tokens: [it] });
    }
    return lines;
  }

  function rowKind(label){
    if (!label || /%/.test(label)) return null;
    if (/רווח\s*נקי/.test(label)) return 'net';
    if (/רווח/.test(label) && /(תפעולי|הפעלה)/.test(label)) return 'operating';
    if (/(אחרות|חייבות|פטורות|מימון|ריבית)/.test(label)) return null;
    if (/^((סה"כ|סך)\s*)?(ה)?הכנסות(\s*\(.*\))?$/.test(label) || /^מחזור/.test(label) || /^(סה"כ|סך)\s*(ה)?הכנסות/.test(label)) return 'revenue';
    // 11.10.2026 (Arketa): «מכירות» / «סה"כ מכירות» / «הכנסות ממכירות» are the revenue row too.
    // «עלות המכר» / «הוצאות מכירה» never match (different words).
    if (/^((סה"כ|סך)\s*)?(ה)?מכירות(\s*(נטו|\(.*\)))?$/.test(label) || /^(ה)?הכנסות\s*ממכירות/.test(label)) return 'revenue';
    return null;
  }

  // items: [{p, x, y, w, s}] (pdf.js text items, one word each). Pure function.
  function parseFinanceTable(items, opts){
    const currentYear = (opts && opts.currentYear) || new Date().getFullYear();
    const lines = groupLines((items || []).filter(t => t && String(t.s || '').trim()));
    for (let i = 0; i < lines.length; i++){
      const header = lines[i];
      const yearToks = header.tokens.filter(t => YEAR_RE.test(String(t.s).trim()));
      if (yearToks.length < 2) continue;
      const cols = yearToks.map(t => ({ year: Number(String(t.s).trim()), right: t.x + t.w, extra: [] }))
        .sort((a, b) => a.right - b.right);
      if (new Set(cols.map(c => c.year)).size !== cols.length) continue;
      const spacing = (cols[cols.length - 1].right - cols[0].right) / Math.max(1, cols.length - 1);
      const labelX = cols[cols.length - 1].right + Math.max(20, spacing * 0.35);
      const nearest = tok => {
        const r = tok.x + tok.w / 2;
        let best = null, bd = Infinity;
        for (const c of cols){ const d = Math.abs(c.right - (tok.x + tok.w)) * 0.5 + Math.abs(c.right - r) * 0.5; if (d < bd){ bd = d; best = c; } }
        return best;
      };
      const extraToks = header.tokens.filter(t => t.x < labelX && !YEAR_RE.test(String(t.s).trim()));
      // 11.10.2026 (Arketa): a column title can wrap - «2025 (מאזן בוחן» / «בלבד)»,
      // «ינואר–יולי 2026 (לא» / «מבוקר)». Up to 3 tight lines right under the year line
      // that hold no amount are part of the header, not table rows.
      let firstRow = i + 1, prevY = header.y;
      for (let j = i + 1; j < lines.length && j <= i + 3; j++){
        const ln = lines[j];
        if (ln.p !== header.p || prevY - ln.y > 16) break;
        if (ln.tokens.some(t => MONEY_TOKEN_RE.test(String(t.s)) && !YEAR_RE.test(String(t.s).trim()))) break;
        if (ln.tokens.filter(t => YEAR_RE.test(String(t.s).trim())).length >= 2) break;
        ln.tokens.filter(t => t.x < labelX).forEach(t => extraToks.push(t));
        firstRow = j + 1; prevY = ln.y;
      }
      extraToks.sort((a, b) => b.y - a.y || b.x - a.x).forEach(t => {
        const c = nearest(t);
        if (!HEADER_NOISE_RE.test(String(t.s).trim())) c.extra.push(String(t.s).trim());
        c.headRight = Math.max(c.headRight || c.right, t.x + t.w);
      });
      // A wrapped title can stick out past the year number («ינואר–יולי 2026»): the
      // column's right edge is the right edge of its whole title.
      cols.forEach(c => { if (c.headRight && c.headRight - c.right < spacing * 0.6) c.right = c.headRight; });
      // Table rows: the lines right under the header, while the spacing stays regular.
      const rows = [];
      let gap = null;
      for (let j = firstRow; j < lines.length; j++){
        const ln = lines[j];
        if (ln.p !== header.p) break;
        const d = prevY - ln.y;
        if (gap === null){ if (d > 60) break; gap = d; }
        else if (d > gap * 1.45 + 2) break;
        if (ln.tokens.filter(t => YEAR_RE.test(String(t.s).trim())).length >= 2) break;
        const labelToks = ln.tokens.filter(t => t.x >= labelX);
        const cells = {};
        ln.tokens.filter(t => t.x < labelX).forEach(t => { const c = nearest(t); (cells[c.year] = cells[c.year] || []).push(t); });
        const byYear = {};
        cols.forEach(c => {
          const toks = (cells[c.year] || []).sort((a, b) => a.x - b.x);
          byYear[c.year] = { text: toks.map(t => t.s).join(''), value: parseMoney(toks.map(t => t.s).join('')) };
        });
        rows.push({ label: normLabel(labelToks), byYear });
        prevY = ln.y;
      }
      const picked = {};
      rows.forEach(r => { const k = rowKind(r.label); if (k && !picked[k]) picked[k] = r; });
      if (!picked.revenue) continue; // not the financial summary table - keep looking
      const years = cols.map(c => {
        const note = c.extra.join(' ');
        const partial = PARTIAL_RE.test(note);
        const open = c.year >= currentYear;
        return { year: c.year, included: !partial && !open, note: partial || !open ? note : (note ? note + ' · ' : '') + 'שנה שטרם הסתיימה' };
      }).sort((a, b) => a.year - b.year);
      const result = { ok: true, page: header.p, years, rows: {}, averages: {}, exactAverages: {}, yearLabels: {} };
      for (const f of FIELDS){
        const r = picked[f.row];
        if (!r){ result.rows[f.row] = null; continue; }
        const eligible = [], skipped = [];
        years.forEach(y => {
          const cell = r.byYear[y.year] || {};
          if (!y.included) skipped.push({ year: y.year, text: cell.text || '', why: 'עמודה חלקית/אינדיקטיבית' + (y.note ? ' - «' + y.note + '»' : '') });
          else if (cell.value === null || cell.value === undefined) skipped.push({ year: y.year, text: cell.text || '', why: 'אין נתון' });
          else if (cell.value === 0) skipped.push({ year: y.year, text: cell.text, why: 'אפס' });
          else eligible.push({ year: y.year, value: cell.value });
        });
        eligible.sort((a, b) => b.year - a.year);
        const used = eligible.slice(0, 3).sort((a, b) => a.year - b.year);
        eligible.slice(3).forEach(u => skipped.push({ year: u.year, text: String(u.value), why: 'מעבר ל-3 השנים האחרונות' }));
        skipped.sort((a, b) => a.year - b.year);
        result.rows[f.row] = { label: r.label, used, skipped, all: eligible.slice().sort((a, b) => a.year - b.year) };
        if (!used.length){
          result.averages[f.key] = null;
          result.exactAverages[f.key] = null;
          result.yearLabels[f.key] = '';
          continue;
        }
        const exact = Math.round(used.reduce((s, u) => s + u.value, 0) / used.length);
        result.exactAverages[f.key] = exact;
        result.averages[f.key] = roundDown2Sig(exact);
        result.yearLabels[f.key] = yearsLabel(used.map(u => u.year));
      }
      return result;
    }
    return { ok: false, reason: 'no_table', message: 'לא נמצאה בניתוח הכלכלי טבלת סיכום פיננסי לפי שנים (שורת שנים + שורת הכנסות). לא שונה דבר.' };
  }

  // ---- fallback: the business's own financial reports (P&L / דוחות כספיים) ----
  // Used only when the analysis has no yearly table (or there is no analysis). Every
  // report PDF in the CRM business files is read with the same table parser; for each
  // year the NEWEST report that has a number wins, and every year shows its file.
  // Pure: [{ file:{id,file_name,created_at}, res: parseFinanceTable(...) }] (newest first).
  function mergeReportResults(list){
    const ok = (list || []).filter(x => x && x.res && x.res.ok);
    if (!ok.length) return { ok: false, reason: 'no_reports' };
    const result = { ok: true, fallback: true, years: [], rows: {}, averages: {}, exactAverages: {}, yearLabels: {}, files: ok.map(x => x.file) };
    const allYears = new Map();
    ok.forEach(x => (x.res.years || []).forEach(y => { if (!allYears.has(y.year) || !y.included) allYears.set(y.year, { year: y.year, included: (allYears.get(y.year) || y).included && y.included, note: y.note }); }));
    result.years = [...allYears.values()].sort((a, b) => a.year - b.year);
    for (const f of FIELDS){
      const byYear = new Map(), skipped = [];
      let label = null;
      ok.forEach(x => {
        const r = x.res.rows && x.res.rows[f.row];
        if (!r) return;
        if (!label) label = r.label;
        (r.all || r.used || []).forEach(u => {
          const y = allYears.get(u.year);
          if (y && !y.included) return;
          if (!byYear.has(u.year)) byYear.set(u.year, { year: u.year, value: u.value, file: x.file.file_name });
        });
      });
      if (!label){ result.rows[f.row] = null; continue; }
      const eligible = [...byYear.values()].sort((a, b) => b.year - a.year);
      const used = eligible.slice(0, 3).sort((a, b) => a.year - b.year);
      eligible.slice(3).forEach(u => skipped.push({ year: u.year, text: String(u.value), why: 'מעבר ל-3 השנים האחרונות' }));
      result.years.filter(y => !y.included).forEach(y => skipped.push({ year: y.year, text: '', why: 'עמודה חלקית/אינדיקטיבית' + (y.note ? ' - «' + y.note + '»' : '') }));
      skipped.sort((a, b) => a.year - b.year);
      result.rows[f.row] = { label, used, skipped, all: eligible.slice().sort((a, b) => a.year - b.year) };
      if (!used.length){ result.averages[f.key] = null; result.exactAverages[f.key] = null; result.yearLabels[f.key] = ''; continue; }
      const exact = Math.round(used.reduce((sum, u) => sum + u.value, 0) / used.length);
      result.exactAverages[f.key] = exact;
      result.averages[f.key] = roundDown2Sig(exact);
      result.yearLabels[f.key] = yearsLabel(used.map(u => u.year));
    }
    if (!FIELDS.some(f => result.averages[f.key] !== null && result.averages[f.key] !== undefined)) return { ok: false, reason: 'no_values' };
    return result;
  }

  // Pure: is this business file a financial report (and not one of our own generated docs)?
  function isFinancialReport(category, name, path){
    const n = String(name || ''), p = String(path || '');
    if (!/\.pdf$/i.test(n) && !/\.pdf$/i.test(p)) return false;
    if (/_(valuation|full|anonymous|market|short)\.pdf$/i.test(p) || /seller-portal-ad-reports\//.test(p)) return false;
    if (/(ניתוח כלכלי|הערכת שווי|תקציר|חקר שוק|הסכם|מצגת|פעילות שיווקית|הפצה|פרסומים)/.test(n) || /שיווקית/.test(String(category || ''))) return false;
    if (category === 'דוח כספי') return true;
    return /(דוח|דו"ח|דו״ח|דוחות|מאזן|רווח\s*(ו|ו-)?\s*הפסד|הכנסות\s*(ו|ו-)?\s*הוצאות|כספי|financ|P&L|P\s*and\s*L|profit|statement|trial\s*balance)/i.test(n);
  }

  async function financialReportFiles(bizId){
    const sb = window.supabaseClient;
    const out = [], seen = new Set();
    const add = (path, name, created, id) => { if (!path || seen.has(path)) return; seen.add(path); out.push({ id: id || path, file_name: name || path.split('/').pop(), storage_path: path, created_at: created || '' }); };
    const [meta, sale] = await Promise.all([
      sb.from('business_file_meta').select('storage_path,display_name,original_filename,category,created_at').eq('business_id', bizId),
      sb.from('business_sale_files').select('id,file_name,storage_path,category,document_type,created_at,status,deleted_at').eq('business_id', bizId).eq('status', 'active'),
    ]);
    ((meta && meta.data) || []).forEach(m => { const name = m.display_name || m.original_filename; if (isFinancialReport(m.category, name, m.storage_path)) add(m.storage_path, name, m.created_at); });
    ((sale && sale.data) || []).forEach(f => { if (!f.deleted_at && f.document_type !== 'activity_report' && isFinancialReport(f.category, f.file_name, f.storage_path)) add(f.storage_path, f.file_name, f.created_at, f.id); });
    return out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
  }

  let pdfjsPromise = null;
  function loadPdfJs(){
    if (!pdfjsPromise){
      pdfjsPromise = import(PDFJS_BASE + 'pdf.min.mjs').then(m => {
        m.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs';
        return m;
      }).catch(e => { pdfjsPromise = null; throw e; });
    }
    return pdfjsPromise;
  }

  async function pdfItems(arrayBuffer){
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const out = [];
    for (let p = 1; p <= Math.min(doc.numPages, 12); p++){
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      tc.items.forEach(it => { if (it.str && it.str.trim()) out.push({ p, x: it.transform[4], y: it.transform[5], w: it.width, s: it.str }); });
    }
    return out;
  }

  async function latestAnalysisFile(bizId){
    const { data, error } = await window.supabaseClient.from('business_sale_files')
      .select('id,file_name,file_type,storage_path,category,document_type,created_at,status,deleted_at')
      .eq('business_id', bizId).eq('status', 'active').in('category', ['economic_analysis', 'valuation'])
      .order('created_at', { ascending: false });
    if (error) throw new Error('שגיאה בטעינת קבצי הניתוח הכלכלי: ' + error.message);
    const inSaleFile = (data || []).find(f => !f.deleted_at && (f.file_type === 'application/pdf' || /\.pdf$/i.test(f.file_name || '') || /\.pdf$/i.test(f.storage_path || '')));
    if (inSaleFile) return inSaleFile;
    // 11.10.2026: an analysis that was generated but never filed in the sale file
    // (e.g. אזרד) is still in the business folder as <ts>_valuation.pdf - use the newest.
    const { data: list } = await window.supabaseClient.storage.from('business-files').list(bizId, { sortBy: { column: 'created_at', order: 'desc' } });
    const gen = (list || []).filter(o => o && o.id !== null && /_valuation\.pdf$/i.test(o.name || ''))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
    return gen ? { id: bizId + '/' + gen.name, file_name: 'ניתוח כלכלי והערכת שווי (קבצי העסק) ' + gen.name, storage_path: bizId + '/' + gen.name, created_at: gen.created_at } : null;
  }

  const fmt = n => (n === null || n === undefined) ? '—' : Number(n).toLocaleString('he-IL');
  const escH = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BEFORE = {};

  function setField(key, value){
    const el = document.getElementById(key);
    if (!el) return;
    el.value = value === null || value === undefined ? '' : String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function paintHints(res){
    FIELDS.forEach(f => {
      const el = document.getElementById(f.key);
      if (!el) return;
      const text = (res && res.yearLabels && res.yearLabels[f.key]) || '';
      const label = el.parentElement && el.parentElement.querySelector('label');
      let hint = document.getElementById(f.key + '_econHint');
      if (!text || !label){
        if (hint) hint.remove();
        return;
      }
      if (!hint){
        hint = document.createElement('span');
        hint.id = f.key + '_econHint';
        hint.style.cssText = 'font-weight:500;color:#5a6172;font-size:.78rem;margin-inline-start:6px;';
        label.appendChild(hint);
      }
      hint.textContent = text;
      const meta = res && res.meta && res.meta[f.key];
      const when = meta && meta.filled_at ? new Date(meta.filled_at) : null;
      hint.title = when && !isNaN(when) ? ('מולא מהניתוח הכלכלי ב-' + when.toLocaleDateString('he-IL')) : '';
    });
    const heading = document.getElementById('bizFinanceHeading');
    if (!heading) return;
    const labels = FIELDS.map(f => res && res.yearLabels && res.yearLabels[f.key]).filter(Boolean);
    const same = labels.length > 0 && labels.every(l => l === labels[0]);
    heading.textContent = same ? (FINANCE_HEADING + ' · ' + labels[0]) : FINANCE_HEADING;
  }

  // ---- persisted years label (businesses.financials_avg_meta) ----
  // STATE[bizId] = { saved: meta loaded from the row, baseline: field values when the
  // card opened, pending: entries from a fill in this card (with the value written) }
  const STATE = {};
  const FIELD_KEYS = FIELDS.map(f => f.key);
  function normNum(v){
    const t = v === null || v === undefined ? '' : String(v).replace(/,/g, '').trim();
    if (!t) return null;
    const n = Number(t);
    return isFinite(n) ? n : t;
  }
  // Keeps only well-formed entries of the three fields. Anything else -> null.
  function cleanMeta(meta){
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    const out = {};
    FIELD_KEYS.forEach(k => {
      const e = meta[k];
      if (!e || typeof e !== 'object' || typeof e.label !== 'string' || !e.label.trim()) return;
      const entry = { label: e.label.trim() };
      if (Array.isArray(e.years)) entry.years = e.years.map(Number).filter(y => isFinite(y));
      if (e.source_file_id) entry.source_file_id = String(e.source_file_id);
      if (e.filled_at) entry.filled_at = String(e.filled_at);
      out[k] = entry;
    });
    return Object.keys(out).length ? out : null;
  }
  // Pure: which labels are still true for the values now in the form.
  //  - a fill in this card wins for its field while the field still holds the filled value;
  //  - otherwise a saved label stays while the field still holds the value it opened with;
  //  - a field edited by hand loses only its own label.
  function planMeta(saved, pending, baseline, current){
    const out = {};
    const sv = cleanMeta(saved) || {};
    FIELD_KEYS.forEach(k => {
      const cur = normNum(current && current[k]);
      if (cur === null) return;
      const p = pending && pending[k];
      if (p){
        if (cur === normNum(p.value)){ const e = cleanMeta({ [k]: p }); if (e) out[k] = e[k]; }
        return;
      }
      if (sv[k] && cur === normNum(baseline && baseline[k])) out[k] = sv[k];
    });
    return Object.keys(out).length ? out : null;
  }
  // Pure: the patch for the businesses update - empty when nothing changed, so a
  // normal save does not touch the column at all.
  function metaPatch(saved, planned){
    const a = JSON.stringify(cleanMeta(saved)), b = JSON.stringify(cleanMeta(planned));
    return a === b ? {} : { financials_avg_meta: cleanMeta(planned) };
  }
  function labelsOf(meta){
    const out = {};
    FIELD_KEYS.forEach(k => { if (meta && meta[k] && meta[k].label) out[k] = meta[k].label; });
    return out;
  }
  function currentValues(){
    const out = {};
    FIELD_KEYS.forEach(k => { const el = document.getElementById(k); out[k] = el ? el.value : null; });
    return out;
  }
  function plannedFor(bizId){
    const st = STATE[bizId];
    return st ? planMeta(st.saved, st.pending, st.baseline, currentValues()) : null;
  }
  function repaint(bizId){
    const meta = plannedFor(bizId);
    paintHints(meta ? { yearLabels: labelsOf(meta), meta } : null);
  }
  // Called once the card form is in the DOM (before a saved draft is restored).
  function initCard(biz){
    if (!biz || !biz.id) return;
    const baseline = currentValues();
    STATE[biz.id] = { saved: cleanMeta(biz.financials_avg_meta), baseline, pending: null };
    delete BEFORE[biz.id];
    FIELD_KEYS.forEach(k => {
      const el = document.getElementById(k);
      if (el) el.addEventListener('input', () => { if (STATE[biz.id]) repaint(biz.id); });
    });
    repaint(biz.id);
  }
  // A fresh row arrived from the server while the card is open.
  function refreshSaved(bizId, row){
    const st = STATE[bizId];
    if (!st || !row || !Object.prototype.hasOwnProperty.call(row, 'financials_avg_meta')) return;
    st.saved = cleanMeta(row.financials_avg_meta);
    repaint(bizId);
  }
  function savePatch(bizId){
    const st = STATE[bizId];
    if (!st) return {};
    return metaPatch(st.saved, plannedFor(bizId));
  }
  function forget(bizId){ delete STATE[bizId]; delete BEFORE[bizId]; }

  function previewHtml(file, res){
    const created = file.created_at ? new Date(file.created_at).toLocaleDateString('he-IL') : '';
    const lines = FIELDS.map(f => {
      const r = res.rows[f.row];
      if (!r) return `<li><b>${f.label}:</b> לא נמצאה שורה מתאימה בניתוח - השדה לא שונה.</li>`;
      if (!r.used.length) return `<li><b>${f.label}:</b> אין שנים עם נתון («${escH(r.label)}») - השדה לא שונה.</li>`;
      const used = r.used.map(u => `${u.year}: ${fmt(u.value)}` + (u.file ? ` («${escH(u.file)}»)` : '')).join(' · ');
      const skipped = r.skipped.length ? `<br><span style="color:#8a93ab;">לא נכללו: ${r.skipped.map(s => `${s.year} (${escH(s.why)})`).join(' · ')}</span>` : '';
      const years = res.yearLabels[f.key] ? escH(res.yearLabels[f.key]) : ('ממוצע ' + r.used.length + ' שנים');
      return `<li><b>${f.label}</b> — ${years}<br>ממוצע ${fmt(res.exactAverages[f.key])} → יוזן ${fmt(res.averages[f.key])}<br><span style="color:#5a6172;">«${escH(r.label)}» - ${used}</span>${skipped}</li>`;
    }).join('');
    const head = res.fallback
      ? `<div style="font-weight:700;margin-bottom:4px;">מתוך הדוחות הכספיים בקבצי העסק${file && file.analysisName ? ` (בניתוח «${escH(file.analysisName)}» אין טבלה לפי שנים)` : ' (אין ניתוח כלכלי)'}</div>`
      : `<div style="font-weight:700;margin-bottom:4px;">מתוך: ${escH(file.file_name)}${created ? ' (' + created + ')' : ''}</div>`;
    return `${head}
      <ul style="margin:0;padding-inline-start:18px;line-height:1.7;">${lines}</ul>
      <div style="margin-top:6px;color:#8a5a00;">המספרים מולאו בשדות למעלה ועדיין לא נשמרו. בדוק אותם ולחץ «שמור» כדי לאשר, או בטל את הסימון כדי להחזיר את הערכים הקודמים. מחיר מבוקש לא שונה.</div>`;
  }

  async function pdfItemsOf(storagePath){
    const { data: blob, error } = await window.supabaseClient.storage.from('business-files').download(storagePath);
    if (error || !blob) throw new Error('לא ניתן להוריד את הקובץ: ' + ((error && error.message) || ''));
    return pdfItems(await blob.arrayBuffer());
  }
  // File access in one place (tests swap these for synthetic data).
  const io = { latestAnalysisFile, financialReportFiles, pdfItemsOf };

  async function toggle(bizId, checkbox){
    const box = document.getElementById('econFillPreview');
    const say = (html, color) => { if (box){ box.style.display = 'block'; box.style.color = color || '#0e1b34'; box.innerHTML = html; } };
    if (!checkbox.checked){
      if (STATE[bizId]) STATE[bizId].pending = null;
      if (BEFORE[bizId]){ FIELDS.forEach(f => { if (f.key in BEFORE[bizId]) setField(f.key, BEFORE[bizId][f.key]); }); delete BEFORE[bizId]; }
      repaint(bizId);
      if (box){ box.style.display = 'none'; box.innerHTML = ''; }
      return;
    }
    checkbox.disabled = true;
    say('⏳ קורא את הניתוח הכלכלי האחרון...', '#999');
    try {
      let file = await io.latestAnalysisFile(bizId);
      let res = null;
      if (file) res = parseFinanceTable(await io.pdfItemsOf(file.storage_path));
      if (!res || !res.ok){
        say('⏳ ' + (file ? 'בניתוח אין טבלה לפי שנים - ' : '') + 'מחפש דוחות כספיים בקבצי העסק...', '#999');
        const reports = await io.financialReportFiles(bizId);
        const parsed = [];
        for (const rf of reports){
          try { parsed.push({ file: rf, res: parseFinanceTable(await io.pdfItemsOf(rf.storage_path)) }); } catch (_e){ /* unreadable report - skip it */ }
        }
        const merged = mergeReportResults(parsed);
        if (!merged.ok){
          checkbox.checked = false;
          const why = file ? escH((res && res.message) || '') + '<br><span style="color:#5a6172;">קובץ: ' + escH(file.file_name) + '</span>' : 'לעסק הזה אין עדיין ניתוח כלכלי (PDF) בתיק המכירה.';
          const rep = reports.length
            ? `נבדקו ${reports.length} דוחות בקבצי העסק (${reports.map(r => '«' + escH(r.file_name) + '»').join(', ')}) ולא נמצאה בהם טבלה לפי שנים.`
            : 'בקבצי העסק ב-CRM אין דוח כספי (רווח והפסד / דוחות כספיים). תיקיית «דוחות» בדרייב לא מחוברת ל-CRM - כדי שהמילוי ימצא דוח, העלה אותו לקבצי העסק בסוג «דוח כספי».';
          say('⚠️ ' + why + '<br>' + rep + '<br>לא שונה דבר.', '#b3402c');
          return;
        }
        res = merged;
        file = { id: merged.files.map(f => f.id).join(','), file_name: 'דוחות כספיים', analysisName: file ? file.file_name : null };
      }
      const before = {};
      FIELDS.forEach(f => {
        if (res.averages[f.key] === null || res.averages[f.key] === undefined) return;
        const el = document.getElementById(f.key);
        if (!el) return;
        before[f.key] = el.value;
        setField(f.key, res.averages[f.key]);
      });
      if (!Object.keys(before).length){ checkbox.checked = false; say('⚠️ בניתוח לא נמצאו שנים עם נתונים לחישוב. לא שונה דבר.<br>' + previewHtml(file, res), '#b3402c'); return; }
      BEFORE[bizId] = before;
      if (!STATE[bizId]) STATE[bizId] = { saved: null, baseline: Object.assign(currentValues(), before), pending: null };
      const filledAt = new Date().toISOString();
      const pending = {};
      Object.keys(before).forEach(k => {
        const r = res.rows[FIELDS.find(f => f.key === k).row];
        pending[k] = { label: res.yearLabels[k], years: r ? r.used.map(u => u.year) : [], source_file_id: file.id, filled_at: filledAt, value: res.averages[k] };
      });
      STATE[bizId].pending = pending;
      repaint(bizId);
      say(previewHtml(file, res));
    } catch (e){
      checkbox.checked = false;
      say('⚠️ לא הצלחתי לקרוא את הניתוח הכלכלי: ' + escH((e && e.message) || e) + '. לא שונה דבר.', '#b3402c');
    } finally {
      checkbox.disabled = false;
    }
  }

  function canUse(){
    try { if (typeof sfIsAdminOrManager === 'function') return !!sfIsAdminOrManager(); } catch (_e){}
    return false;
  }

  function rowHtml(bizId){
    if (!bizId || !canUse()) return '';
    return `<div class="field full" id="econFillRow">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;">
        <input type="checkbox" id="econFillCheck" style="width:auto;" onchange="window.BSDEconFill.toggle('${String(bizId).replace(/[^0-9a-fA-F-]/g, '')}', this)">
        מלא מהניתוח הכלכלי האחרון (ממוצע השנים)
      </label>
      <div id="econFillPreview" style="display:none;font-size:.78rem;background:#f7f5ef;border:1px solid #e5e1d5;border-radius:8px;padding:8px 10px;margin-top:6px;"></div>
    </div>`;
  }

  window.BSDEconFill = { parseFinanceTable, parseMoney, rowKind, toggle, rowHtml, latestAnalysisFile, roundDown2Sig, yearsLabel, previewHtml,
    cleanMeta, planMeta, metaPatch, labelsOf, initCard, refreshSaved, savePatch, forget, _state: STATE,
    mergeReportResults, isFinancialReport, financialReportFiles, _io: io };
})();
