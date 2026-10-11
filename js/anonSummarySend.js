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
//  * WhatsApp: on a phone/tablet the PDF FILE goes out through the share sheet.
//    On a desktop the share sheet cannot hand a file to WhatsApp, so the PDF is
//    downloaded and the buyer's chat is opened with a short message to attach.
//    If the buyer card is on the 077 channel (whatsapp_channel = 'api') and
//    js/whatsapp-api.js is loaded, the PDF is sent with whatsapp-send
//    action send_document. If that call is refused (mode off, 24h window, hook
//    not loaded), the desktop/phone path above is used and the screen says why.
//  * Email: the same anonymous PDF is attached and sent through the existing
//    send-match-summary function (Resend), from info@bsd-bbi.co.il, with a
//    Hebrew RTL introduction and the BSD signature. No logo, no identifying
//    business details.
//  * after a real send, «מרכז ההתאמות» is updated automatically for buyer+business
//    (existing match is updated, never duplicated; new match = «תקציר נשלח»),
//    with an activity-log row and an anon_distributions row.
// Privacy scan (Baruch, 06.10.2026 16:20): the scan NEVER blocks. A text that
// shows a city, an address, profit, a phone, an email, a link or the real name
// gets a small «⚠️ יש בטקסט: ...» note in the list and in the confirmation step;
// the sender approves it himself at send time. Still blocked (non-content):
// buyer with «אין הסכם», buyer with neither a valid phone nor an email,
// no permission, more than 10 businesses per send, and a business with no
// anonymous text at all. A phone alone can go by WhatsApp; an email alone by mail.
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

  // Phones and tablets can hand a PDF to WhatsApp. A desktop (including a
  // touch laptop) often reports navigator.canShare({files}) as true, then the
  // share sheet has no WhatsApp file target — the click looks like it did
  // nothing and the PDF never leaves the computer.
  function isMobileShareDevice(){
    try {
      const ua = navigator.userAgent || '';
      if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
      if (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1) return true;
      return false;
    } catch (_e){ return false; }
  }
  function canShareFiles(files){
    try { return !!(navigator.canShare && navigator.share && files && files.length && navigator.canShare({ files })); } catch (_e){ return false; }
  }

  // cloud_document | share_sheet | download_and_chat
  function whatsappRoute(opts){
    opts = opts || {};
    if (opts.channel === 'api' && opts.cloudReady) return 'cloud_document';
    if (opts.mobile && opts.canShare) return 'share_sheet';
    return 'download_and_chat';
  }

  const MAIL_FROM_ADDRESS = 'info@bsd-bbi.co.il';
  const MAIL_SIGNATURE_LINES = [
    'בברכה,',
    'צוות BSD',
    'BSD Business Brokers Israel · מחברים עסקים להזדמנויות',
    'info@bsd-bbi.co.il | www.bsd-bbi.co.il',
  ];

  function emailSubject(count){
    return count > 1 ? 'תקצירים אנונימיים של עסקים למכירה — BSD' : 'תקציר אנונימי של עסק למכירה — BSD';
  }
  function emailPlain(buyer, count){
    const first = buyerFirstName(buyer);
    const hello = `שלום${first ? ' ' + first : ''},`;
    const body = count > 1
      ? `פונים אליך מ-BSD Business Brokers Israel.\n\nמצורפים ${count} תקצירים אנונימיים של עסקים שעשויים להתאים לך. השמטנו בכוונה כל פרט מזהה, כדי לשמור על הדיסקרטיות של בעלי העסקים.\n\nנשמח לשמוע מה דעתך. אם אחד התקצירים מעניין, נשמח להמשיך בשיחה ולפרט את הצעד הבא.`
      : `פונים אליך מ-BSD Business Brokers Israel.\n\nמצורף תקציר אנונימי של עסק שעשוי להתאים לך. השמטנו בכוונה כל פרט מזהה, כדי לשמור על הדיסקרטיות של בעל העסק.\n\nנשמח לשמוע מה דעתך. אם התקציר מעניין, נשמח להמשיך בשיחה ולפרט את הצעד הבא.`;
    return [hello, '', body, '', MAIL_SIGNATURE_LINES.join('\n')].join('\n');
  }
  function emailHtml(buyer, count){
    const text = emailPlain(buyer, count);
    const body = escHtml(text).replace(/\n/g, '<br>');
    return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#1f2d3d;text-align:right;">${body}</div>`;
  }
  function buildEmailPayload(buyer, files){
    const list = files || [];
    return {
      to: normText(buyer && buyer.email).trim(),
      subject: emailSubject(list.length),
      body_text: emailPlain(buyer, list.length),
      html_body: emailHtml(buyer, list.length),
      attachments: list.map(f => ({
        base64: f.base64,
        filename: f.filename,
        contentType: 'application/pdf',
      })),
    };
  }
  function validEmail(email){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normText(email).trim());
  }

  // Codes that mean "077 did not take the file" and the manual path is safe.
  const CLOUD_FALLBACK = ['disabled', 'not_configured', 'window_closed_use_template', 'record_not_on_api_channel', 'hook_not_loaded', 'not_077', 'bad_phone'];
  const CLOUD_ERROR_TEXT = {
    disabled: 'שליחה מ-077 עדיין לא הופעלה',
    not_configured: 'חיבור ה-WhatsApp העסקי עדיין לא הוגדר',
    window_closed_use_template: 'עברו 24 שעות מההודעה האחרונה של הקונה, ולכן אי אפשר לצרף קובץ מ-077',
    record_not_on_api_channel: 'הכרטיס עדיין על הוואטסאפ האישי (054)',
    hook_not_loaded: 'חיבור השליחה מ-077 לא נטען בדף',
    not_077: 'הקונה לא משויך לערוץ 077',
    send_failed: 'השליחה מ-077 נכשלה',
    network: 'אין קשר לשרת השליחה',
    forbidden_document: 'אין הרשאה לשלוח את הקובץ',
    document_too_large: 'הקובץ גדול מדי לשליחה ב-WhatsApp',
    bad_phone: 'מספר הטלפון בכרטיס לא תקין',
  };
  function cloudErrorText(code){
    return CLOUD_ERROR_TEXT[code] || ('שגיאה: ' + (code || 'לא ידועה'));
  }
  // Hook for whatsapp-send (PR #68, merged). Loaded by js/whatsapp-api.js as
  // window.BSDWhatsApp. If the script is missing, or the buyer is not on the
  // 077 channel, callers use the share sheet or the desktop download path.
  function cloudHook(buyer){
    const api = (typeof window !== 'undefined') ? window.BSDWhatsApp : null;
    if (!api || typeof api.uploadForSend !== 'function' || typeof api.call !== 'function') {
      return { ready: false, reason: 'hook_not_loaded' };
    }
    if (!buyer || buyer.whatsapp_channel !== 'api') return { ready: false, reason: 'not_077' };
    return { ready: true, api };
  }
  function interpretCloud(res){
    if (!res) return { ok: false, fallback: false, error: 'network' };
    if (res.ok && res.message_status !== 'failed') {
      // uncertain: the provider may already have the file. Do not claim success and do not send it again.
      if (res.message_status === 'uncertain') return { ok: false, fallback: false, error: 'network', simulated: false };
      return { ok: true, simulated: !!res.simulated || res.message_status === 'simulated', id: res.provider_message_id || res.id || null };
    }
    const code = res.error || 'send_failed';
    return { ok: false, fallback: CLOUD_FALLBACK.indexOf(code) !== -1, error: code, simulated: false };
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

  async function open(opts){
    const canSend = g('canSendPresentations');
    if (typeof canSend === 'function' && !canSend()){ say('אין לך הרשאה לשלוח תקצירים אנונימיים. פנה למנהל המערכת.'); return; }
    close();
    const all = allBiz();
    const onlyId = opts && opts.businessId ? String(opts.businessId) : '';
    let rows = eligibleBusinesses(all);
    if (onlyId) rows = rows.filter(b => b.id === onlyId);
    S = { buyers: [], buyer: null, rows, info: {}, selected: new Set(), prepared: [], recorded: new Set(), query: '', onlyId, log: [], busy: false };
    if (rows.length === 1) S.selected.add(rows[0].id);

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
        <div id="anonSendLog" style="font-size:.8rem;line-height:1.55;margin:0 0 8px;"></div>
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

  // The 077 column ships with PR #68 but the migration is not applied until
  // go-live. A missing column must not hide the buyer list.
  async function attachWhatsappChannel(buyers){
    const ids = (buyers || []).map(b => b.id).filter(Boolean);
    if (!ids.length || !sb()) return;
    try {
      for (let i = 0; i < ids.length; i += 200){
        const slice = ids.slice(i, i + 200);
        const { data, error } = await sb().from('leads').select('id,whatsapp_channel').in('id', slice);
        if (error) return;
        const byId = {};
        (data || []).forEach(r => { byId[r.id] = r.whatsapp_channel || 'personal'; });
        buyers.forEach(b => { if (byId[b.id]) b.whatsapp_channel = byId[b.id]; });
      }
    } catch (_e) { /* column not migrated yet — everyone stays on the personal channel */ }
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
      await attachWhatsappChannel(all);
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

  function buyerPhoneBlock(b){
    const ph = normalizePhone(b && b.phone);
    if (!ph.valid) return ph.reason === 'missing' ? 'לקונה אין טלפון שמור. יש להוסיף טלפון בכרטיס הקונה.' : 'הטלפון של הקונה לא תקין לוואטסאפ. יש לתקן בכרטיס הקונה.';
    return '';
  }
  function buyerEmailBlock(b){
    if (!validEmail(b && b.email)) return 'לקונה אין כתובת אימייל שמורה. יש להוסיף אימייל בכרטיס הקונה.';
    return '';
  }
  // Blocks preparing a file at all. A buyer with only an email can still be
  // emailed; a buyer with only a phone can still get WhatsApp. Neither = blocked.
  function buyerBlockReason(b){
    if (!b) return 'בחר קונה';
    if (!b.agreement_status || b.agreement_status === 'אין הסכם') return `לא ניתן לשלוח ל${buyerLabel(b)}: עוד לא נשלח לו הסכם התקשרות.`;
    if (buyerPhoneBlock(b) && buyerEmailBlock(b)) return 'לקונה אין טלפון תקין לוואטסאפ ואין אימייל. יש להשלים לפחות אחד מהם בכרטיס הקונה.';
    return '';
  }

  function renderBuyerInfo(){
    const el = document.getElementById('anonSendBuyerInfo');
    if (!el || !S) return;
    const b = S.buyer;
    if (!b){ el.innerHTML = ''; return; }
    const block = buyerBlockReason(b);
    const on077 = b.whatsapp_channel === 'api';
    el.innerHTML = `<div style="background:#f7f5ef;border-radius:8px;padding:8px 12px;font-size:.85rem;line-height:1.7;">
        <b>${escHtml(buyerLabel(b))}</b><br>
        <span dir="ltr">${escHtml(b.phone || 'אין טלפון')}</span> · <span dir="ltr">${escHtml(b.email || 'אין אימייל')}</span><br>
        הסכם: ${escHtml(b.agreement_status || 'אין הסכם')}${on077 ? ' · <b>WhatsApp 077</b>' : ''}
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
    if (!S.rows.length){
      box.innerHTML = S.onlyId
        ? '<div style="padding:12px;color:#8a5a00;font-size:.85rem;">לעסק הזה אין תקציר אנונימי שמור, ולכן אין מה לשלוח. התקציר המלא הפנימי לא נשלח לקונים.</div>'
        : '<div style="padding:12px;color:#8a5a00;font-size:.85rem;">אין עסק פעיל עם תקציר אנונימי.</div>';
      return;
    }
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

  function currentWhatsappRoute(){
    if (!S) return 'download_and_chat';
    const files = S.prepared.map(p => p.file);
    const hook = cloudHook(S.buyer);
    return whatsappRoute({
      channel: S.buyer && S.buyer.whatsapp_channel,
      cloudReady: hook.ready,
      mobile: isMobileShareDevice(),
      canShare: canShareFiles(files),
    });
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
    const previews = S.prepared.map((p) => `<a href="${p.url}" target="_blank" rel="noopener" style="display:inline-block;margin:2px 0 2px 10px;color:#0e5a8a;">👁 ${escHtml(p.file.name)}</a>`).join('');
    // Confirmation step: content warnings are shown here; sending them is the sender's decision.
    const warned = S.prepared.filter(p => p.warn);
    const warnBox = warned.length ? `<div style="width:100%;background:#fff6e0;color:#8a5a00;border-radius:8px;padding:8px 12px;font-size:.82rem;line-height:1.7;margin-bottom:4px;">
        ${warned.map(p => `<div><b>${escHtml(p.biz.business_number || p.biz.anon_display_name || 'עסק')}</b>: ${escHtml(p.warn)}</div>`).join('')}
        <div>אפשר לפתוח את הקובץ ולבדוק. בלחיצה על שליחה אתה מאשר לשלוח כמו שהוא.</div></div>` : '';
    const phoneBlock = buyerPhoneBlock(S.buyer);
    const emailBlock = buyerEmailBlock(S.buyer);
    const route = currentWhatsappRoute();
    const who = escHtml(buyerLabel(S.buyer));
    const routeNote = route === 'cloud_document'
      ? `הקונה משויך ל-WhatsApp 077. «שלח בוואטסאפ» שולח את קובץ ה-PDF ישירות לצ'אט. אם 077 לא זמין כרגע, הקובץ ירד ונפתח הצ'אט כדי לצרף אותו ידנית.`
      : route === 'share_sheet'
      ? `בלחיצה על «שלח בוואטסאפ» נפתח חלון השיתוף עם קובץ ה-PDF: בוחרים WhatsApp ואז את ${who}.`
      : `במחשב אין שיתוף קבצים ל-WhatsApp. «הורד PDF ופתח וואטסאפ» מוריד את הקובץ ופותח את הצ'אט של ${who} עם הודעה קצרה. אחר כך מצרפים את הקובץ (📎 מסמך) ולוחצים שלח.`;
    const waLabel = route === 'cloud_document' ? '📲 שלח בוואטסאפ (077)' : (route === 'share_sheet' ? '📲 שלח בוואטסאפ' : '📲 הורד PDF ופתח וואטסאפ');
    const waAct = route === 'share_sheet' ? 'share' : (route === 'cloud_document' ? 'cloud' : 'download');
    box.innerHTML = `
      <div style="width:100%;font-size:.82rem;line-height:1.7;margin-bottom:4px;">קבצים מוכנים: ${previews}</div>
      ${warnBox}
      <div style="width:100%;font-size:.8rem;color:#555;line-height:1.6;">${routeNote} המייל יוצא מ-${MAIL_FROM_ADDRESS} עם ה-PDF מצורף.</div>
      ${phoneBlock ? `<div style="width:100%;font-size:.8rem;color:#8a5a00;">וואטסאפ: ${escHtml(phoneBlock)}</div>` : ''}
      ${emailBlock ? `<div style="width:100%;font-size:.8rem;color:#8a5a00;">מייל: ${escHtml(emailBlock)}</div>` : ''}
      ${btn('back', '↩ חזרה', false)}
      ${btn(waAct, waLabel, true, !!phoneBlock, '#25D366')}
      ${route !== 'download_and_chat' ? btn('download', '⬇️ הורד PDF ופתח צ\'אט', false, !!phoneBlock) : ''}
      ${btn('email', '📧 שלח PDF במייל', true, !!emailBlock, '#0e1b34')}`;
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
    else if (act === 'cloud') sendCloudOrFallback(el);
    else if (act === 'email') sendEmail(el);
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

  function pushLog(entry){
    if (!S) return;
    const row = Object.assign({ at: new Date().toISOString() }, entry);
    S.log.push(row);
    const box = document.getElementById('anonSendLog');
    if (!box) return;
    box.innerHTML = S.log.map(r => {
      const mark = r.ok ? '✅' : '⚠️';
      const ch = r.channel === 'email' ? 'מייל' : 'וואטסאפ';
      return `<div>${mark} ${escHtml(ch)} · ${escHtml(r.who || '')} · ${escHtml(r.detail || '')}</div>`;
    }).join('');
  }

  function withTimeout(promise, ms, code){
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => {
        const err = new Error(code || 'timeout');
        err.code = code || 'timeout';
        rej(err);
      }, ms);
    });
    return Promise.race([Promise.resolve(promise), timeout]).then(v => { clearTimeout(timer); return v; }, e => { clearTimeout(timer); throw e; });
  }

  function fileToBase64(file){
    const read = file && typeof file.arrayBuffer === 'function' ? file.arrayBuffer() : Promise.reject(new Error('לא ניתן לקרוא את הקובץ'));
    return read.then(buf => {
      const bytes = new Uint8Array(buf);
      let binary = '';
      const size = 0x8000;
      for (let i = 0; i < bytes.length; i += size){
        const end = i + size < bytes.length ? i + size : bytes.length;
        binary += String.fromCharCode.apply(null, bytes.subarray(i, end));
      }
      return btoa(binary);
    });
  }

  async function readInvokeError(error){
    let detail = (error && error.message) || 'שגיאת שרת';
    if (error && error.context && typeof error.context.json === 'function'){
      try {
        const b = await error.context.json();
        if (b && b.error) detail = typeof b.error === 'string' ? b.error : JSON.stringify(b.error);
      } catch (_e){}
    }
    return detail;
  }

  function cloudCodeFromThrown(err){
    const msg = String((err && (err.message || err)) || '');
    if (err && err.code && CLOUD_ERROR_TEXT[err.code]) return err.code;
    const keys = Object.keys(CLOUD_ERROR_TEXT);
    for (let i = 0; i < keys.length; i++){
      const label = CLOUD_ERROR_TEXT[keys[i]];
      if (label && msg.indexOf(label) !== -1) return keys[i];
    }
    if (/24 שעות/.test(msg)) return 'window_closed_use_template';
    if (/054/.test(msg)) return 'record_not_on_api_channel';
    if (/לא הופעלה/.test(msg)) return 'disabled';
    if (/לא הוגדר/.test(msg)) return 'not_configured';
    if (/timeout|network|Failed to fetch/i.test(msg)) return 'network';
    return 'send_failed';
  }

  function triggerPdfDownload(p){
    const a = document.createElement('a');
    a.href = p.url;
    a.download = p.file.name;
    document.body.appendChild(a);
    a.click();
    // Removing the anchor in the same turn cancels the download on desktop Chrome.
    setTimeout(() => { try { a.remove(); } catch (_e){} }, 1500);
  }

  // Staff-facing sentence after a completed attempt. A manual download never
  // claims the buyer already received the file.
  function resultMessage(via, buyer, counts){
    counts = counts || {};
    const who = buyerLabel(buyer);
    const parts = [];
    if (counts.created) parts.push(counts.created + ' התאמות חדשות');
    if (counts.updated) parts.push(counts.updated + ' התאמות עודכנו');
    const tail = parts.length ? ' (' + parts.join(', ') + ')' : '';
    if (via === 'email') return 'נשלח מייל אל ' + normText(buyer && buyer.email).trim() + ' (' + who + ') מ-' + MAIL_FROM_ADDRESS + ', עם קובץ ה-PDF מצורף. במרכז ההתאמות סומן ש' + who + ' קיבל תקציר אנונימי' + tail + '.';
    if (via === 'cloud') return 'קובץ ה-PDF נשלח ב-WhatsApp 077 אל ' + who + '. במרכז ההתאמות סומן ש' + who + ' קיבל תקציר אנונימי' + tail + '.';
    if (via === 'share') return 'הקובץ נמסר לחלון השיתוף. במרכז ההתאמות סומן ש' + who + ' קיבל תקציר אנונימי' + tail + '.';
    return 'ה-PDF ירד למחשב (אפשר גם לפתוח אותו מהקישור למעלה) ונפתח הצ\'אט של ' + who + '. צרף את הקובץ (📎 מסמך) ושלח. נרשם ביומן כממתין לצירוף ידני' + tail + '.';
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
      await downloadAndOpenChat(btnEl, 'השיתוף לא הצליח במכשיר הזה');
      return;
    }
    if (shared) await recordAll('share');
  }

  // Desktop path. window.open stays synchronous in the click (no await before it).
  // The PDF is a local download; wa.me cannot attach a file, so the status says so.
  async function downloadAndOpenChat(btnEl, reason){
    if (!S || !S.prepared.length) return;
    const phone = normalizePhone(S.buyer && S.buyer.phone);
    if (!phone.valid){ setStatus('❌ הטלפון של הקונה לא תקין', true); return; }
    const chatUrl = `https://wa.me/${phone.e164}?text=${encodeURIComponent(waGreeting(S.buyer))}`;
    const win = window.open(chatUrl, '_blank');
    S.prepared.forEach((p, i) => {
      if (i === 0) triggerPdfDownload(p);
      else setTimeout(() => triggerPdfDownload(p), i * 400);
    });
    if (!win){
      const why = reason ? escHtml(reason) + '. ' : '';
      setStatus(`⚠️ ${why}הדפדפן חסם את פתיחת וואטסאפ. ה-PDF יורד למחשב. <a href="${escHtml(chatUrl)}" target="_blank" rel="noopener">פתח את הצ'אט של ${escHtml(buyerLabel(S.buyer))}</a> וצרף את הקובץ (📎 מסמך). השליחה לא סומנה כהושלמה.`, true);
      pushLog({ channel: 'whatsapp', ok: false, who: buyerLabel(S.buyer), detail: (reason ? reason + '. ' : '') + 'חלון הוואטסאפ נחסם. הקובץ ירד, הצ\'אט לא נפתח.' });
      return;
    }
    if (reason) pushLog({ channel: 'whatsapp', ok: true, who: buyerLabel(S.buyer), detail: reason + '. עברנו להורדת PDF ופתיחת הצ\'אט.' });
    await recordAll('download');
  }

  async function sendEmail(btnEl){
    if (!S || !S.prepared.length || S.busy) return;
    const block = buyerEmailBlock(S.buyer);
    if (block){ setStatus('❌ ' + escHtml(block), true); return; }
    S.busy = true;
    if (btnEl) btnEl.disabled = true;
    setStatus('שולח את ה-PDF במייל...');
    const buyer = S.buyer;
    try {
      const files = [];
      let total = 0;
      for (const p of S.prepared){
        const base64 = await fileToBase64(p.file);
        total += base64.length;
        if (total > 7000000) throw new Error('הקבצים גדולים מדי למייל אחד. אפשר לשלוח פחות עסקים בכל פעם.');
        files.push({ base64, filename: p.file.name });
      }
      const payload = buildEmailPayload(buyer, files);
      const client = sb();
      if (!client || !client.functions || typeof client.functions.invoke !== 'function') throw new Error('שליחת המייל לא זמינה בדף הזה');
      const { data, error } = await withTimeout(client.functions.invoke('send-match-summary', { body: payload }), 25000, 'network');
      if (error) throw new Error(await readInvokeError(error));
      if (data && data.error) throw new Error(typeof data.error === 'string' ? data.error : 'השליחה נכשלה');
      await recordAll('email');
    } catch (e){
      const msg = (e && e.code === 'network') ? 'אין קשר לשרת השליחה' : ((e && e.message) || String(e));
      setStatus('❌ המייל לא נשלח: ' + escHtml(msg), true);
      pushLog({ channel: 'email', ok: false, who: buyer && buyer.email, detail: msg });
      try { await recordFailures('email', msg); } catch (_e){}
    } finally {
      if (S){ S.busy = false; renderActions(); }
    }
  }

  // 077 document send (whatsapp-send, PR #68). A refusal that means "the file
  // never left" falls through to the desktop download. A hard failure does not
  // open a second send and does not mark the buyer as having received it.
  async function sendCloudOrFallback(btnEl){
    if (!S || !S.prepared.length || S.busy) return;
    const phoneBlock = buyerPhoneBlock(S.buyer);
    if (phoneBlock){ setStatus('❌ ' + escHtml(phoneBlock), true); return; }
    const hook = cloudHook(S.buyer);
    if (!hook.ready){
      const why = cloudErrorText(hook.reason);
      pushLog({ channel: 'whatsapp', ok: false, who: buyerLabel(S.buyer), detail: why });
      return downloadAndOpenChat(btnEl, why);
    }
    S.busy = true;
    if (btnEl) btnEl.disabled = true;
    const buyer = S.buyer;
    const record = { table: 'leads', id: buyer.id };
    let sentLive = 0, simulated = 0;
    try {
      for (const p of S.prepared){
        if (!S || S.recorded.has(p.biz.id)) continue;
        setStatus('שולח את ' + escHtml(p.file.name) + ' ב-WhatsApp 077...');
        let uploaded = null;
        try {
          uploaded = await withTimeout(hook.api.uploadForSend({ record }, p.file), 25000, 'network');
        } catch (e){
          const code = (e && e.code === 'network') ? 'network' : cloudCodeFromThrown(e);
          if (CLOUD_FALLBACK.indexOf(code) !== -1 && sentLive === 0 && simulated === 0){
            pushLog({ channel: 'whatsapp', ok: false, who: buyerLabel(buyer), detail: cloudErrorText(code) });
            S.busy = false;
            return downloadAndOpenChat(btnEl, cloudErrorText(code));
          }
          await recordOne(p, buyer, profile(), 'cloud', { deliveryStatus: 'failed', deliveryError: code, markMatch: false });
          pushLog({ channel: 'whatsapp', ok: false, who: buyerLabel(buyer), detail: p.file.name + ' — ' + cloudErrorText(code) });
          setStatus('❌ ' + escHtml(cloudErrorText(code)) + '. הקובץ לא נשלח. אפשר להוריד אותו ולצרף ידנית בצ\'אט.', true);
          return;
        }
        let res;
        try {
          res = await withTimeout(hook.api.call('send_document', {
            record,
            document: { storage_path: uploaded.storage_path, filename: uploaded.filename || p.file.name },
            caption: waGreeting(buyer),
          }), 25000, 'network');
        } catch (_e){
          res = { ok: false, error: 'network' };
        }
        const interpreted = interpretCloud(res);
        if (!interpreted.ok && interpreted.fallback && sentLive === 0 && simulated === 0){
          pushLog({ channel: 'whatsapp', ok: false, who: buyerLabel(buyer), detail: cloudErrorText(interpreted.error) });
          S.busy = false;
          return downloadAndOpenChat(btnEl, cloudErrorText(interpreted.error));
        }
        if (!interpreted.ok){
          await recordOne(p, buyer, profile(), 'cloud', { deliveryStatus: 'failed', deliveryError: interpreted.error || 'send_failed', markMatch: false });
          pushLog({ channel: 'whatsapp', ok: false, who: buyerLabel(buyer), detail: p.file.name + ' — ' + cloudErrorText(interpreted.error) });
          setStatus('❌ ' + escHtml(cloudErrorText(interpreted.error)) + '. הקובץ לא סומן כנמסר לקונה.', true);
          return;
        }
        if (interpreted.simulated){
          simulated++;
          await recordOne(p, buyer, profile(), 'cloud', { deliveryStatus: 'pending', markMatch: false, deliveryError: 'simulated' });
          S.recorded.add(p.biz.id);
          pushLog({ channel: 'whatsapp', ok: false, who: buyerLabel(buyer), detail: p.file.name + ' — סימולציה, הקובץ לא יצא לקונה' });
          continue;
        }
        sentLive++;
        await recordOne(p, buyer, profile(), 'cloud');
        S.recorded.add(p.biz.id);
        pushLog({ channel: 'whatsapp', ok: true, who: buyerLabel(buyer), detail: p.file.name + ' נשלח ב-077' });
      }
      if (!S) return;
      if (simulated && !sentLive){
        setStatus('⚠️ השליחה רצה במצב סימולציה. קובץ ה-PDF לא יצא אל הקונה, ולא סומן במרכז ההתאמות שהתקציר נמסר.', true);
        return;
      }
      if (sentLive) setStatus('✅ ' + escHtml(resultMessage('cloud', buyer, {})), false);
    } catch (e){
      const msg = (e && e.message) || String(e);
      setStatus('❌ השליחה מ-077 נעצרה: ' + escHtml(msg), true);
      pushLog({ channel: 'whatsapp', ok: false, who: buyerLabel(buyer), detail: msg });
    } finally {
      if (S){ S.busy = false; renderActions(); }
    }
  }

  // After a real delivery: matches + match_activity_log + anon_distributions + activity log.
  // opts.markMatch === false (failure or simulation) writes the distribution row only.
  async function recordOne(p, buyer, me, via, opts){
    opts = opts || {};
    const nowIso = new Date().toISOString();
    const channel = via === 'email' ? 'email' : 'whatsapp';
    const deliveryStatus = opts.deliveryStatus || (via === 'download' ? 'pending' : 'sent');
    const markMatch = opts.markMatch !== false && deliveryStatus !== 'failed';
    const viaLabel = via === 'share' ? 'שיתוף קובץ' : via === 'download' ? 'הורדה וצירוף ידני' : via === 'email' ? 'מייל עם קובץ מצורף' : 'WhatsApp 077';
    const actionText = deliveryStatus === 'sent'
      ? (channel === 'email' ? `נשלח לקונה במייל תקציר אנונימי (PDF מצורף): ${p.file.name}` : `נשלח לקונה תקציר אנונימי (PDF) בוואטסאפ: ${p.file.name}`)
      : (deliveryStatus === 'failed' ? `השליחה נכשלה (${viaLabel}): ${p.file.name}` : `הוכן PDF לצירוף ידני בוואטסאפ: ${p.file.name}`);
    let matchId = null, action = deliveryStatus === 'failed' ? 'failed' : 'logged';
    if (markMatch){
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
    }
    try {
      const { error } = await sb().from('anon_distributions').insert({
        business_id: p.biz.id, buyer_id: buyer.id, sender_user_id: me && me.id, match_id: matchId,
        distribution_type: p.savedFile ? 'extended' : 'primary',
        anon_file_id: p.savedFile ? p.savedFile.id : null, anon_file_source: p.savedFile ? 'sale_file' : null,
        summary_snapshot: p.savedFile ? null : p.text,
        channel, delivery_status: deliveryStatus, delivery_error: opts.deliveryError || null,
        subject: 'תקציר אנונימי', message: `${p.file.name} (${viaLabel})`,
      });
      if (error) console.warn('[anonSend] anon_distributions', error.message);
    } catch (e){ console.warn('[anonSend] anon_distributions', e); }
    const log = g('bsdLogActivity');
    const event = channel === 'email' ? 'anon_summary_sent_email' : 'anon_summary_sent_whatsapp';
    if (typeof log === 'function') { try { log(event, 'businesses', p.biz.id, { buyer_id: buyer.id, match_id: matchId, source: p.source, file_id: p.savedFile ? p.savedFile.id : null, via, delivery_status: deliveryStatus }); } catch (_e){} }
    return action;
  }

  async function recordFailures(via, errorText){
    if (!S) return;
    const buyer = S.buyer, me = profile();
    for (const p of S.prepared){
      const key = 'fail:' + p.biz.id + ':' + via;
      if (S.recorded.has(key)) continue;
      await recordOne(p, buyer, me, via, { deliveryStatus: 'failed', deliveryError: errorText, markMatch: false });
      S.recorded.add(key);
    }
  }

  async function recordAll(via){
    if (!S) return;
    const buyer = S.buyer, me = profile();
    const todo = S.prepared.filter(p => !S.recorded.has(p.biz.id));
    if (!todo.length){ setStatus('✅ נרשם. אין קבצים חדשים לסימון.'); return; }
    setStatus('רושם ביומן...');
    let created = 0, updated = 0; const failed = [];
    for (const p of todo){
      try {
        const a = await recordOne(p, buyer, me, via);
        S.recorded.add(p.biz.id);
        if (a === 'created') created++; else if (a === 'updated') updated++;
      } catch (e){ failed.push((p.biz.business_number || 'עסק') + ': ' + ((e && e.message) || e)); }
    }
    let msg = '✅ ' + escHtml(resultMessage(via, buyer, { created, updated }));
    if (failed.length) msg += `<br><span style="color:#b3402c;">⚠️ לא נרשם: ${escHtml(failed.join(' | '))}</span>`;
    setStatus(msg, false);
    const detail = via === 'download' ? 'הורדה ופתיחת צ\'אט, ממתין לצירוף ידני' : via === 'email' ? 'PDF מצורף נשלח מ-' + MAIL_FROM_ADDRESS : via === 'cloud' ? 'PDF נשלח ב-077' : 'שיתוף קובץ';
    pushLog({ channel: via === 'email' ? 'email' : 'whatsapp', ok: !failed.length, who: via === 'email' ? (buyer && buyer.email) : buyerLabel(buyer), detail });
    // matches caches are cleared automatically by BSDDataCache.observeWrites (js/config.js).
  }

  window.openAnonSummarySendModal = open;
  window.openAnonSummarySendForBusiness = function(bizId){ return open({ businessId: bizId }); };
  window.BSDAnonSend = { scanAnonText, warnCategories, warnNote, hasAnonText, eligibleBusinesses, bizMatchesQuery, chooseSource, pdfFileName, normalizePhone,
    planMatchWrite, waGreeting, buyerLabel, hasHebrewWord, PROFIT_WORD_RE, EARLY_STATUSES, SENT_STATUS, MATERIAL_TYPE, close,
    whatsappRoute, emailHtml, emailPlain, emailSubject, buildEmailPayload, validEmail, cloudHook, interpretCloud, cloudErrorText,
    isMobileShareDevice, buyerPhoneBlock, buyerEmailBlock, buyerBlockReason, resultMessage, MAIL_FROM_ADDRESS,
    _recordOne: recordOne };
})();
