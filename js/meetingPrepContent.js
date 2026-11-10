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
    if (/^(טלפון|נייד|מייל|אימייל)\b/.test(bare) && bare.length < 48) return true;
    if (/^(אתר|כתובת)\s*[:\-–]?\s*(https?:|$)/.test(bare) && bare.length < 80) return true;
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

  function stripNoise(value) {
    return String(value || '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
      .replace(/[★☆✅❌⚠▪•●◆■□═|*_#`~<>\[\]{}]/g, ' ')
      .replace(/[—–]/g, ', ')
      .replace(/BSD-[A-Z0-9-]+/gi, '')
      .replace(/\b0\d[\d\-]{7,}\b/g, '')
      .split('\n')
      .map(line => line.replace(/^[-]\s*/, '').replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  function isHeadingOnly(s) {
    return /טענות העסק|דיווח |חקר רקע|מידע נוסף/.test(s) && !/שירות|גוגל|\d{2,}/.test(s);
  }

  function period(s) {
    const t = text(s).replace(/[,:;\s]+$/, '');
    if (!t) return '';
    return /[.!?]$/.test(t) ? t : t + '.';
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

  function nextStep(ctx) {
    const c = ctx || {};
    const bag = [];
    if (c.lead) bag.push(c.lead.meeting_summary, c.lead.notes);
    if (c.biz) bag.push(c.biz.notes, c.biz.pre_research);
    (c.meetings || []).forEach(m => bag.push(m.summary_text, m.decisions, m.notes));
    const hit = bag.map(v => stripNoise(v)).find(v => /נקבעה פגישה|פגישת המשך|לחזור אל|נדבר/.test(v));
    if (!hit) return '';
    const part = pieces(hit).find(s => /נקבעה פגישה|פגישת המשך|לחזור|נדבר/.test(s)) || '';
    const day = (part.match(/יום\s+[א-ת]+/) || [])[0];
    const date = (part.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/) || [])[0];
    const time = (part.match(/\d{1,2}:\d{2}/) || [])[0];
    const when = [day, date, time && ('בשעה ' + time)].filter(Boolean).join(' ');
    return when ? 'השלב הבא: פגישה ' + when + '.' : '';
  }

  function proseCall(ctx) {
    const biz = (ctx && ctx.biz) || {};
    const owner = text(biz.owner_name);
    const cleaned = stripNoise(callEssence(ctx));
    const next = nextStep(ctx);
    if (!cleaned && !next) return '';
    const bits = pieces(cleaned).filter(s => !isStatusPiece(s) && !isContactOnly(s));
    const sentences = [];
    if (owner && /שיחה|לטענתו|לדבריו|לדברי /.test(cleaned)) sentences.push(owner + ' שוחח עם ברוך.');
    const want = bits.find(s => /מעוניין|רוצה|למכור|סיוע|השקעה|מחפש/.test(s));
    if (want) sentences.push(period(want));
    bits.filter(s => s !== want && (SUBSTANCE.test(s) || /לטענתו|לדברי/.test(s))).slice(0, 2).forEach(s => sentences.push(period(s)));
    if (!sentences.length && bits[0]) sentences.push(period(bits[0]));
    if (next) sentences.push(next);
    return clip(dedupe(sentences).join(' '), 520);
  }

  function shortLines(value, max) {
    const lines = [];
    pieces(stripNoise(value)).forEach(piece => {
      if (lines.length >= max) return;
      if (!piece || isStatusPiece(piece) || isContactOnly(piece) || isHeadingOnly(piece) || EMPTY_LINE.test(piece)) return;
      const line = clip(piece, 110);
      if (line) lines.push(line);
    });
    return lines.join('\n');
  }

  function offeringsLabel(biz) {
    const blob = [biz && biz.field, biz && biz.category, biz && biz.subcategory, biz && biz.internal_name].map(text).join(' ');
    if (/קליניק|טיפול|אסתט|קוסמט|רפוא|מרפא|רופא/.test(blob)) return 'סוגי טיפולים';
    if (/מסעד|מזון|בית קפה|מאפי|בר יינ|קייטרינג|תפריט/.test(blob)) return 'תפריט / מנות';
    if (/חנות|קמעונ|סיטונ|מסחר|מתנות|יבוא/.test(blob)) return 'קטגוריות מוצרים';
    return 'מוצרים / שירותים עיקריים';
  }

  function profileBits(blob, testRe) {
    return pieces(stripNoise(blob)).filter(s => testRe.test(s) && !isStatusPiece(s) && !isContactOnly(s) && !isHeadingOnly(s)).map(s => clip(s, 120));
  }

  function operationsProfile(biz, ctx) {
    const c = ctx || {};
    const chunks = [biz && biz.short_description, biz && biz.notes, biz && biz.pre_research, biz && biz.internal_business_summary];
    if (c.lead) chunks.push(c.lead.notes, c.lead.intake_conversation_summary, c.lead.meeting_summary);
    (c.calls || []).forEach(call => chunks.push(call.ai_gist, call.ai_body));
    (c.recordNotes || []).forEach(n => chunks.push(n.note_text));
    const blob = chunks.filter(Boolean).join('\n');
    const customers = dedupe(profileBits(blob, /לקוח|חתך לקוח|גילאי |גיל \d|קהל יעד|לקוחות חוזר|לקוחות חדש|פרטיים|עסקיים/)).slice(0, 3).join('\n');
    const tenure = dedupe(profileBits(blob, /ותק העובד|ותק עובדים|עובדים ותיק|עובד כבר|עובדים כבר|שנות ותק/)).slice(0, 2).join('\n');
    const offerings = dedupe(profileBits(blob, /שירותים|סוגי טיפול|טיפולי |תפריט|מנות|מוצרים|קטגוריות|ציוד מוצג/)).slice(0, 4).join('\n');
    return { customers, tenure, offeringsLabel: offeringsLabel(biz), offerings };
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
        if (isStatusPiece(piece) || isContactOnly(piece) || isHeadingOnly(piece) || EMPTY_LINE.test(piece)) return;
        if (/לקוח/.test(piece) && !REVIEW.test(piece) && !/שירות|מוצר|טיפול/.test(piece)) return;
        if (REVIEW.test(piece)) reviews.push(piece);
        else research.push(piece);
      });
    });
    return {
      research: dedupe(research).join('\n'),
      reviews: dedupe(reviews).join('\n')
    };
  }

  function researchBlocks(biz) {
    const storedResearch = text(biz && biz.market_research_brief);
    const storedReviews = text(biz && (biz.market_reviews || biz.reviews_summary));
    const fromPre = researchFromPre(biz && biz.pre_research);
    return {
      research: shortLines(storedResearch || fromPre.research, 6),
      reviews: shortLines(storedReviews || fromPre.reviews, 4)
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
    const profile = operationsProfile(biz, ctx);
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
    const row = (label, value) => `<tr><td>${esc(label)}</td><td><div class="value-box">${esc(value)}</div></td><td class="remarks">${esc((edits && edits[label]) || '')}</td></tr>`;
    const head = (label, value) => `<tr><th>${esc(label)}</th><td><div class="value-box">${esc(value)}</div></td><td class="remarks"></td></tr>`;
    const wide = (label, value) => {
      const empty = !String(value == null ? '' : value).trim();
      return `<tr><th>${esc(label)}</th><td><div class="${empty ? 'write-box' : 'value-box'}">${esc(value)}</div></td></tr>`;
    };
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
    const prepCtx = Object.assign({ biz }, ctx || {});
    const sections = [
      ['מהות השיחה', proseCall(prepCtx)],
      ['מה העסק עושה', whatBusinessDoes(biz)],
      ['חקר שוק', found.research],
      ['ממצאים וביקורות', found.reviews]
    ];
    const ops = [
      ['מי הלקוחות', profile.customers],
      ['ותק עובדים', profile.tenure],
      [profile.offeringsLabel, profile.offerings]
    ];
    const detailRows = details.map(([label, value]) => head(label, value)).join('');
    const sectionRows = sections.map(([label, value]) => wide(label, value)).join('');
    const opsRows = ops.map(([label, value]) => wide(label, value)).join('');
    const lines = n => Array.from({ length: n }, () => '<div class="line"></div>').join('');
    return `<h1>${esc(names.heading || 'טופס פגישה')}</h1>
      <div class="meta"><strong>BSD | טופס פגישה עם בעל עסק</strong> &nbsp; <strong>תאריך פגישה:</strong> ${esc((edits && edits.date) || '________________')} &nbsp; <strong>מספר עסק:</strong> ${esc(biz.business_number || '')}</div>
      <section><h2>פרטי העסק ואיש הקשר</h2><table class="tbl facts"><thead><tr><th>פרט</th><th>מידע קיים</th><th>תיקון / השלמה</th></tr></thead><tbody>${detailRows}</tbody></table></section>
      <section><h2>רקע לפגישה</h2><table class="tbl prose"><tbody>${sectionRows}</tbody></table></section>
      <section><h2>לקוחות, עובדים ומוצרים</h2><table class="tbl prose"><tbody>${opsRows}</tbody></table></section>
      <section><h2>נתונים עסקיים</h2><table class="tbl facts"><thead><tr><th>נושא</th><th>מידע קיים</th><th>תיקון / השלמה</th></tr></thead><tbody>${rows}</tbody></table></section>
      <section class="meeting-section"><h2>עיקרי הפגישה והשלמות</h2>${edits && edits.summary ? `<p style="white-space:pre-wrap">${esc(edits.summary)}</p>` : lines(5)}</section>
      <section class="meeting-section"><h2>החלטות והמשך טיפול</h2>${edits && edits.next ? `<p style="white-space:pre-wrap">${esc(edits.next)}</p>` : lines(3)}</section>`;
  }

  const api = {
    businessNames, whatBusinessDoes, callEssence, proseCall, researchBlocks, researchFromPre,
    offeringsLabel, operationsProfile, parseWebResearch, cleanBlock, renderPaper
  };
  root.BSDMeetingPrepContent = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
