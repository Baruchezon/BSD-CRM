// ============================================================================
// BSD-CRM: «📤 שליחת תקצירים אנונימיים» (06.10.2026)
// ----------------------------------------------------------------------------
// The toolbar button in businesses.html used to be «שלח מצגות לקונה». It only
// listed businesses with the legacy anon_presentation_path column (8 old July
// files) and sent 7-day links to those old files. Baruch's rules for this button:
//  * the list shows EVERY active business that has an anonymous summary;
//  * only anonymous material goes out: the LATEST saved anonymous-summary PDF
//    when it matches the current anonymous text, otherwise a PDF built on the
//    spot from the current anonymous text (nothing is saved or published);
//    never the internal description, notes, internal summary or profit;
//  * the buyer is picked from a search box that is always visible;
//  * sending is free: the PDF FILE goes to WhatsApp through the device share
//    sheet (tablet/phone; also Windows/Mac when supported). Where a browser
//    cannot share files, the PDF is downloaded and the buyer's WhatsApp chat is
//    opened, so the file can be attached there;
//  * after sending, «מרכז ההתאמות» is updated automatically for buyer+business
//    (existing match is updated, never duplicated; new match = «תקציר נשלח»),
//    with an activity-log row and an anon_distributions row.
// Privacy scan (Baruch, 06.10.2026 16:20): the scan NEVER blocks. A text that
// shows a city, an address, profit, a phone, an email, a link or the real name
// gets a small «⚠️ יש בטקסט: ...» note in the list and in the confirmation step;
// the sender approves it himself at send time. Still blocked (non-content):
// buyer with «אין הסכם», buyer without a valid phone, no permission, more than
// 10 businesses per send, and a business with no anonymous text at all.
// Relies on businesses.html globals: ALL_BIZ, CURRENT_PROFILE, esc, toast,
// canSendPresentations, bsdRefreshBizRow, window.BSDAnonPdf, bsdRenderBrandedPdf.
// ============================================================================
(function(){
  'use strict';

  const BUCKET = 'business-files';
  const SENT_STATUS = 'תקציר נשלח';
  const MATERIAL_TYPE = 'תקציר אנונימי';
  const MATCH_SOURCE = 'שליחת תקציר אנונימי';
  // Early statuses that move forward to «תקציר נשלח». Later stages are never moved back.
  const EARLY_STATUSES = ['התאמה חדשה', 'ממתין לחתימת סודיות', 'נחתמה סודיות', 'מידע ראשוני נשלח'];
  const MAX_SELECTED = 10;

  // ---------------------------------------------------------------- pure helpers
  function normText(v){ return (v === null || v === undefined) ? '' : String(v).replace(/\r\n?/g, '\n'); }
  function escHtml(s){ return normText(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function escapeRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Same rules as localSafetyScan in supabase/functions/generate-anonymous-card.
  const PROFIT_WORD_RE = /(^|[^\u0590-\u05FF])(ו|ה|ב|ל|ש|כ|וה|וב|של|שה)?רי?ווח(ים|יות|ית|יים|י|יו)?(?=$|[^\u0590-\u05FF])/;
  function hasHebrewWord(text, word){
    const re = new RegExp(`(^|[^\\u0590-\\u05FFa-zA-Z0-9])[ובלמהשכ]{0,2}${escapeRe(word)}(?=$|[^\\u0590-\\u05FFa-zA-Z0-9])`, 'i');
    return re.test(text);
  }
  function numberForms(n){
    const v = Math.round(Math.abs(Number(n)));
    if (!isFinite(v) || v < 10000) return [];
    return [String(v), v.toLocaleString('en-US')];
  }

  // Returns what the sender should check in the text (empty array = nothing found).
  // These are WARNINGS only: they never block sending.
  function scanAnonText(text, biz){
    biz = biz || {};
    const hits = [];
    const t = normText(text);
    if (!t.trim()) return ['אין תקציר אנונימי'];
    const lower = t.toLowerCase();
    if (/0\d{1,2}[-\s]?\d{7}/.test(t) || /0\d{1,2}-\d{3}-\d{4}/.test(t)) hits.push('מופיע מספר טלפון');
    if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(t)) hits.push('מופיע אימייל');
    if (/(https?:\/\/|www\.)/i.test(t)) hits.push('מופיע קישור לאתר');
    [['שם העסק', biz.internal_name], ['שם אנונימי ישן', biz.anonymous_name], ['שם הבעלים', biz.owner_name],
     ['כתובת', biz.address], ['אתר', biz.website], ['טלפון הבעלים', biz.owner_phone], ['מייל הבעלים', biz.owner_email]]
      .forEach(([label, val]) => {
        const v = typeof val === 'string' ? val.trim() : '';
        if (v.length >= 3 && lower.includes(v.toLowerCase())) hits.push(`מופיע ${label}`);
      });
    const city = typeof biz.city === 'string' ? biz.city.trim() : '';
    const region = typeof biz.region === 'string' ? biz.region.trim() : '';
    if (city.length >= 2 && !(region && region.includes(city)) && hasHebrewWord(t, city)) hits.push(`מופיעה העיר "${city}"`);
    if (/(^|[^\u0590-\u05FF])(ב|ו|וב)?(רחוב|רח['׳]|שד['׳]|שדרות)\s+[^\s\d,.]{2,}(\s+[^\s\d,.]{2,})?\s+\d{1,4}(?!\d)/.test(t)) hits.push('מופיעה כתובת');
    if (/(^|[^\u0590-\u05FF])(ב|ו|וב)?שכונת\s+(?!מגורים)[\u0590-\u05FF]/.test(t)) hits.push('מופיע שם שכונה');
    if (/(^|[^\u0590-\u05FF])(ב|ו|וב|ה)?כתובת(?=$|[^\u0590-\u05FF])/.test(t)) hits.push('מופיעה המילה "כתובת"');
    let profit = PROFIT_WORD_RE.test(t) || /\b(profit|ebitda)\b/i.test(t);
    if (!profit) profit = [biz.net_profit, biz.operating_profit].some(n => numberForms(n).some(f => t.includes(f)));
    if (profit) hits.push('מופיע רווח / רווחיות');
    return Array.from(new Set(hits));
  }

  // Short labels for the warning note: «עיר / רווח / כתובת / טלפון / מייל / קישור / שם».
  function warnCategories(hits){
    const cats = [];
    const add = c => { if (!cats.includes(c)) cats.push(c); };
    (hits || []).forEach(h => {
      h = String(h || '');
      if (!h || h === 'אין תקציר אנונימי') return;
      if (/העיר/.test(h)) add('עיר');
      else if (/רווח/.test(h)) add('רווח');
      else if (/כתובת|שכונה/.test(h)) add('כתובת');
      else if (/טלפון/.test(h)) add('טלפון');
      else if (/מייל/.test(h)) add('מייל');
      else if (/קישור|אתר/.test(h)) add('קישור');
      else if (/שם/.test(h)) add('שם');
      else add(h);
    });
    return cats;
  }
  function warnNote(hits){
    const cats = warnCategories(hits);
    return cats.length ? '⚠️ יש בטקסט: ' + cats.join(' / ') : '';
  }
  function hasAnonText(biz){ return !!normText(biz && biz.anon_summary).trim(); }

  function bizAnonText(biz){ return normText(biz && biz.anon_display_name).trim() + '\n' + normText(biz && biz.anon_summary).trim(); }

  // Every active (non-archived) business that has an anonymous summary text.
  function eligibleBusinesses(list){
    return (list || [])
      .filter(b => b && !b.is_archived && normText(b.anon_summary).trim())
      .slice()
      .sort((a, b) => String(b.business_number || '').localeCompare(String(a.business_number || '')));
  }

  function bizMatchesQuery(b, q){
    q = normText(q).trim().toLowerCase();
    if (!q) return true;
    return [b.business_number, b.anon_display_name, b.internal_name, b.field, b.category, b.region]
      .some(v => normText(v).toLowerCase().includes(q));
  }

  // Saved file is used only when it is the latest, level 1 (anonymous), and
  // built from the current anonymous text. Anything else => build from text.
  function chooseSource(latestFile, fresh){
    if (latestFile && fresh === true && Number(latestFile.confidentiality_level) === 1) return 'saved';
    return 'generate';
  }

  function pdfFileName(biz){
    const num = normText(biz && biz.business_number).replace(/[^\w\-]/g, '').trim();
    return (num ? `תקציר אנונימי ${num}` : 'תקציר אנונימי') + '.pdf';
  }

  function normalizePhone(phone){
    if (typeof window !== 'undefined' && typeof window.waNormalizePhone === 'function') return window.waNormalizePhone(phone);
    if (!phone || !String(phone).trim()) return { valid:false, reason:'missing', e164:null };
    const d = String(phone).replace(/\D/g, '');
    if (d.startsWith('972')) return d.length === 12 ? { valid:true, reason:null, e164:d } : { valid:false, reason:'invalid', e164:null };
    if (d.startsWith('0') && (d.length === 9 || d.length === 10)) return { valid:true, reason:null, e164:'972' + d.slice(1) };
    return { valid:false, reason: d ? 'invalid' : 'missing', e164:null };
  }

  function buyerLabel(b){ return (b && (b.full_name || [b.first_name, b.last_name].filter(Boolean).join(' ') || b.email)) || 'קונה ללא שם'; }
  function buyerFirstName(b){ return normText(b && (b.first_name || (b.full_name || '').split(' ')[0])).trim(); }

  // What to write in matches for buyer+business. Never duplicates (unique
  // buyer_id+business_id), never moves a later stage back.
  function planMatchWrite(existing, ctx){
    const common = { material_type: MATERIAL_TYPE, material_sent_at: ctx.nowIso, last_action: ctx.actionText, last_action_at: ctx.nowIso };
    if (existing && existing.id){
      const update = Object.assign({}, common);
      if (EARLY_STATUSES.includes(existing.status)) update.status = SENT_STATUS;
      return { op: 'update', id: existing.id, payload: update };
    }
    return { op: 'insert', payload: Object.assign({
      business_id: ctx.bizId, buyer_id: ctx.buyerId, counterparty_type: 'buyer', status: SENT_STATUS,
      match_source: MATCH_SOURCE, created_by: ctx.userId || null,
    }, common) };
  }

  function waGreeting(buyer){
    const first = buyerFirstName(buyer);
    return `שלום${first ? ' ' + first : ''},\nמצרף תקציר אנונימי של עסק שעשוי להתאים לך (קובץ PDF).\nאשמח לשמוע מה דעתך.\n\nBSD Business Brokers Israel`;
  }

  function isTouchDevice(){
    try { return (navigator.maxTouchPoints || 0) > 0 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''); } catch (_e){ return false; }
  }
  function canShareFiles(files){
    try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files })); } catch (_e){ return false; }
  }

  // ---------------------------------------------------------------- state + UI
  let S = null; // { buyers, buyer, rows, info{bizId:{latest,fresh,source,hits}}, selected:Set, prepared:[], recorded:Set }

  // businesses.html keeps ALL_BIZ / CURRENT_PROFILE in top-level `let` (global
  // lexical scope, not window.*); its helpers are plain global functions.
  function allBiz(){ try { return (typeof ALL_BIZ !== 'undefined' && Array.isArray(ALL_BIZ)) ? ALL_BIZ : []; } catch (_e){ return []; } }
  function profile(){ try { return (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE) ? CURRENT_PROFILE : null; } catch (_e){ return null; } }
  function g(name){ return (typeof window !== 'undefined' && typeof window[name] === 'function') ? window[name] : undefined; }
  function sb(){ return window.supabaseClient; }
  function say(msg){ const t = g('toast'); if (typeof t === 'function') t(msg); }

  function close(){
    if (S && S.prepared) S.prepared.forEach(p => { try { URL.revokeObjectURL(p.url); } catch (_e){} });
    S = null;
    const el = document.getElementById('anonSendOverlay');
    if (el) el.remove();
  }

  function setStatus(html, isError){
    const el = document.getElementById('anonSendStatus');
    if (!el) return;
    el.style.color = isError ? '#b3402c' : '#1e5c38';
    el.innerHTML = html || '';
  }

  async function open(){
    const canSend = g('canSendPresentations');
    if (typeof canSend === 'function' && !canSend()){ say('אין לך הרשאה לשלוח תקצירים אנונימיים. פנה למנהל המערכת.'); return; }
    close();
    const all = allBiz();
    S = { buyers: [], buyer: null, rows: eligibleBusinesses(all), info: {}, selected: new Set(), prepared: [], recorded: new Set(), query: '' };

    const overlay = document.createElement('div');
    overlay.id = 'anonSendOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,27,52,.55);display:flex;align-items:flex-start;justify-content:center;z-index:450;padding:12px;overflow-y:auto;-webkit-overflow-scrolling:touch;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:680px;width:100%;margin:auto 0;padding:18px 18px 16px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:'Heebo','Rubik',sans-serif;direction:rtl;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
          <h3 style="margin:0;color:#0e1b34;border-right:4px solid #25D366;padding-right:10px;font-size:1.1rem;">📤 שליחת תקצירים אנונימיים לקונה</h3>
          <button type="button" data-act="close" aria-label="סגור" style="background:none;border:none;font-size:1.6rem;line-height:1;cursor:pointer;color:#0e1b34;min-width:44px;min-height:44px;">×</button>
        </div>
        <div style="font-size:.8rem;color:#6c7488;margin-bottom:12px;line-height:1.6;">נשלח רק התקציר האנונימי כקובץ PDF, בלי תיאור פנימי ובלי הערות. אם בתקציר יש עיר, רווח או פרט מזהה, תופיע הערה ⚠️ ואתה מחליט אם לשלוח.</div>

        <label style="display:block;font-weight:700;font-size:.88rem;margin-bottom:4px;">1. קונה</label>
        <div id="anonSendBuyerBox" style="margin-bottom:6px;">טוען קונים...</div>
        <div id="anonSendBuyerInfo" style="margin-bottom:12px;"></div>

        <label style="display:block;font-weight:700;font-size:.88rem;margin-bottom:4px;">2. עסקים <span id="anonSendCount" style="font-weight:400;color:#6c7488;"></span></label>
        <input type="search" id="anonSendBizSearch" placeholder="חיפוש עסק: מספר, שם, תחום, אזור..." autocomplete="off"
          style="width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #d8d3c4;border-radius:8px;font-family:inherit;font-size:.95rem;margin-bottom:6px;">
        <div id="anonSendBizList" style="max-height:42vh;overflow-y:auto;-webkit-overflow-scrolling:touch;border:1px solid #e3ded0;border-radius:8px;padding:2px 8px;"></div>

        <div id="anonSendStatus" style="min-height:20px;margin:10px 0 6px;font-size:.86rem;font-weight:600;line-height:1.6;"></div>
        <div id="anonSendActions" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', onClick);
    overlay.addEventListener('change', onChange);
    document.getElementById('anonSendBizSearch').addEventListener('input', e => { if (S){ S.query = e.target.value; renderBizList(); } });

    renderBizList();
    renderActions();
    loadBuyers();
    loadFileInfo();
  }

  async function loadBuyers(){
    const session = S;
    const box = document.getElementById('anonSendBuyerBox');
    const me = profile();
    try {
      const all = [];
      for (let start = 0; ; start += 1000){
        let q = sb().from('leads')
          .select('id,full_name,first_name,last_name,email,phone,agreement_status,created_by,handled_by')
          .eq('type', 'buyer').eq('is_archived', false)
          .order('full_name', { ascending: true }).range(start, start + 999);
        if (me && !['admin', 'manager'].includes(me.role)) q = q.or(`created_by.eq.${me.id},handled_by.eq.${me.id}`);
        const { data, error } = await q;
        if (error) throw error;
        all.push(...(data || []));
        if ((data || []).length < 1000) break;
      }
      if (S !== session || !box) return;
      S.buyers = all;
      if (!all.length){ box.innerHTML = '<span style="color:#8a5a00;">אין קונים ברשימה שלך.</span>'; return; }
      box.innerHTML = window.searchSelectHTML({ boxId: 'anonSendBuyerSelect', placeholder: 'הקלד שם קונה לחיפוש...' });
      const input = document.getElementById('anonSendBuyerSelect_input');
      if (input) input.style.cssText += ';width:100%;box-sizing:border-box;padding:11px 12px;font-size:.95rem;border:1px solid #d8d3c4;border-radius:8px;font-family:inherit;';
      window.initSearchSelect('anonSendBuyerSelect', all, {
        getId: b => b.id,
        getLabel: b => buyerLabel(b) + (b.phone ? ' · ' + b.phone : ''),
        onChange: id => { if (!S) return; S.buyer = S.buyers.find(b => b.id === id) || null; S.recorded = new Set(); renderBuyerInfo(); renderActions(); },
      });
    } catch (e){
      if (box) box.innerHTML = `<span style="color:#b3402c;">שגיאה בטעינת קונים: ${escHtml(e.message || e)}</span>`;
    }
  }

  function buyerBlockReason(b){
    if (!b) return 'בחר קונה';
    if (!b.agreement_status || b.agreement_status === 'אין הסכם') return `לא ניתן לשלוח ל${buyerLabel(b)}: עוד לא נשלח לו הסכם התקשרות.`;
    const ph = normalizePhone(b.phone);
    if (!ph.valid) return ph.reason === 'missing' ? 'לקונה אין טלפון שמור. יש להוסיף טלפון בכרטיס הקונה.' : 'הטלפון של הקונה לא תקין לוואטסאפ. יש לתקן בכרטיס הקונה.';
    return '';
  }

  function renderBuyerInfo(){
    const el = document.getElementById('anonSendBuyerInfo');
    if (!el || !S) return;
    const b = S.buyer;
    if (!b){ el.innerHTML = ''; return; }
    const block = buyerBlockReason(b);
    el.innerHTML = `<div style="background:#f7f5ef;border-radius:8px;padding:8px 12px;font-size:.85rem;line-height:1.7;">
        <b>${escHtml(buyerLabel(b))}</b> · <span dir="ltr">${escHtml(b.phone || 'אין טלפון')}</span> · הסכם: ${escHtml(b.agreement_status || 'אין הסכם')}
      </div>${block ? `<div style="background:#fbe9e7;color:#b3402c;border-radius:8px;padding:8px 12px;font-size:.85rem;margin-top:6px;">❌ ${escHtml(block)}</div>` : ''}`;
  }

  // Latest anonymous PDF per business + is it built from the current text.
  async function loadFileInfo(){
    const session = S;
    const rows = session.rows;
    const ids = rows.map(b => b.id);
    const latestBy = {};
    try {
      for (let i = 0; i < ids.length; i += 100){
        const { data, error } = await sb().from('business_sale_files')
          .select('id,business_id,file_name,storage_path,created_at,version_number,confidentiality_level,document_type,category')
          .eq('status', 'active').in('business_id', ids.slice(i, i + 100))
          .or('document_type.eq.anonymous_summary,category.eq.anon_presentation')
          .order('created_at', { ascending: false });
        if (error) throw error;
        (data || []).forEach(f => { if (!latestBy[f.business_id]) latestBy[f.business_id] = f; });
      }
    } catch (e){ console.warn('[anonSend] טעינת קבצי PDF אנונימיים נכשלה - יופקו מהתקציר', e); }
    const api = window.BSDAnonPdf;
    await Promise.all(rows.map(async b => {
      const latest = latestBy[b.id] || null;
      let fresh = false;
      if (latest && api){
        try {
          const hash = await api.hash(b);
          const tagged = api.TAG_RE && api.TAG_RE.test(String(latest.storage_path || ''));
          const changedAt = tagged ? null : await api.changedAt(b);
          fresh = api.freshness(latest, hash, changedAt);
        } catch (_e){ fresh = false; }
      }
      session.info[b.id] = { latest, fresh, source: chooseSource(latest, fresh), hits: scanAnonText(bizAnonText(b), b) };
    }));
    if (S === session) renderBizList();
  }

  // Non-blocking note: the business stays selectable and sendable.
  function warnLabel(info){
    const note = info ? warnNote(info.hits) : '';
    return note ? `<span style="color:#8a5a00;font-weight:600;">${escHtml(note)}</span><br>` : '';
  }

  function sourceLabel(info){
    if (!info) return '<span style="color:#999;">בודק...</span>';
    if (info.source === 'saved') return `<span style="color:#1e7b34;">📄 PDF שמור, גרסה אחרונה${info.latest && info.latest.version_number ? ' ' + escHtml(info.latest.version_number) : ''}</span>`;
    return `<span style="color:#0e5a8a;">📝 PDF יופק מהתקציר האנונימי העדכני${info.latest ? ' (ה-PDF השמור ישן)' : ''}</span>`;
  }

  function renderBizList(){
    const box = document.getElementById('anonSendBizList');
    if (!box || !S) return;
    const shown = S.rows.filter(b => bizMatchesQuery(b, S.query));
    const cnt = document.getElementById('anonSendCount');
    if (cnt) cnt.textContent = `(${S.rows.length} עסקים עם תקציר אנונימי${S.query ? ', מוצגים ' + shown.length : ''}${S.selected.size ? ', נבחרו ' + S.selected.size : ''})`;
    if (!S.rows.length){ box.innerHTML = '<div style="padding:12px;color:#8a5a00;font-size:.85rem;">אין עסק פעיל עם תקציר אנונימי.</div>'; return; }
    if (!shown.length){ box.innerHTML = '<div style="padding:12px;color:#999;font-size:.85rem;">לא נמצאו עסקים לחיפוש הזה.</div>'; return; }
    box.innerHTML = shown.map(b => {
      const info = S.info[b.id];
      // Only non-content guards block a row (still loading / sold / not active / no anonymous text).
      const blocked = !info || !hasAnonText(b) || b.listing_status === 'sold' || b.listing_status === 'removed';
      const checked = S.selected.has(b.id) && !blocked;
      const stamp = b.listing_status === 'sold' ? ' · נמכר' : (b.listing_status === 'removed' ? ' · לא פעיל' : '');
      return `<label style="display:flex;gap:10px;align-items:flex-start;padding:9px 2px;border-bottom:1px solid #f0ede4;cursor:${blocked ? 'default' : 'pointer'};opacity:${blocked && info ? '.75' : '1'};">
          <input type="checkbox" data-biz="${escHtml(b.id)}" ${checked ? 'checked' : ''} ${blocked ? 'disabled' : ''} style="width:22px;height:22px;flex:0 0 auto;margin-top:2px;">
          <span style="flex:1;min-width:0;font-size:.86rem;line-height:1.55;">
            <b>${escHtml(b.business_number || '')}</b> ${escHtml(b.anon_display_name || b.field || '')}${escHtml(stamp)}
            ${b.internal_name ? `<span style="color:#999;font-size:.75rem;"> (${escHtml(b.internal_name)})</span>` : ''}
            <br><span style="font-size:.78rem;">${warnLabel(info)}${sourceLabel(info)}</span>
          </span>
        </label>`;
    }).join('');
  }

  function renderActions(){
    const box = document.getElementById('anonSendActions');
    if (!box || !S) return;
    const btn = (act, label, primary, disabled, color) => `<button type="button" data-act="${act}" ${disabled ? 'disabled' : ''}
        style="min-height:46px;padding:10px 16px;border-radius:9px;font-family:inherit;font-size:.92rem;font-weight:700;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? '.5' : '1'};
        ${primary ? `background:${color || '#0e1b34'};color:#fff;border:none;` : 'background:#fff;color:#0e1b34;border:1px solid #d8d3c4;'}">${label}</button>`;
    const ready = !buyerBlockReason(S.buyer) && S.selected.size > 0;
    if (!S.prepared.length){
      box.innerHTML = btn('close', 'ביטול', false) + btn('prepare', '📄 הכן קובץ PDF', true, !ready);
      return;
    }
    const files = S.prepared.map(p => p.file);
    const share = canShareFiles(files);
    const touch = isTouchDevice();
    const previews = S.prepared.map((p, i) => `<a href="${p.url}" target="_blank" rel="noopener" style="display:inline-block;margin:2px 0 2px 10px;color:#0e5a8a;">👁 ${escHtml(p.file.name)}</a>`).join('');
    // Confirmation step: content warnings are shown here; sending them is the sender's decision.
    const warned = S.prepared.filter(p => p.warn);
    const warnBox = warned.length ? `<div style="width:100%;background:#fff6e0;color:#8a5a00;border-radius:8px;padding:8px 12px;font-size:.82rem;line-height:1.7;margin-bottom:4px;">
        ${warned.map(p => `<div><b>${escHtml(p.biz.business_number || p.biz.anon_display_name || 'עסק')}</b>: ${escHtml(p.warn)}</div>`).join('')}
        <div>אפשר לפתוח את הקובץ ולבדוק. בלחיצה על שליחה אתה מאשר לשלוח כמו שהוא.</div></div>` : '';
    const phone = normalizePhone(S.buyer && S.buyer.phone);
    const chatUrl = phone.valid ? `https://wa.me/${phone.e164}?text=${encodeURIComponent(waGreeting(S.buyer))}` : '';
    box.innerHTML = `
      <div style="width:100%;font-size:.82rem;line-height:1.7;margin-bottom:4px;">קבצים מוכנים: ${previews}</div>
      ${warnBox}
      ${share ? `<div style="width:100%;font-size:.8rem;color:#555;line-height:1.6;">בלחיצה על «שלח בוואטסאפ» נפתח חלון השיתוף: בוחרים WhatsApp ואז את ${escHtml(buyerLabel(S.buyer))}. אם הקונה לא שמור באנשי הקשר, לחצו קודם על «פתח צ'אט עם הקונה».</div>` : `<div style="width:100%;font-size:.8rem;color:#555;line-height:1.6;">בלחיצה הקובץ יורד למחשב ונפתח צ'אט וואטסאפ עם ${escHtml(buyerLabel(S.buyer))}. גוררים את הקובץ לצ'אט (או 📎 מסמך) ולוחצים שלח.</div>`}
      ${btn('back', '↩ חזרה', false)}
      ${chatUrl && share ? `<a href="${chatUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;min-height:46px;padding:0 14px;border-radius:9px;border:1px solid #b7e0c0;color:#128C4A;text-decoration:none;font-weight:700;font-size:.9rem;">💬 פתח צ'אט עם הקונה</a>` : ''}
      ${share ? btn('share', '📲 שלח בוואטסאפ', true, false, '#25D366') : ''}
      ${(!share || !touch) ? btn('download', share ? '⬇️ הורד ופתח WhatsApp Web' : '📲 הורד PDF ופתח וואטסאפ', !share, false, '#25D366') : ''}`;
  }

  function onChange(e){
    const t = e.target;
    if (!S || !t || !t.dataset || !t.dataset.biz) return;
    if (t.checked){
      if (S.selected.size >= MAX_SELECTED){ t.checked = false; say(`אפשר לבחור עד ${MAX_SELECTED} עסקים בכל שליחה`); return; }
      S.selected.add(t.dataset.biz);
    } else S.selected.delete(t.dataset.biz);
    resetPrepared();
    renderBizList();
    renderActions();
  }

  function resetPrepared(){
    if (!S) return;
    S.prepared.forEach(p => { try { URL.revokeObjectURL(p.url); } catch (_e){} });
    S.prepared = [];
    S.recorded = new Set();
    setStatus('');
  }

  function onClick(e){
    const el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (act === 'close') close();
    else if (act === 'prepare') prepare(el);
    else if (act === 'back'){ resetPrepared(); renderActions(); }
    else if (act === 'share') shareFiles(el);
    else if (act === 'download') downloadAndOpenChat(el);
  }

  async function buildPdfFromText(biz){
    const render = g('bsdRenderBrandedPdf');
    if (typeof render !== 'function') throw new Error('רכיב הפקת ה-PDF לא נטען - רענן את הדף');
    const bodyEl = document.createElement('div');
    bodyEl.style.cssText = 'font-size:13px;line-height:1.9;white-space:pre-wrap;';
    bodyEl.textContent = normText(biz.anon_summary).trim();
    const { blob } = await render({
      titleText: `תקציר אנונימי — ${biz.anon_display_name || 'עסק'}`,
      subtitleText: [biz.business_number, new Date().toLocaleDateString('he-IL')].filter(Boolean).join(' · '),
      bodyEl,
    });
    return blob;
  }

  async function prepare(btnEl){
    if (!S) return;
    const block = buyerBlockReason(S.buyer);
    if (block){ setStatus('❌ ' + escHtml(block), true); return; }
    const ids = Array.from(S.selected);
    if (!ids.length){ setStatus('בחר לפחות עסק אחד', true); return; }
    btnEl.disabled = true; btnEl.textContent = 'מכין...';
    resetPrepared();
    const out = [];
    try {
      for (const id of ids){
        const refresh = g('bsdRefreshBizRow');
        const biz = (typeof refresh === 'function' ? await refresh(id) : null) || S.rows.find(b => b.id === id);
        if (!biz) throw new Error('עסק לא נמצא');
        const label = biz.business_number || biz.anon_display_name || 'עסק';
        setStatus(`מכין את ${escHtml(label)}...`);
        // Re-check on the FRESH row: text may have changed since the list was opened.
        // No anonymous text at all = nothing to send. Content findings are warnings only.
        if (!hasAnonText(biz)) throw new Error(`${label}: אין תקציר אנונימי. יש לכתוב תקציר אנונימי בכרטיס לפני שליחה.`);
        const warn = warnNote(scanAnonText(bizAnonText(biz), biz));
        let info = S.info[id] || {};
        let fresh = false;
        if (info.latest && window.BSDAnonPdf){
          const api = window.BSDAnonPdf;
          const hash = await api.hash(biz);
          const tagged = api.TAG_RE && api.TAG_RE.test(String(info.latest.storage_path || ''));
          fresh = api.freshness(info.latest, hash, tagged ? null : await api.changedAt(biz));
        }
        let source = chooseSource(info.latest, fresh);
        let blob = null;
        if (source === 'saved'){
          const { data, error } = await sb().storage.from(BUCKET).download(info.latest.storage_path);
          if (error || !data || data.size < 1000){ console.warn('[anonSend] הורדת ה-PDF השמור נכשלה - מפיק מהתקציר', error); source = 'generate'; }
          else blob = data;
        }
        if (source === 'generate') blob = await buildPdfFromText(biz);
        const file = new File([blob], pdfFileName(biz), { type: 'application/pdf' });
        out.push({ biz, source, savedFile: source === 'saved' ? info.latest : null, file, url: URL.createObjectURL(file), text: normText(biz.anon_summary).trim(), warn });
      }
      if (!S) return;
      S.prepared = out;
      const warned = out.filter(p => p.warn).length;
      setStatus(`✅ ${out.length === 1 ? 'הקובץ מוכן' : out.length + ' קבצים מוכנים'}. אפשר לפתוח ולבדוק לפני השליחה.${warned ? ' <span style="color:#8a5a00;">⚠️ שים לב להערות למטה.</span>' : ''}`);
    } catch (e){
      out.forEach(p => { try { URL.revokeObjectURL(p.url); } catch (_e){} });
      setStatus('❌ ' + escHtml((e && e.message) || e), true);
    } finally {
      if (S){ renderBizList(); renderActions(); }
    }
  }

  async function shareFiles(btnEl){
    if (!S || !S.prepared.length) return;
    const files = S.prepared.map(p => p.file);
    // navigator.share must run inside this click: files are already prepared.
    let shared = false;
    try {
      await navigator.share({ files, title: 'תקציר אנונימי - BSD' });
      shared = true;
    } catch (e){
      if (e && e.name === 'AbortError'){ setStatus('השליחה בוטלה. לא סומן כלום בהתאמות.', true); return; }
      setStatus('❌ השיתוף לא הצליח במכשיר הזה: ' + escHtml((e && e.message) || e) + '. אפשר להוריד את הקובץ ולצרף אותו ידנית.', true);
      if (btnEl && btnEl.parentNode && !btnEl.parentNode.querySelector('[data-act="download"]')){
        btnEl.insertAdjacentHTML('afterend', '<button type="button" data-act="download" style="min-height:46px;padding:10px 16px;border-radius:9px;background:#25D366;color:#fff;border:none;font-weight:700;font-family:inherit;">⬇️ הורד PDF ופתח וואטסאפ</button>');
      }
      return;
    }
    if (shared) await recordAll('share');
  }

  async function downloadAndOpenChat(){
    if (!S || !S.prepared.length) return;
    const phone = normalizePhone(S.buyer && S.buyer.phone);
    if (!phone.valid){ setStatus('❌ הטלפון של הקונה לא תקין', true); return; }
    const win = window.open(`https://wa.me/${phone.e164}?text=${encodeURIComponent(waGreeting(S.buyer))}`, '_blank');
    S.prepared.forEach(p => {
      const a = document.createElement('a');
      a.href = p.url; a.download = p.file.name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    });
    if (!win) setStatus('⚠️ הדפדפן חסם את פתיחת וואטסאפ. אפשר לפתוח את הצ\'אט ידנית.', true);
    await recordAll('download');
  }

  // After sending: matches + match_activity_log + anon_distributions + activity log.
  async function recordOne(p, buyer, me, via){
    const nowIso = new Date().toISOString();
    const actionText = `נשלח לקונה תקציר אנונימי (PDF) בוואטסאפ: ${p.file.name}`;
    let matchId = null, action = 'failed';
    const ctx = { nowIso, actionText, bizId: p.biz.id, buyerId: buyer.id, userId: me && me.id };
    let { data: existing, error: findErr } = await sb().from('matches').select('id,status').eq('business_id', p.biz.id).eq('buyer_id', buyer.id).maybeSingle();
    if (findErr) throw findErr;
    let plan = planMatchWrite(existing, ctx);
    if (plan.op === 'insert'){
      const { data, error } = await sb().from('matches').insert(plan.payload).select('id').single();
      if (error && String(error.code) === '23505'){
        ({ data: existing } = await sb().from('matches').select('id,status').eq('business_id', p.biz.id).eq('buyer_id', buyer.id).maybeSingle());
        plan = planMatchWrite(existing, ctx);
      } else if (error) throw error;
      else { matchId = data.id; action = 'created'; }
    }
    if (plan.op === 'update'){
      const { error } = await sb().from('matches').update(plan.payload).eq('id', plan.id);
      if (error) throw error;
      matchId = plan.id; action = 'updated';
    }
    try {
      await sb().from('match_activity_log').insert({
        match_id: matchId, action_type: 'תקציר אנונימי נשלח', description: actionText,
        note: p.source === 'saved' ? `PDF שמור${p.savedFile && p.savedFile.version_number ? ' גרסה ' + p.savedFile.version_number : ''}` : 'PDF הופק מהתקציר האנונימי העדכני',
        attached_file_id: p.savedFile ? p.savedFile.id : null, performed_by: me && me.id,
      });
    } catch (e){ console.warn('[anonSend] match_activity_log', e); }
    try {
      const { error } = await sb().from('anon_distributions').insert({
        business_id: p.biz.id, buyer_id: buyer.id, sender_user_id: me && me.id, match_id: matchId,
        distribution_type: p.savedFile ? 'extended' : 'primary',
        anon_file_id: p.savedFile ? p.savedFile.id : null, anon_file_source: p.savedFile ? 'sale_file' : null,
        summary_snapshot: p.savedFile ? null : p.text,
        channel: 'whatsapp', delivery_status: 'sent', subject: 'תקציר אנונימי', message: `${p.file.name} (${via === 'share' ? 'שיתוף קובץ' : 'הורדה וצירוף'})`,
      });
      if (error) console.warn('[anonSend] anon_distributions', error.message);
    } catch (e){ console.warn('[anonSend] anon_distributions', e); }
    const log = g('bsdLogActivity');
    if (typeof log === 'function') { try { log('anon_summary_sent_whatsapp', 'businesses', p.biz.id, { buyer_id: buyer.id, match_id: matchId, source: p.source, file_id: p.savedFile ? p.savedFile.id : null, via }); } catch (_e){} }
    return action;
  }

  async function recordAll(via){
    if (!S) return;
    const buyer = S.buyer, me = profile();
    const todo = S.prepared.filter(p => !S.recorded.has(p.biz.id));
    if (!todo.length){ setStatus('✅ נשלח. ההתאמות כבר סומנו.'); return; }
    setStatus('מסמן במרכז ההתאמות...');
    let created = 0, updated = 0; const failed = [];
    for (const p of todo){
      try {
        const a = await recordOne(p, buyer, me, via);
        S.recorded.add(p.biz.id);
        if (a === 'created') created++; else if (a === 'updated') updated++;
      } catch (e){ failed.push((p.biz.business_number || 'עסק') + ': ' + ((e && e.message) || e)); }
    }
    const parts = [];
    if (created) parts.push(`${created} התאמות חדשות`);
    if (updated) parts.push(`${updated} התאמות עודכנו`);
    let msg = `✅ ${via === 'share' ? 'נשלח' : 'הקובץ ירד ונפתח צ\'אט עם הקונה'}. במרכז ההתאמות סומן ש${escHtml(buyerLabel(buyer))} קיבל תקציר אנונימי${parts.length ? ' (' + parts.join(', ') + ')' : ''}.`;
    if (failed.length) msg += `<br><span style="color:#b3402c;">⚠️ לא סומן: ${escHtml(failed.join(' | '))}</span>`;
    setStatus(msg, false);
    // matches caches are cleared automatically by BSDDataCache.observeWrites (js/config.js).
  }

  window.openAnonSummarySendModal = open;
  window.BSDAnonSend = { scanAnonText, warnCategories, warnNote, hasAnonText, eligibleBusinesses, bizMatchesQuery, chooseSource, pdfFileName, normalizePhone,
    planMatchWrite, waGreeting, buyerLabel, hasHebrewWord, PROFIT_WORD_RE, EARLY_STATUSES, SENT_STATUS, MATERIAL_TYPE, close,
    _recordOne: recordOne };
})();
