/* Meeting-prep text. Internal only: nothing here is sent to a client.
   Pure functions so the printable form can be checked without a browser. */
(function (root) {
  'use strict';

  const CALL_MARK = /שיחה|לדבריו|לטענתו|לפי ברוך|הערת ברוך|דיווח|הערות שיחה|סיכום שיחה/;
  const STATUS = /נקבעה פגישה|האירוע ביומן|נפתח כרטיס|אין הסכם|יש הסכם|נשלח הסכם|לא מאומת מול|מאומת מול|הערת דנה|חסרים:|ליד:\s*BSD|^סטטוס\b|כרטיס נפתח/;
  const SUBSTANCE = /לטענתו|לדבריו|שכירות|מחזור|עובד|ציוד|פועל|הושקע|טיפול|מוצר|שירות|מפעל|חנות|קליניקה/;
  const REVIEW = /ביקור|דירוג|כוכב|גוגל|welp|medreview|איזי/i;
  const EMPTY_LINE = /^(לא נמצא|לא ידוע|לא תועד|אין מידע|אין נתונים|לא אותר|לא דווח)/;

  function text(v) {
    return v == null ? '' : String(v).trim();
  }

  function sameName(a, b) {
    const norm = s => text(s).replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
    const x = norm(a);
    const y = norm(b);
    return !!x && x === y;
  }

  function businessNames(biz, lead) {
    const owner = text(biz && biz.owner_name);
    const candidates = [
      biz && biz.internal_name,
      lead && lead.business_name,
      lead && lead.company,
      lead && lead.lead_business_label
    ].map(text).filter(Boolean);
    const businessName = candidates.find(n => !sameName(n, owner)) || '';
    return { businessName, heading: businessName || owner };
  }

  function whatBusinessDoes(biz) {
    const desc = text(biz && biz.short_description);
    if (desc) return desc;
    return [biz && biz.field, biz && biz.category, biz && biz.subcategory].map(text).filter(Boolean).join(' · ');
  }

  function pieces(value) {
    return text(value)
      .split(/\n+|(?<=[.!?])\s+/)
      .map(s => s.replace(/^[-•–—*]\s*/, '').replace(/\s+/g, ' ').trim())
      .filter(s => s.length > 1);
  }

  function isStatusPiece(s) {
    if (/נקבעה פגישה|האירוע ביומן/.test(s)) return true;
    return STATUS.test(s) && !SUBSTANCE.test(s);
  }

  function isContactOnly(s) {
    const bare = s.replace(/^[-•–—*]\s*/, '');
    if (/^(טלפון|נייד|אתר|מייל|אימייל|כתובת)\b/.test(bare)) return true;
    const letters = bare.replace(/https?:\/\/\S+/g, '').replace(/[\w.+-]+@[\w.-]+/g, '').replace(/[+\d][\d\s().-]{6,}/g, '').replace(/[^\p{L}]+/gu, '');
    return letters.length < 2;
  }

  function fromCallMarker(value) {
    const raw = text(value);
    const at = raw.search(CALL_MARK);
    if (at < 0) return '';
    return raw.slice(at).replace(/^הערת ברוך[^[\]]*]\s*/, 'לפי ברוך: ');
  }

  function clip(value, max) {
    const t = text(value);
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
    return (at > max * 0.55 ? cut.slice(0, at) : cut).trim();
  }

  function usable(value, requireSignal, max) {
    const body = requireSignal ? fromCallMarker(value) : text(value);
    if (!body) return '';
    const kept = pieces(body).filter(s => !isStatusPiece(s) && !isContactOnly(s));
    return clip(kept.join(' '), max || 750);
  }

  function dedupe(list) {
    const out = [];
    list.filter(Boolean).forEach(item => {
      const key = item.slice(0, 48);
      if (out.some(u => u.includes(key) || item.includes(u.slice(0, 48)))) return;
      out.push(item);
    });
    return out;
  }

  function callEssence(ctx) {
    const c = ctx || {};
    const biz = c.biz || {};
    const lead = c.lead || null;
    const direct = [];
    (c.calls || []).forEach(call => {
      direct.push(usable([call.ai_gist, call.ai_body].filter(Boolean).join('\n'), false, 750));
      if (!call.ai_gist && !call.ai_body) direct.push(usable(call.transcript, false, 500));
    });
    (c.meetings || []).forEach(m => {
      direct.push(usable([m.summary_text, m.decisions, m.notes].filter(Boolean).join('\n'), false, 750));
      if (!text(m.summary_text)) direct.push(usable(m.raw_transcript, false, 500));
    });
    if (lead) {
      direct.push(usable(lead.intake_conversation_summary, false, 750));
      direct.push(usable(lead.meeting_summary, true, 750));
      direct.push(usable(lead.intake_conversation_notes, true, 750));
    }
    const noted = [];
    noted.push(usable(biz.notes, true, 750));
    if (lead) noted.push(usable(lead.notes, true, 750));
    (c.recordNotes || []).forEach(n => noted.push(usable(n.note_text, true, 750)));
    (c.activity || []).forEach(a => noted.push(usable([a.description, a.note].filter(Boolean).join('\n'), true, 500)));
    return clip(dedupe(direct.concat(noted)).join('\n'), 900);
  }

  function splitSections(value) {
    const raw = String(value || '');
    const re = /═+\s*([^\n═]+?)\s*═+/g;
    const marks = [];
    let m;
    while ((m = re.exec(raw))) marks.push({ index: m.index, title: m[1].trim(), end: m.index + m[0].length });
    if (!marks.length) return [{ title: '', body: raw }];
    const out = [];
    if (marks[0].index > 0) out.push({ title: '', body: raw.slice(0, marks[0].index) });
    marks.forEach((mark, i) => {
      const end = marks[i + 1] ? marks[i + 1].index : raw.length;
      out.push({ title: mark.title, body: raw.slice(mark.end, end) });
    });
    return out;
  }

  function cleanBlock(value) {
    return String(value || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        const bare = line.replace(/^[-•*]\s*/, '').trim();
        return bare && !EMPTY_LINE.test(bare);
      })
      .join('\n')
      .trim();
  }

  function researchFromPre(value) {
    const research = [];
    const reviews = [];
    splitSections(value).forEach(section => {
      if (/דיווח|שיחה/.test(section.title)) return;
      pieces(section.body).forEach(piece => {
        if (isStatusPiece(piece) || isContactOnly(piece) || EMPTY_LINE.test(piece)) return;
        if (REVIEW.test(piece)) reviews.push(piece);
        else research.push(piece);
      });
    });
    return {
      research: clip(dedupe(research).join('\n'), 2200),
      reviews: clip(dedupe(reviews).join('\n'), 1200)
    };
  }

  function researchBlocks(biz) {
    const storedResearch = text(biz && biz.market_research_brief);
    const storedReviews = text(biz && (biz.market_reviews || biz.reviews_summary));
    const fromPre = researchFromPre(biz && biz.pre_research);
    return {
      research: storedResearch || fromPre.research,
      reviews: storedReviews || fromPre.reviews
    };
  }

  function parseWebResearch(raw) {
    const src = String(raw || '').replace(/\r/g, '');
    const at = src.search(/^##\s*ביקורות/m);
    let research = src;
    let reviews = '';
    if (at >= 0) {
      research = src.slice(0, at);
      reviews = src.slice(at).replace(/^##\s*ביקורות[^\n]*\n?/, '');
    }
    research = research.replace(/^##\s*חקר[^\n]*\n?/, '');
    if (at < 0) {
      const lines = cleanBlock(research).split('\n');
      const reviewLines = lines.filter(line => REVIEW.test(line));
      const other = lines.filter(line => !REVIEW.test(line));
      return { research: cleanBlock(other.join('\n')), reviews: cleanBlock(reviewLines.join('\n')) };
    }
    return { research: cleanBlock(research), reviews: cleanBlock(reviews) };
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function pick(obj, keys) {
    return keys.map(k => obj[k]).find(v => v !== null && v !== undefined && String(v).trim() !== '') ?? '';
  }

  function renderPaper(biz, ctx, edits) {
    const names = businessNames(biz, ctx && ctx.lead);
    const found = researchBlocks(biz);
    const fields = [
      ['מחיר מבוקש', ['asking_price', 'price', 'sale_price']],
      ['תחום פעילות', ['field', 'business_type', 'industry']],
      ['שטח העסק', ['area_sqm', 'area', 'size_sqm']],
      ['מחזור שנתי', ['annual_revenue', 'revenue', 'turnover']],
      ['רווח תפעולי', ['operating_profit']],
      ['רווח נקי', ['net_profit']],
      ['מספר עובדים', ['employees_count', 'employee_count', 'employees']],
      ['שכר דירה', ['monthly_rent', 'rent']],
      ['תקופת שכירות', ['lease_term', 'lease_end_date']],
      ['מלאי וציוד', ['equipment', 'inventory']],
      ['סיבת מכירה', ['sale_reason', 'reason_for_sale']]
    ];
    const row = (label, value, roomy) => `<tr${roomy ? ' class="prep-research"' : ''}><td>${esc(label)}</td><td><div class="${roomy ? 'roomy-box' : 'value-box'}">${esc(value)}</div></td><td class="remarks">${esc((edits && edits[label]) || '')}</td></tr>`;
    const head = (label, value, roomy) => `<tr${roomy ? ' class="prep-research"' : ''}><th>${esc(label)}</th><td><div class="${roomy ? 'roomy-box' : 'value-box'}">${esc(value)}</div></td><td class="remarks"></td></tr>`;
    const rows = fields.map(([label, keys]) => row(label, pick(biz, keys))).join('');
    const details = [
      ['שם העסק', names.businessName],
      ['איש קשר', biz.owner_name],
      ['טלפון', biz.owner_phone],
      ['אימייל', biz.owner_email],
      ['ח.פ / ת.ז', biz.id_number],
      ['כתובת', biz.address],
      ['תחום פעילות', biz.field],
      ['קטגוריה', biz.category]
    ];
    const sections = [
      ['מהות שיחת הטלפון', callEssence(Object.assign({ biz }, ctx || {}))],
      ['מה העסק עושה', whatBusinessDoes(biz)],
      ['חקר שוק קצר', found.research, true],
      ['ביקורות וממצאים', found.reviews, true]
    ];
    const detailRows = details.map(([label, value]) => head(label, value)).join('');
    const sectionRows = sections.map(([label, value, roomy]) => head(label, value, roomy)).join('');
    const lines = n => Array.from({ length: n }, () => '<div class="line"></div>').join('');
    return `<h1>${esc(names.heading || 'טופס פגישה')}</h1>
      <div class="meta"><strong>BSD | טופס פגישה עם בעל עסק</strong> &nbsp; <strong>תאריך פגישה:</strong> ${esc((edits && edits.date) || '________________')} &nbsp; <strong>מספר עסק:</strong> ${esc(biz.business_number || '')}</div>
      <section><h2>פרטי העסק ואיש הקשר</h2><table class="tbl"><thead><tr><th>פרט</th><th>מידע קיים</th><th>תיקון / השלמה</th></tr></thead><tbody>${detailRows}</tbody></table></section>
      <section><h2>רקע לפגישה</h2><table class="tbl"><thead><tr><th>נושא</th><th>מה ידוע לנו</th><th>תיקון / הערות</th></tr></thead><tbody>${sectionRows}</tbody></table></section>
      <section><h2>נתונים עסקיים</h2><table class="tbl"><thead><tr><th>נושא</th><th>מידע קיים</th><th>תיקון / השלמה</th></tr></thead><tbody>${rows}</tbody></table></section>
      <section class="meeting-section"><h2>עיקרי הפגישה והשלמות</h2>${edits && edits.summary ? `<p style="white-space:pre-wrap">${esc(edits.summary)}</p>` : lines(4)}</section>
      <section class="meeting-section"><h2>החלטות והמשך טיפול</h2>${edits && edits.next ? `<p style="white-space:pre-wrap">${esc(edits.next)}</p>` : lines(2)}</section>`;
  }

  const api = {
    businessNames, whatBusinessDoes, callEssence, researchBlocks, researchFromPre,
    parseWebResearch, cleanBlock, renderPaper
  };
  root.BSDMeetingPrepContent = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
