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
// The years label is shown next to each filled field and in the section heading
// while the card is open. businesses has no meta column for it, so it is not
// written to the database and does not survive a reload. Unticking restores what
// was in the fields before. Admin/manager only.
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
    return null;
  }

  // items: [{p, x, y, w, s}] (pdf.js text items, one word each). Pure function.
  function parseFinanceTable(items){
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
      header.tokens.filter(t => t.x < labelX && !YEAR_RE.test(String(t.s).trim())).forEach(t => {
        if (!HEADER_NOISE_RE.test(String(t.s).trim())) nearest(t).extra.push(String(t.s).trim());
      });
      // Table rows: the lines right under the header, while the spacing stays regular.
      const rows = [];
      let prevY = header.y, gap = null;
      for (let j = i + 1; j < lines.length; j++){
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
      const years = cols.map(c => ({
        year: c.year,
        included: !c.extra.some(x => /[\u0590-\u05FFa-zA-Z]/.test(x)),
        note: c.extra.join(' '),
      })).sort((a, b) => a.year - b.year);
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
        result.rows[f.row] = { label: r.label, used, skipped };
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
    return (data || []).find(f => !f.deleted_at && (f.file_type === 'application/pdf' || /\.pdf$/i.test(f.file_name || '') || /\.pdf$/i.test(f.storage_path || ''))) || null;
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
    });
    const heading = document.getElementById('bizFinanceHeading');
    if (!heading) return;
    const labels = FIELDS.map(f => res && res.yearLabels && res.yearLabels[f.key]).filter(Boolean);
    const same = labels.length > 0 && labels.every(l => l === labels[0]);
    heading.textContent = same ? (FINANCE_HEADING + ' · ' + labels[0]) : FINANCE_HEADING;
  }

  function previewHtml(file, res){
    const created = file.created_at ? new Date(file.created_at).toLocaleDateString('he-IL') : '';
    const lines = FIELDS.map(f => {
      const r = res.rows[f.row];
      if (!r) return `<li><b>${f.label}:</b> לא נמצאה שורה מתאימה בניתוח - השדה לא שונה.</li>`;
      if (!r.used.length) return `<li><b>${f.label}:</b> אין שנים עם נתון («${escH(r.label)}») - השדה לא שונה.</li>`;
      const used = r.used.map(u => `${u.year}: ${fmt(u.value)}`).join(' · ');
      const skipped = r.skipped.length ? `<br><span style="color:#8a93ab;">לא נכללו: ${r.skipped.map(s => `${s.year} (${escH(s.why)})`).join(' · ')}</span>` : '';
      const years = res.yearLabels[f.key] ? escH(res.yearLabels[f.key]) : ('ממוצע ' + r.used.length + ' שנים');
      return `<li><b>${f.label}</b> — ${years}<br>ממוצע ${fmt(res.exactAverages[f.key])} → יוזן ${fmt(res.averages[f.key])}<br><span style="color:#5a6172;">«${escH(r.label)}» - ${used}</span>${skipped}</li>`;
    }).join('');
    return `<div style="font-weight:700;margin-bottom:4px;">מתוך: ${escH(file.file_name)}${created ? ' (' + created + ')' : ''}</div>
      <ul style="margin:0;padding-inline-start:18px;line-height:1.7;">${lines}</ul>
      <div style="margin-top:6px;color:#8a5a00;">המספרים מולאו בשדות למעלה ועדיין לא נשמרו. בדוק אותם ולחץ «שמור» כדי לאשר, או בטל את הסימון כדי להחזיר את הערכים הקודמים. מחיר מבוקש לא שונה.</div>`;
  }

  async function toggle(bizId, checkbox){
    const box = document.getElementById('econFillPreview');
    const say = (html, color) => { if (box){ box.style.display = 'block'; box.style.color = color || '#0e1b34'; box.innerHTML = html; } };
    if (!checkbox.checked){
      if (BEFORE[bizId]){ FIELDS.forEach(f => { if (f.key in BEFORE[bizId]) setField(f.key, BEFORE[bizId][f.key]); }); delete BEFORE[bizId]; }
      paintHints(null);
      if (box){ box.style.display = 'none'; box.innerHTML = ''; }
      return;
    }
    checkbox.disabled = true;
    say('⏳ קורא את הניתוח הכלכלי האחרון...', '#999');
    try {
      const file = await latestAnalysisFile(bizId);
      if (!file){ checkbox.checked = false; say('⚠️ לעסק הזה אין עדיין ניתוח כלכלי (PDF) בתיק המכירה. לא שונה דבר.', '#b3402c'); return; }
      const { data: blob, error } = await window.supabaseClient.storage.from('business-files').download(file.storage_path);
      if (error || !blob) throw new Error('לא ניתן להוריד את קובץ הניתוח: ' + ((error && error.message) || ''));
      const res = parseFinanceTable(await pdfItems(await blob.arrayBuffer()));
      if (!res.ok){ checkbox.checked = false; say('⚠️ ' + escH(res.message) + '<br><span style="color:#5a6172;">קובץ: ' + escH(file.file_name) + '</span>', '#b3402c'); return; }
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
      paintHints(res);
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

  window.BSDEconFill = { parseFinanceTable, parseMoney, rowKind, toggle, rowHtml, latestAnalysisFile, roundDown2Sig, yearsLabel, previewHtml };
})();
