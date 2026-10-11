// BSD WhatsApp Cloud API (077-444-6707) - shared CRM client helpers. 11.10.2026, branch eldad/whatsapp-cloud-api.
// Hidden unless BSD_CONFIG.WHATSAPP_API_UI === true (default false in js/config.js), so merging this file changes
// nothing that users see. The existing 054 wa.me buttons (waSendModule.js etc.) are NOT touched by this module.
// All sending goes through the edge function whatsapp-send, which enforces mode / per-card channel / 24h window /
// consent / permissions on the server. Reads use the normal Supabase client, so RLS decides what each role sees.
(function (root) {
  'use strict';

  const ERRORS = {
    disabled: 'שליחה מ-077 עדיין לא הופעלה',
    not_configured: 'חיבור ה-WhatsApp העסקי עדיין לא הוגדר',
    record_not_on_api_channel: 'הכרטיס עדיין משויך לוואטסאפ האישי (054). מנהל יכול להעביר אותו ל-077',
    archived: 'הכרטיס בארכיון',
    phone_not_on_record: 'המספר לא שייך לכרטיס',
    dry_run_number_not_allowed: 'מצב בדיקה: אפשר לשלוח רק למספר הבדיקה של ברוך',
    window_closed_use_template: 'עברו 24 שעות מההודעה האחרונה של הלקוח. יש לבחור תבנית מאושרת',
    opted_out: 'הלקוח ביקש להסיר את עצמו. אין לשלוח לו הודעות',
    no_consent: 'אין אישור לקבלת הודעות WhatsApp בכרטיס',
    no_marketing_consent: 'אין אישור לקבלת פרסומת בכרטיס',
    already_signed: 'ההסכם כבר חתום',
    rate_limited_daily: 'הגעתם למכסת ההודעות היומית',
    rate_limited_user: 'יותר מדי הודעות בדקה. נסו שוב בעוד רגע',
    record_required_for_template: 'יש לשייך את השיחה לכרטיס לפני שליחת תבנית',
    forbidden_agreement: 'אין לך הרשאה לשלוח הסכמים',
    forbidden_record: 'אין לך הרשאה לכרטיס הזה',
    forbidden_conversation: 'אין לך הרשאה לשיחה הזו',
    forbidden_role: 'אין לך הרשאה לשלוח הודעות',
    forbidden_document: 'אין הרשאה לקובץ',
    bad_signing_url: 'קישור החתימה לא תקין',
    bad_url_target: 'הקישור לא תקין (מותר רק לאתרי BSD)',
    no_agreement_link_to_remind: 'לא נמצא הסכם שנשלח מ-077 לכרטיס הזה',
    bad_param: 'אחד השדות בתבנית חסר או לא תקין',
    bad_phone: 'מספר הטלפון בכרטיס לא תקין',
    send_failed: 'השליחה נכשלה',
    document_not_found: 'הקובץ לא נמצא',
    document_too_large: 'הקובץ גדול מדי',
    empty_text: 'אין טקסט לשליחה',
    unauthorized: 'יש להתחבר מחדש',
  };
  function errorText(code) { return ERRORS[code] || ('שגיאה: ' + (code || 'לא ידועה')); }

  const WINDOW_MS = 24 * 3600 * 1000;
  function windowState(lastInboundAt, now) {
    const t = lastInboundAt ? Date.parse(lastInboundAt) : NaN;
    const n = (now || new Date()).getTime();
    if (!Number.isFinite(t) || n - t >= WINDOW_MS) return { open: false, hoursLeft: 0, label: 'חלון 24 השעות סגור: שליחה בתבנית בלבד' };
    const h = Math.max(0, (WINDOW_MS - (n - t)) / 3600000);
    return { open: true, hoursLeft: h, label: h >= 1 ? `אפשר לכתוב חופשי עוד ${Math.floor(h)} שעות` : `אפשר לכתוב חופשי עוד ${Math.max(1, Math.round(h * 60))} דקות` };
  }
  const STATUS_ICON = { sending: '🕓', accepted: '✓', sent: '✓', delivered: '✓✓', read: '✓✓ נקרא', failed: '⚠️ נכשל', refused: '⛔ נחסם', uncertain: '❔', simulated: '🧪 סימולציה', received: '' };
  function statusIcon(s) { return STATUS_ICON[s] ?? ''; }
  const KIND = { leads: 'קונה / ליד', businesses: 'בעל עסק', brokers: 'מתווך' };
  function recordHref(table, id) {
    if (!table || !id) return null;
    const e = encodeURIComponent(id);
    return table === 'businesses' ? 'businesses.html?open=' + e : table === 'leads' ? 'leads.html?open=' + e : 'brokers.html';
  }
  function fmtPhone(e164) {
    const d = String(e164 || '');
    return d.startsWith('972') && d.length >= 11 ? '0' + d.slice(3, 5) + '-' + d.slice(5) : (d ? '+' + d : '');
  }
  function fmtTime(iso, now) {
    if (!iso) return '';
    const d = new Date(iso), n = now || new Date();
    const sameDay = d.toDateString() === n.toDateString();
    const opts = sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
    return d.toLocaleString('he-IL', Object.assign({ timeZone: 'Asia/Jerusalem' }, opts));
  }
  function isPdf(m) { return !!m && (m.media_mime === 'application/pdf' || /\.pdf$/i.test(m.media_filename || '')); }
  function isImage(m) { return !!m && /^image\//.test(m.media_mime || ''); }
  function messageTime(m) { return m.received_at || m.sent_at || m.created_at; }
  // «אשר כהסכם חתום» is offered only for a received PDF that is stored, on a card that is not yet green.
  function canConfirmAgreement(m, rec, mayConfirm) {
    return !!mayConfirm && !!m && m.direction === 'inbound' && !!m.storage_path && isPdf(m) && !m.agreement_confirmed_at
      && !!rec && rec.agreement_status !== 'יש הסכם חתום';
  }
  function conversationTitle(c) {
    return c.record_label || c.profile_name || fmtPhone(c.phone_e164);
  }
  // Template parameters the CRM fills by itself (the server rebuilds them from the record anyway).
  const AUTO_PARAMS = new Set(['first_name', 'client_number', 'agreement_number', 'agreement_kind']);
  function editableParams(t) { return (t.params || []).filter(p => !AUTO_PARAMS.has(p.key)); }
  function needsUrlTarget(t) { return !!t.url_button && !/^bsd_(agreement_to_sign|signing_reminder)$/.test(t.name); }
  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    const b = root.crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const pure = { errorText, windowState, statusIcon, recordHref, fmtPhone, fmtTime, isPdf, isImage, messageTime, canConfirmAgreement,
    conversationTitle, editableParams, needsUrlTarget, uuid, KIND };
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }

  // ---------------- browser-only ----------------
  function cfg() { return root.BSD_CONFIG || {}; }
  function enabled() { return cfg().WHATSAPP_API_UI === true; }
  function fnUrl() { return cfg().WHATSAPP_SEND_URL || (String(cfg().SUPABASE_URL || '').replace(/\/+$/, '') + '/functions/v1/whatsapp-send'); }
  function profile() {
    try { if (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE) return CURRENT_PROFILE; } catch (_) {}
    try { const s = JSON.parse(localStorage.getItem('bsd-crm-profile-v2') || 'null'); return s && s.profile; } catch (_) { return null; }
  }
  function isManager() { const p = profile(); return !!p && (p.role === 'admin' || p.role === 'manager'); }
  function mayConfirm() { const p = profile(); return !!p && p.status === 'active' && (p.role === 'admin' || p.role === 'manager' || p.can_send_agreement === true); }
  const SEND_ACTIONS = new Set(['send_template', 'send_agreement', 'send_text', 'send_document']);

  async function call(action, payload) {
    const sb = root.supabaseClient;
    const { data } = await sb.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) return { ok: false, error: 'unauthorized' };
    const body = Object.assign({ action }, payload || {});
    if (SEND_ACTIONS.has(action) && !body.client_request_id) body.client_request_id = uuid();
    try {
      const r = await fetch(fnUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: cfg().SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad_response' }));
      return Object.assign({ httpStatus: r.status }, j);
    } catch (e) { return { ok: false, error: 'network', detail: e && e.message }; }
  }
  async function openMedia(messageId, download) {
    const w = download ? null : root.open('', '_blank');
    const r = await call('media_url', { message_id: messageId, download: !!download });
    if (!r.ok || !r.url) { if (w) w.close(); throw new Error(errorText(r.error)); }
    if (w) w.location.href = r.url; else root.location.href = r.url;
  }
  // Upload a CRM file for sending: signed upload URL from the server (path inside whatsapp-outbound/<conversation>/).
  async function uploadForSend(target, file) {
    const r = await call('upload_url', Object.assign({ filename: file.name }, target));
    if (!r.ok) throw new Error(errorText(r.error));
    const up = await root.supabaseClient.storage.from(cfg().STORAGE_BUCKET || 'business-files').uploadToSignedUrl(r.path, r.token, file, { contentType: file.type || 'application/octet-stream' });
    if (up.error) throw new Error('העלאת הקובץ נכשלה: ' + up.error.message);
    return { storage_path: r.path, filename: r.filename, conversation_id: r.conversation_id };
  }
  // «אשר כהסכם חתום»: exactly the existing manual path (same storage key, same RPC, same green trigger) + a stamp.
  async function confirmAgreement(message, table, recordId) {
    const p = profile();
    if (!p) throw new Error('יש להתחבר מחדש');
    const r = await call('media_url', { message_id: message.id });
    if (!r.ok || !r.url) throw new Error(errorText(r.error));
    const res = await fetch(r.url);
    if (!res.ok) throw new Error('הורדת הקובץ נכשלה');
    const blob = await res.blob();
    if (blob.size > 20 * 1024 * 1024) throw new Error('הקובץ גדול מדי (מקסימום 20MB)');
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    if (String.fromCharCode.apply(null, head) !== '%PDF-') throw new Error('הקובץ אינו PDF תקין');
    const file = new File([blob], message.media_filename || 'agreement.pdf', { type: 'application/pdf' });
    const path = `agreements/${table}/${recordId}.pdf`;
    const up = await root.bsdUploadFile(cfg().STORAGE_BUCKET, path, file, { contentType: 'application/pdf', upsert: true });
    if (up.error) throw new Error('שגיאה בהעלאת הקובץ: ' + up.error.message);
    const s = await root.supabaseClient.rpc('save_manual_signed_agreement', { p_table_name: table, p_record_id: recordId, p_path: path, p_uploaded_by: p.id });
    if (s.error) throw new Error('הקובץ הועלה אך השיוך לכרטיס נכשל: ' + s.error.message);
    const m = await root.supabaseClient.rpc('wa_mark_document_confirmed', { p_message_id: message.id, p_table: table, p_record_id: recordId });
    if (m.error) console.warn('wa_mark_document_confirmed', m.error.message); // the card is already green; the stamp is informational
    return true;
  }
  let templatesCache = null;
  async function templates() {
    if (templatesCache) return templatesCache;
    const r = await call('list_templates');
    if (!r.ok) throw new Error(errorText(r.error));
    return (templatesCache = r.templates);
  }
  function esc(s) { return s === undefined || s === null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function toast(msg) { if (typeof root.toast === 'function') root.toast(msg); else root.alert(msg); }

  // Template picker (used by the inbox and the card). target = { conversation_id } or { record: {table,id} }.
  async function templateDialog(target, opts) {
    opts = opts || {};
    const list = (await templates()).filter(t => !opts.only || opts.only.includes(t.name)).filter(t => t.name !== 'bsd_agreement_to_sign' && t.name !== 'bsd_agreement_signed_copy');
    const ov = document.createElement('div');
    ov.className = 'bsd-wa-overlay';
    ov.innerHTML = `<div class="bsd-wa-dialog" role="dialog" aria-modal="true"><h3>שליחת תבנית מאושרת</h3>
      <select class="bsd-wa-tpl">${list.map(t => `<option value="${esc(t.name)}">${esc(t.description)}${t.category === 'MARKETING' ? ' (פרסומת)' : ''}</option>`).join('')}</select>
      <div class="bsd-wa-tpl-body"></div><div class="bsd-wa-tpl-fields"></div>
      <div class="bsd-wa-actions"><button type="button" class="btn btn-primary bsd-wa-go">שליחה</button> <button type="button" class="btn btn-ghost bsd-wa-cancel">ביטול</button></div></div>`;
    document.body.appendChild(ov);
    const sel = ov.querySelector('.bsd-wa-tpl'), fields = ov.querySelector('.bsd-wa-tpl-fields'), bodyEl = ov.querySelector('.bsd-wa-tpl-body');
    const draw = () => {
      const t = list.find(x => x.name === sel.value); if (!t) return;
      bodyEl.textContent = t.body;
      fields.innerHTML = editableParams(t).map(p => p.options
        ? `<label>${esc(p.label)}<select data-k="${esc(p.key)}">${Object.entries(p.options).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select></label>`
        : `<label>${esc(p.label)}<input data-k="${esc(p.key)}" maxlength="${p.max}" ${/date/.test(p.key) ? 'placeholder="dd.mm.yyyy"' : ''}></label>`).join('')
        + (needsUrlTarget(t) ? `<label>קישור יעד (אתר BSD בלבד)<input data-url="1" dir="ltr" placeholder="https://www.bsd-bbi.co.il/..."></label>` : '')
        + (t.header === 'DOCUMENT' ? `<label>קובץ PDF לצירוף<input type="file" data-file="1" accept="application/pdf"></label>` : '');
    };
    sel.addEventListener('change', draw); draw();
    return new Promise(resolve => {
      ov.querySelector('.bsd-wa-cancel').onclick = () => { ov.remove(); resolve(null); };
      ov.querySelector('.bsd-wa-go').onclick = async (ev) => {
        const btn = ev.currentTarget; btn.disabled = true;
        try {
          const t = list.find(x => x.name === sel.value);
          const values = {};
          fields.querySelectorAll('[data-k]').forEach(el => { values[el.dataset.k] = el.value.trim(); });
          const payload = Object.assign({ template: t.name, values }, target);
          const u = fields.querySelector('[data-url]'); if (u) payload.url_target = u.value.trim();
          const f = fields.querySelector('[data-file]');
          if (f) { if (!f.files[0]) throw new Error('יש לבחור קובץ'); payload.document = await uploadForSend(target, f.files[0]); }
          const r = await call('send_template', payload);
          if (!r.ok) throw new Error(errorText(r.error));
          toast(r.simulated ? 'נשלח בסימולציה (לא יצא בפועל)' : 'נשלח'); ov.remove(); resolve(r);
        } catch (e) { toast(e.message); btn.disabled = false; }
      };
    });
  }
  function injectStyles() {
    if (document.getElementById('bsd-wa-styles')) return;
    const s = document.createElement('style'); s.id = 'bsd-wa-styles';
    s.textContent = `.bsd-wa-overlay{position:fixed;inset:0;background:rgba(14,27,52,.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px}
.bsd-wa-dialog{background:#fff;border-radius:14px;max-width:520px;width:100%;padding:18px 20px;max-height:90vh;overflow:auto;direction:rtl}
.bsd-wa-dialog h3{margin:0 0 10px;color:#0e1b34}.bsd-wa-dialog select,.bsd-wa-dialog input{width:100%;padding:8px;border:1px solid #d8d3c4;border-radius:8px;font-family:inherit;margin-top:4px}
.bsd-wa-dialog label{display:block;margin-top:10px;font-size:.85rem;color:#444}.bsd-wa-tpl-body{background:#f6f4ee;border-radius:8px;padding:10px;margin-top:10px;font-size:.85rem;white-space:pre-wrap}
.bsd-wa-actions{margin-top:14px;display:flex;gap:8px}.bsd-wa-box{border:1px solid #d9e8dc;background:#f7fbf7;border-radius:12px;padding:12px 14px;margin:10px 0}
.bsd-wa-box h4{margin:0 0 8px;font-size:.92rem;color:#14532d}.bsd-wa-chip{display:inline-block;border-radius:10px;padding:2px 8px;font-size:.72rem;font-weight:700;background:#e7efe8;color:#14532d;margin-inline-start:6px}
.bsd-wa-chip.off{background:#eee;color:#555}.bsd-wa-tl{max-height:280px;overflow:auto;margin:8px 0;display:flex;flex-direction:column;gap:6px}
.bsd-wa-msg{max-width:85%;padding:7px 10px;border-radius:10px;font-size:.82rem;white-space:pre-wrap;word-break:break-word}
.bsd-wa-msg.in{align-self:flex-end;background:#fff;border:1px solid #e5e1d6}.bsd-wa-msg.out{align-self:flex-start;background:#dcf3e1}
.bsd-wa-meta{font-size:.68rem;color:#888;margin-top:2px}.bsd-wa-doc{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px}
.bsd-wa-doc a{color:#1f5fbf;cursor:pointer}.bsd-wa-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}`;
    document.head.appendChild(s);
  }

  root.BSDWhatsApp = Object.assign({}, pure, { enabled, call, openMedia, uploadForSend, confirmAgreement, templates, templateDialog, injectStyles,
    isManager, mayConfirm, profile, esc, toast });
})(typeof window !== 'undefined' ? window : globalThis);
