// 24.11.2026 (בקשת ברוך): מסך «בקשות להערכות שווי».
// v3: 3-digit numbers, visitor_attempt_no badge, repeat/blocks slice.
// Every submission of the public valuation calculator (www.bsd-bbi.co.il/הערכת-שווי-עסק/)
// lands in public.valuation_requests (RLS: active admin/manager read only).
// This file: pure helpers (tested in tests/valuation_requests.test.mjs) + the screen.
(function (root) {
  'use strict';

  const LABELS = {
    sector: {
      food: 'מסעדות, בתי קפה ומזון', retail: 'חנויות, מינימרקטים וקמעונאות', services: 'שירותים, קליניקות ומספרות',
      kids: 'חינוך, חוגים ופנאי', transport: 'תחבורה, הסעות ולוגיסטיקה', tourism: 'תיירות, מלונאות ואירוח',
      import: 'ייבוא, סיטונאות והפצה', industry: 'תעשייה, ייצור ומפעלים', online: 'טכנולוגיה, דיגיטל ומסחר מקוון', other: 'תחום אחר'
    },
    owner_dependency: { high: 'גבוהה – הכול עובר דרכי', mid: 'בינונית', low: 'נמוכה – העסק עובד גם בלעדיי' },
    staff: { new: 'רובם חדשים (עד שנה)', mid: 'מעורב', veteran: 'רובם ותיקים (3 שנים ומעלה)', none: 'אין עובדים' },
    books: { messy: 'נתונים חלקיים, לא הכול בדוחות', mid: 'סביר', organized: 'דוחות מסודרים, נהלים ומערכות' },
    location: { weak: 'מיקום חלש או שכירות קצרה', mid: 'סביר', strong: 'מיקום מצוין ושכירות ארוכה', na: 'לא רלוונטי (ללא מקום פיזי)' },
    risk: { high: 'לקוח/ספק מרכזי או סיכון מהותי', mid: 'רגיל', low: 'לקוחות וספקים מפוזרים' },
    trend: { down: 'ירידה', flat: 'יציבות', up: 'עלייה' },
    business_age: { young: 'עד 3 שנים', mid: '3 עד 10 שנים', old: 'מעל 10 שנים' }
  };
  const QUESTIONS = [
    ['sector', 'תחום העסק'], ['owner_dependency', 'תלות בבעלים'], ['staff', 'ותק העובדים'], ['books', 'סדר בעסק'],
    ['location', 'מיקום וחוזה שכירות'], ['risk', 'סיכונים'], ['trend', 'מגמת רווחים (3 שנים)'], ['business_age', 'ותק העסק']
  ];

  const VALUE_BUCKETS = [
    [0, 250000, 'עד 250 אלף'], [250000, 500000, '250–500 אלף'], [500000, 1000000, '500 אלף – מיליון'],
    [1000000, 2000000, '1–2 מיליון'], [2000000, 5000000, '2–5 מיליון'], [5000000, Infinity, 'מעל 5 מיליון']
  ];
  // v2 (24.11.2026): real headcount and annual turnover from the site form (informational only).
  const EMPLOYEE_BUCKETS = [
    [0, 1, '0 (רק הבעלים)'], [1, 3, '1–2'], [3, 6, '3–5'], [6, 11, '6–10'], [11, 21, '11–20'], [21, 51, '21–50'], [51, Infinity, '51+']
  ];
  const TURNOVER_BUCKETS = [
    [0, 1000000, 'עד מיליון'], [1000000, 3000000, '1–3 מיליון'], [3000000, 5000000, '3–5 מיליון'],
    [5000000, 10000000, '5–10 מיליון'], [10000000, 20000000, '10–20 מיליון'], [20000000, Infinity, 'מעל 20 מיליון']
  ];
  const NOT_GIVEN = 'לא צוין';
  const PROFIT_BUCKETS = [
    [-Infinity, 1, 'לא רווחי'], [1, 150000, 'עד 150 אלף'], [150000, 300000, '150–300 אלף'],
    [300000, 600000, '300–600 אלף'], [600000, 1200000, '600 אלף – 1.2 מיליון'], [1200000, Infinity, 'מעל 1.2 מיליון']
  ];

  function label(field, code) {
    if (code == null || code === '') return '—';
    return (LABELS[field] && LABELS[field][code]) || String(code);
  }
  function mid(r) {
    if (r.result_kind !== 'range' || r.value_low == null) return null;
    return (Number(r.value_low) + Number(r.value_high)) / 2;
  }
  function bucketOf(buckets, n) {
    if (n == null || !isFinite(n)) return null;
    for (const b of buckets) if (n >= b[0] && n < b[1]) return b[2];
    return null;
  }
  function num(v) { return v == null || v === '' || !isFinite(Number(v)) ? null : Number(v); }
  function employeesText(r) {
    const n = num(r.employees_count);
    if (n == null) return '—';
    return n === 0 ? '0 (רק הבעלים)' : n.toLocaleString('he-IL') + ' עובדים';
  }
  function turnoverText(r) {
    const n = num(r.annual_turnover);
    return n == null ? '—' : shortShekel(n);
  }

  function padRequestNumber(n) {
    if (n == null || n === '') return '—';
    const s = String(n);
    if (!/^\d+$/.test(s)) return s;
    return s.padStart(3, '0');
  }
  function shortVisitorKey(k) {
    const s = String(k || '');
    if (s.startsWith('vid:') && s.length > 12) return 'vid:' + s.slice(4, 12);
    if (s.length > 16) return s.slice(0, 16) + '…';
    return s || '—';
  }
  function visitorAttemptLabel(r) {
    const n = num(r && r.visitor_attempt_no);
    if (n == null) return '';
    return 'בקשה ' + n + ' של המבקר';
  }
  function isRepeatVisitor(r) { return num(r && r.visitor_attempt_no) >= 2; }
  function shekel(n) {
    if (n == null || !isFinite(Number(n))) return '—';
    return '₪' + Math.round(Number(n)).toLocaleString('he-IL');
  }
  function shortShekel(n) {
    n = Number(n);
    if (!isFinite(n)) return '—';
    if (Math.abs(n) >= 1000000) return '₪' + (n / 1000000).toLocaleString('he-IL', { maximumFractionDigits: 2 }) + 'M';
    if (Math.abs(n) >= 1000) return '₪' + Math.round(n / 1000).toLocaleString('he-IL') + 'K';
    return '₪' + Math.round(n).toLocaleString('he-IL');
  }
  function valueText(r) {
    if (r.result_kind === 'not_profitable') return 'לא רווחי – אין מכפיל';
    return shortShekel(r.value_low) + ' – ' + shortShekel(r.value_high);
  }
  // Israel time, always (the box/browser zone may differ).
  const IL_FMT = (typeof Intl !== 'undefined') ? new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }) : null;
  const IL_MONTH = (typeof Intl !== 'undefined') ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }) : null;
  function ilDateTime(iso) {
    if (!iso || !IL_FMT) return '—';
    const p = {};
    IL_FMT.formatToParts(new Date(iso)).forEach(x => { p[x.type] = x.value; });
    return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
  }
  function ilMonthKey(iso) {
    return IL_MONTH ? IL_MONTH.format(new Date(iso)).slice(0, 7) : String(iso).slice(0, 7);
  }
  const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  function monthLabel(key) {
    const [y, m] = key.split('-');
    return HE_MONTHS[Number(m) - 1] + ' ' + y;
  }

  function summarize(rows, blocks) {
    const byMonth = {};
    let withContact = 0, valued = 0, sumMid = 0;
    const repeatKeys = new Set();
    rows.forEach(r => {
      const k = ilMonthKey(r.created_at);
      byMonth[k] = (byMonth[k] || 0) + 1;
      if (r.contact_at || r.contact_name || r.contact_phone) withContact++;
      const m = mid(r);
      if (m != null) { valued++; sumMid += m; }
      if (isRepeatVisitor(r)) repeatKeys.add(r.visitor_key || ('id:' + (r.id || r.request_number)));
    });
    const months = Object.keys(byMonth).sort().reverse().map(k => ({ key: k, label: monthLabel(k), count: byMonth[k] }));
    return { total: rows.length, withContact, avgMid: valued ? sumMid / valued : null, months, repeatVisitors: repeatKeys.size, blockedAttempts: Array.isArray(blocks) ? blocks.length : 0 };
  }

  const SLICES = [
    { id: 'sector', title: 'לפי תחום', icon: '🏪', tone: 't1', key: r => label('sector', r.sector) },
    { id: 'employees', title: 'לפי מספר עובדים', icon: '👥', tone: 't2', key: r => bucketOf(EMPLOYEE_BUCKETS, num(r.employees_count)) || NOT_GIVEN, order: EMPLOYEE_BUCKETS.map(b => b[2]).concat(NOT_GIVEN) },
    { id: 'value', title: 'לפי טווחי שווי', icon: '💎', tone: 't3', key: r => r.result_kind === 'not_profitable' ? 'לא רווחי' : bucketOf(VALUE_BUCKETS, mid(r)), order: VALUE_BUCKETS.map(b => b[2]).concat('לא רווחי') },
    { id: 'profit', title: 'לפי רווח שנתי', icon: '📈', tone: 't4', key: r => bucketOf(PROFIT_BUCKETS, Number(r.profit)), order: PROFIT_BUCKETS.map(b => b[2]) },
    { id: 'turnover', title: 'לפי מחזור שנתי', icon: '💰', tone: 't5', key: r => bucketOf(TURNOVER_BUCKETS, num(r.annual_turnover)) || NOT_GIVEN, order: TURNOVER_BUCKETS.map(b => b[2]).concat(NOT_GIVEN) },
    { id: 'repeat', title: 'שימוש חוזר / חסימות', icon: '⚠', tone: 't6', kind: 'blocks', key: r => isRepeatVisitor(r) ? 'שימוש חוזר' : 'בקשה אחת' }
  ];

  function breakdown(rows, slice) {
    const map = new Map();
    rows.forEach(r => {
      const k = slice.key(r) || '—';
      const e = map.get(k) || { key: k, count: 0, sumMid: 0, valued: 0 };
      e.count++;
      const m = mid(r);
      if (m != null) { e.valued++; e.sumMid += m; }
      map.set(k, e);
    });
    let list = Array.from(map.values()).map(e => ({ key: e.key, count: e.count, pct: rows.length ? Math.round(e.count * 100 / rows.length) : 0, avgMid: e.valued ? e.sumMid / e.valued : null }));
    if (slice.order) list.sort((a, b) => (slice.order.indexOf(a.key) + 1 || 99) - (slice.order.indexOf(b.key) + 1 || 99));
    else list.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'he'));
    return list;
  }

  const api = { LABELS, QUESTIONS, SLICES, VALUE_BUCKETS, PROFIT_BUCKETS, EMPLOYEE_BUCKETS, TURNOVER_BUCKETS, NOT_GIVEN, num, employeesText, turnoverText, label, mid, bucketOf, shekel, shortShekel, valueText, padRequestNumber, shortVisitorKey, visitorAttemptLabel, isRepeatVisitor, ilDateTime, ilMonthKey, monthLabel, summarize, breakdown };
  root.BSDValuationRequests = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  // ---------------- screen ----------------
  const $ = id => document.getElementById(id);
  // numeric ranges ("1–2", "21–50", "51+") must read left-to-right inside the RTL page
  const bidiRange = html => html.replace(/\d[\d.,]*\s*[–-]\s*\d[\d.,]*|\d+\+/g, m => '<bdi dir="ltr">' + m + '</bdi>');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { all: [], blocks: [], slice: null, filter: null, q: '', showHidden: false, monthsOpen: false };

  function visible() {
    return state.all.filter(r => state.showHidden || (!r.is_archived && !r.is_test));
  }
  function visibleBlocks() {
    return (state.blocks || []).filter(b => state.showHidden || !b.is_test);
  }
  function filtered() {
    let rows = visible();
    if (state.filter) {
      const s = SLICES.find(x => x.id === state.filter.slice);
      rows = rows.filter(r => (s.key(r) || '—') === state.filter.key);
    }
    const q = state.q.trim();
    if (q) rows = rows.filter(r => [padRequestNumber(r.request_number), String(r.request_number), visitorAttemptLabel(r), r.visitor_key, r.contact_name, r.contact_phone, r.contact_email, label('sector', r.sector), r.contact_city, r.employees_count, r.annual_turnover].some(v => v && String(v).includes(q)));
    return rows;
  }

  function renderSummary() {
    const rows = visible();
    const s = summarize(rows, visibleBlocks());
    const cur = ilMonthKey(new Date().toISOString());
    const curCount = (s.months.find(m => m.key === cur) || {}).count || 0;
    const max = Math.max(1, ...s.months.map(m => m.count));
    $('sumTotal').textContent = s.total.toLocaleString('he-IL');
    $('sumMonth').textContent = curCount.toLocaleString('he-IL');
    $('sumContact').textContent = s.withContact.toLocaleString('he-IL');
    $('sumAvg').textContent = s.avgMid == null ? '—' : shortShekel(s.avgMid);
    $('sumRepeat').textContent = s.repeatVisitors.toLocaleString('he-IL');
    $('sumBlocks').textContent = s.blockedAttempts.toLocaleString('he-IL');
    $('months').innerHTML = s.months.length ? s.months.slice(0, 12).map(m =>
      `<div class="mrow"><span class="mname">${esc(m.label)}</span><span class="mbar"><i style="width:${Math.max(4, Math.round(m.count * 100 / max))}%"></i></span><b>${m.count}</b></div>`).join('')
      : '<div class="muted">עדיין אין הערכות.</div>';
  }

  function renderSlices() {
    $('slices').innerHTML = SLICES.map(s =>
      `<button type="button" class="slice ${s.tone}${state.slice === s.id ? ' on' : ''}" data-slice="${s.id}"><span class="ico">${s.icon}</span><span class="st">${esc(s.title)}</span></button>`).join('');
    const panel = $('slicePanel');
    if (!state.slice) { panel.hidden = true; return; }
    const s = SLICES.find(x => x.id === state.slice);
    panel.hidden = false;
    if (s.kind === 'blocks') {
      const blocks = visibleBlocks();
      const snapLabel = b => {
        const sn = b.snapshot || {};
        return (sn.sector_label || label('sector', sn.sector) || '—') + ' · רווח ' + shortShekel(sn.profit);
      };
      panel.innerHTML = `<div class="sp-head"><b>${esc(s.icon + ' ' + s.title)}</b><button type="button" class="x" data-close-slice aria-label="סגירה">✕</button></div>` +
        `<div class="muted small" style="margin-bottom:8px">חסימות: ${blocks.length} · מבקרים שחזרו (2–3): ${summarize(visible(), blocks).repeatVisitors}</div>` +
        (blocks.length ? blocks.map(b => `<div class="block-row">
          <b title="${esc(b.visitor_key || '')}">${esc(shortVisitorKey(b.visitor_key))} · ניסיון ${esc(b.attempt_no || (num(b.attempt_count) != null ? num(b.attempt_count) + 1 : '—'))}</b>
          <span>${esc(snapLabel(b))}</span>
          <span class="c-val">${b.snapshot && (b.snapshot.value_low != null) ? esc(shortShekel(b.snapshot.value_low) + ' – ' + shortShekel(b.snapshot.value_high)) : '—'}</span>
          <span class="c-date">${esc(ilDateTime(b.created_at))}</span></div>`).join('')
          : '<div class="muted">אין חסימות עדיין.</div>');
      return;
    }
    const list = breakdown(visible(), s);
    const max = Math.max(1, ...list.map(e => e.count));
    panel.innerHTML = `<div class="sp-head"><b>${esc(s.icon + ' ' + s.title)}</b><button type="button" class="x" data-close-slice aria-label="סגירה">✕</button></div>` +
      (list.length ? list.map(e => `<button type="button" class="brow${state.filter && state.filter.slice === s.id && state.filter.key === e.key ? ' on' : ''}" data-bkey="${esc(e.key)}">
        <span class="bname" title="${esc(e.key)}">${bidiRange(esc(e.key))}</span><span class="bbar"><i class="${s.tone}" style="width:${Math.max(4, Math.round(e.count * 100 / max))}%"></i></span>
        <span class="bnum">${e.count} · ${e.pct}%</span><span class="bavg">${e.avgMid == null ? '—' : 'ממוצע ' + shortShekel(e.avgMid)}</span></button>`).join('')
        : '<div class="muted">אין נתונים.</div>') +
      '<div class="muted small">לחיצה על שורה מסננת את הרשימה למטה.</div>';
  }

  function renderList() {
    const rows = filtered();
    const chip = $('filterChip');
    if (state.filter) {
      chip.hidden = false;
      chip.innerHTML = `מסונן: ${bidiRange(esc(state.filter.key))} <button type="button" data-clear-filter aria-label="ניקוי סינון">✕</button>`;
    } else chip.hidden = true;
    $('listCount').textContent = rows.length.toLocaleString('he-IL');
    $('list').innerHTML = rows.length ? rows.map(r => `<button type="button" class="vrow${r.is_test ? ' test' : ''}${r.is_archived ? ' arch' : ''}" data-open="${esc(r.id)}">
      <span class="c-num">מס׳ ${esc(padRequestNumber(r.request_number))}</span>
      <span class="c-sector" title="${esc(label('sector', r.sector))}">${esc(label('sector', r.sector))}</span>
      <span class="c-val">${esc(valueText(r))}</span>
      <span class="c-size" title="מספר עובדים · מחזור שנתי">${esc(employeesText(r))} · ${esc(turnoverText(r))}</span>
      <span class="c-att">${visitorAttemptLabel(r) ? esc(visitorAttemptLabel(r)) + (isRepeatVisitor(r) ? '<span class="badge-rep">⚠ שימוש חוזר</span>' : '') : '—'}</span>
      <span class="c-name" title="${esc(r.contact_name || '')}">${r.contact_name ? esc(r.contact_name) : '<span class="anon">ללא שם</span>'}</span>
      <span class="c-date">${esc(ilDateTime(r.created_at))}</span></button>`).join('')
      : '<div class="empty">אין בקשות להצגה.</div>';
  }

  function renderAll() { renderSummary(); renderSlices(); renderList(); }

  function detailRow(k, v) { return `<div class="dr"><span>${esc(k)}</span><b>${v}</b></div>`; }
  function openDetail(id) {
    const r = state.all.find(x => x.id === id);
    if (!r) return;
    const answers = detailRow('מספר עובדים', esc(employeesText(r))) +
      detailRow('מחזור שנתי', num(r.annual_turnover) == null ? '—' : '<bdi dir="ltr">' + esc(shekel(r.annual_turnover)) + '</bdi>') +
      QUESTIONS.map(([f, q]) => detailRow(q, esc(label(f, r[f])))).join('') + detailRow('רווח שנתי לבעלים', '<bdi dir="ltr">' + esc(shekel(r.profit)) + '</bdi>');
    const result = r.result_kind === 'not_profitable'
      ? detailRow('תוצאה', 'עסק לא רווחי – הוצג הסבר שמכפיל רווח לא מתאים')
      : detailRow('שווי שמרני', '<bdi dir="ltr">' + esc(shekel(r.value_low)) + '</bdi>' + ` <small>(מכפיל ${Number(r.multiple_low).toFixed(1)})</small>`) +
        detailRow('שווי גבוה', '<bdi dir="ltr">' + esc(shekel(r.value_high)) + '</bdi>' + ` <small>(מכפיל ${Number(r.multiple_high).toFixed(1)})</small>`) +
        (r.value_ups && r.value_ups.length ? detailRow('▲ העלו את השווי', esc(r.value_ups.join(' · '))) : '') +
        (r.value_downs && r.value_downs.length ? detailRow('▼ הורידו את השווי', esc(r.value_downs.join(' · '))) : '');
    const hasContact = r.contact_at || r.contact_name || r.contact_phone || r.contact_email;
    const contact = hasContact
      ? detailRow('שם', esc(r.contact_name || '—')) +
        detailRow('טלפון', r.contact_phone ? `<a href="tel:${esc(r.contact_phone)}" dir="ltr">${esc(r.contact_phone)}</a>` : '—') +
        detailRow('אימייל', r.contact_email ? `<a href="mailto:${esc(r.contact_email)}" dir="ltr">${esc(r.contact_email)}</a>` : '—') +
        detailRow('עיר', esc(r.contact_city || '—')) +
        (r.contact_purposes && r.contact_purposes.length ? detailRow('מטרה', esc(r.contact_purposes.join(', '))) : '') +
        (r.lead_id ? detailRow('ליד ב-CRM', `<a href="leads-hub.html?open=${encodeURIComponent(r.lead_id)}">פתח כרטיס ליד</a>`) : '')
      : '<div class="muted">המבקר לא השאיר פרטים (נשמר לסטטיסטיקה).</div>';
    const tech = detailRow('תאריך ושעה', esc(ilDateTime(r.created_at)) + ' <small>שעון ישראל</small>') +
      detailRow('עמוד', esc(r.page || '—')) + detailRow('הגיע מ', esc(r.referrer_host || 'ישיר')) +
      (r.utm ? detailRow('קמפיין', esc(r.utm)) : '') + detailRow('מכשיר', esc(r.device_type || '—')) +
      detailRow('גרסת מחשבון', esc(r.calc_version || '—')) +
      (r.visitor_key ? detailRow('מפתח מבקר', '<span dir="ltr">' + esc(shortVisitorKey(r.visitor_key)) + '</span>') : '') +
      (visitorAttemptLabel(r) ? detailRow('בקשה של המבקר', esc(visitorAttemptLabel(r)) + (isRepeatVisitor(r) ? ' · ⚠ שימוש חוזר' : '')) : '');
    $('sheetBody').innerHTML = `<h2>הערכת שווי מס׳ ${esc(padRequestNumber(r.request_number))}</h2>
      ${r.is_test ? '<div class="tag">בדיקה</div>' : ''}${r.is_archived ? '<div class="tag">מוסתר</div>' : ''}${visitorAttemptLabel(r) ? '<div class="tag">' + esc(visitorAttemptLabel(r)) + '</div>' : ''}${isRepeatVisitor(r) ? '<div class="tag">⚠ שימוש חוזר</div>' : ''}
      <h3>מה מילא בטופס</h3>${answers}<h3>התוצאה שקיבל</h3>${result}<h3>פרטי קשר</h3>${contact}<h3>פרטים טכניים</h3>${tech}
      <div class="sheet-actions"><button type="button" class="ghost" data-archive="${esc(r.id)}" data-to="${r.is_archived ? 'false' : 'true'}">${r.is_archived ? 'החזר לרשימה' : 'הסתר מהרשימה (בדיקה/כפילות)'}</button></div>`;
    $('drawer').hidden = false;
    try { history.replaceState(null, '', '?open=' + encodeURIComponent(r.id)); } catch (_) {}
  }
  function closeDetail() {
    $('drawer').hidden = true;
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3500);
  }

  async function setArchived(id, to) {
    const { error } = await root.supabaseClient.rpc('set_valuation_request_archived', { p_id: id, p_archived: to });
    if (error) { toast('שגיאה: ' + error.message); return; }
    const r = state.all.find(x => x.id === id);
    if (r) r.is_archived = to;
    toast(to ? 'הוסתר מהרשימה (לא נמחק)' : 'הוחזר לרשימה');
    closeDetail(); renderAll();
  }

  async function load() {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await root.supabaseClient.from('valuation_requests').select('*')
        .order('request_number', { ascending: false }).range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    state.all = out;
    const blocks = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await root.supabaseClient.from('valuation_request_blocks').select('*')
        .order('created_at', { ascending: false }).range(from, from + 999);
      if (error) throw error;
      blocks.push(...data);
      if (data.length < 1000) break;
    }
    state.blocks = blocks;
  }

  function bind() {
    document.addEventListener('click', e => {
      const t = e.target.closest ? e.target : null;
      if (!t) return;
      const sl = t.closest('[data-slice]');
      if (sl) { state.slice = state.slice === sl.dataset.slice ? null : sl.dataset.slice; renderSlices(); return; }
      if (t.closest('[data-close-slice]')) { state.slice = null; renderSlices(); return; }
      const b = t.closest('[data-bkey]');
      if (b) {
        const same = state.filter && state.filter.slice === state.slice && state.filter.key === b.dataset.bkey;
        state.filter = same ? null : { slice: state.slice, key: b.dataset.bkey };
        renderSlices(); renderList();
        if (!same) $('listPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (t.closest('[data-clear-filter]')) { state.filter = null; renderSlices(); renderList(); return; }
      const o = t.closest('[data-open]');
      if (o) { openDetail(o.dataset.open); return; }
      const a = t.closest('[data-archive]');
      if (a) { setArchived(a.dataset.archive, a.dataset.to === 'true'); return; }
      if (t.closest('[data-close-drawer]') || t === $('drawer')) closeDetail();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('drawer').hidden) closeDetail(); });
    $('search').addEventListener('input', e => { state.q = e.target.value; renderList(); });
    $('showHidden').addEventListener('change', e => { state.showHidden = e.target.checked; renderAll(); });
  }

  async function start() {
    bind();
    // Local preview only (file:// or localhost with ?demo=1): clearly-dummy rows, no network.
    const params = new URLSearchParams(location.search);
    if (root.BSD_VALUATION_DEMO_ROWS && params.get('demo') === '1' && /^(file:|http:\/\/(localhost|127\.0\.0\.1))/.test(location.href)) {
      state.all = root.BSD_VALUATION_DEMO_ROWS; state.blocks = root.BSD_VALUATION_DEMO_BLOCKS || []; $('demoBanner').hidden = false; renderAll(); return;
    }
    const profile = await root.requireAuth();
    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      document.querySelector('.wrap').innerHTML = '<div class="empty">אין הרשאה למסך זה</div>';
      return;
    }
    try { await load(); } catch (err) { toast('שגיאה בטעינה: ' + (err.message || err)); }
    renderAll();
    const open = params.get('open');
    if (open) openDetail(open);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
