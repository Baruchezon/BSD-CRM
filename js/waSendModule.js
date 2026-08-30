// ============================================================
// "שלח WhatsApp" — manual WhatsApp template button
// Shared by leads.html / businesses.html / training-admin.html.
// Relies on each host page already defining: esc(), toast(),
// CURRENT_PROFILE, window.supabaseClient, bsdLogActivity() (from
// js/permissions.js).
//
// Behavior is strict per spec: this module NEVER sends a message
// automatically. It only ever opens a wa.me link after the user
// presses "פתח ב-WhatsApp" on an editable preview, and it never
// marks a message as sent until the user separately presses
// "אשר שההודעה נשלחה". Missing/invalid phone numbers are blocked
// before any preview is shown, and no data is ever invented into
// a template — unfilled fields are simply left out of the text.
// ============================================================

let WA_USERS_CACHE = null;
async function waGetUserName(id){
  if (!id) return '—';
  if (!WA_USERS_CACHE){
    const { data } = await window.supabaseClient.rpc('get_active_users_basic');
    WA_USERS_CACHE = data || [];
  }
  const u = WA_USERS_CACHE.find(x => x.id === id);
  if (!u) return '—';
  return (u.full_name && u.full_name.trim()) ? u.full_name : (u.email || '—');
}

// Validates + normalizes an Israeli phone number for WhatsApp.
// Returns { valid, reason: 'missing'|'invalid'|null, e164 }
function waNormalizePhone(phone){
  if (!phone || !String(phone).trim()) return { valid:false, reason:'missing', e164:null };
  const d = String(phone).replace(/\D/g,'');
  if (!d) return { valid:false, reason:'missing', e164:null };
  if (d.startsWith('972')){
    const rest = d.slice(3);
    if (rest.length === 9) return { valid:true, reason:null, e164:d };
    return { valid:false, reason:'invalid', e164:null };
  }
  if (d.startsWith('0')){
    if (d.length === 9 || d.length === 10) return { valid:true, reason:null, e164:'972' + d.slice(1) };
    return { valid:false, reason:'invalid', e164:null };
  }
  return { valid:false, reason:'invalid', e164:null };
}

// Template registry. 'buyer' and 'training_candidate' use the exact
// wording he supplied. 'seller' / 'partner' / 'business_owner' have
// no wording specified in the original instruction, so they use a
// short neutral placeholder — always shown in the editable preview
// before anything is sent, and flagged in the delivery report as
// needing his own wording if he wants something more specific.
const WA_TEMPLATES = {
  buyer: (ctx) => `שלום ${ctx.firstName || ''},\n\nתודה שפנית ל-BSD.\n\nנשמח לסייע לך באיתור עסק מתאים${ctx.area ? ' באזור ' + ctx.area : ''}. בשלב הראשון נקיים שיחה קצרה כדי להבין את התחום המבוקש, התקציב ורמת המעורבות שלך בעסק. לאחר מכן נבדוק התאמות מתוך מאגר העסקים שלנו.\n\nהמידע על עסקים מועבר באופן דיסקרטי ובהתאם לשלב הבדיקה.\n\nמתי נוח לך לשיחה קצרה?\n\nברוך איזון\nBSD\n0542424999`,

  training_candidate: (ctx) => `שלום ${ctx.firstName || ''},\n\nתודה על ההתעניינות בהכשרת מתווכי העסקים של BSD.\n\nההכשרה מיועדת למי שרוצה להשתלב באופן מקצועי בתחום, ללמוד את תהליך העבודה ולקבל ליווי מעשי במסגרת BSD.\n\nאשמח לקיים איתך שיחה קצרה, להכיר את הרקע שלך ולהסביר על תוכנית ההכשרה ואפשרויות ההשתלבות לאחריה.\n\nמתי נוח לך לשוחח?\n\nברוך איזון\nBSD\n0542424999`,

  seller: (ctx) => `שלום ${ctx.firstName || ''},\n\nתודה שפנית ל-BSD בנושא מכירת העסק${ctx.businessName ? ' "' + ctx.businessName + '"' : ''}.\n\nנשמח לקיים שיחה קצרה כדי להכיר את העסק ולהסביר על תהליך הליווי שלנו במכירה.\n\nמתי נוח לך לשיחה קצרה?\n\nברוך איזון\nBSD\n0542424999`,

  partner: (ctx) => `שלום ${ctx.firstName || ''},\n\nתודה שפנית ל-BSD בנושא שותפות/השקעה בעסק.\n\nנשמח לקיים שיחה קצרה כדי להבין את התחום וסוג המעורבות שאתה מחפש, ולבחון יחד אפשרויות מתאימות.\n\nמתי נוח לך לשיחה קצרה?\n\nברוך איזון\nBSD\n0542424999`,

  business_owner: (ctx) => `שלום ${ctx.firstName || ''},\n\nפונה אליך מ-BSD בנוגע לעסק${ctx.businessName ? ' "' + ctx.businessName + '"' : ''}.\n\nאשמח לעדכן אותך ולקיים שיחה קצרה בהמשך לטיפול שלנו.\n\nמתי נוח לך לשוחח?\n\nברוך איזון\nBSD\n0542424999`,
};

const WA_TYPE_LABELS = {
  buyer: 'קונה עסק',
  seller: 'מוכר',
  partner: 'שותפות/השקעה',
  training_candidate: 'מועמד להכשרת מתווכים',
  business_owner: 'בעל עסק',
};

function waCloseOverlay(){
  const el = document.getElementById('waSendOverlay');
  if (el) el.remove();
}

// entry point — call from any card's "שלח WhatsApp" button.
// opts: {
//   entityType: 'lead' | 'business' | 'training_lead',
//   entityId, phone, recipientName, templateKey,
//   ctx: { firstName, area, businessName },
//   onLogged: optional callback fired after a confirmed send
// }
function waOpenSendModal(opts){
  waCloseOverlay();
  const phoneCheck = waNormalizePhone(opts.phone);
  const templateKey = opts.templateKey;
  const templateFn = WA_TEMPLATES[templateKey];
  const typeLabel = WA_TYPE_LABELS[templateKey] || templateKey || '—';
  const initialText = templateFn ? templateFn(opts.ctx || {}) : '';

  const overlay = document.createElement('div');
  overlay.id = 'waSendOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,27,52,.55);display:flex;align-items:center;justify-content:center;z-index:500;padding:20px;';

  if (!phoneCheck.valid){
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:'Heebo','Rubik',sans-serif;direction:rtl;">
        <h3 style="margin:0 0 14px;color:#0e1b34;border-right:4px solid #c9a24b;padding-right:10px;">שלח WhatsApp</h3>
        <div style="background:#fdeceb;border:1px solid #e08a80;border-radius:8px;padding:12px 14px;color:#8a2c1f;font-size:.88rem;">
          ${phoneCheck.reason === 'missing'
            ? '⚠️ לא קיים מספר טלפון בכרטיס. יש להשלים מספר טלפון לפני שליחת WhatsApp.'
            : '⚠️ מספר הטלפון בכרטיס אינו תקין. יש לתקן את המספר לפני שליחת WhatsApp.'}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:16px;">
          <button type="button" onclick="waCloseOverlay()" style="background:#fff;border:1px solid #d8d3c4;color:#0e1b34;padding:9px 18px;border-radius:8px;font-family:inherit;cursor:pointer;">סגור</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return;
  }

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:'Heebo','Rubik',sans-serif;direction:rtl;max-height:86vh;overflow:auto;">
      <h3 style="margin:0 0 14px;color:#0e1b34;border-right:4px solid #25D366;padding-right:10px;">שלח WhatsApp</h3>
      <div style="font-size:.85rem;color:#555;margin-bottom:10px;line-height:1.7;">
        <div>נמען: <b>${esc(opts.recipientName || '—')}</b></div>
        <div>טלפון: <b dir="ltr">${esc(opts.phone)}</b></div>
        <div>סוג פנייה: <b>${esc(typeLabel)}</b></div>
      </div>
      <label style="display:block;font-size:.8rem;color:#666;margin-bottom:6px;">תוכן ההודעה (ניתן לעריכה):</label>
      <textarea id="waMessageText" style="width:100%;min-height:200px;padding:10px;border:1px solid #d8d3c4;border-radius:8px;font-family:inherit;font-size:.88rem;box-sizing:border-box;">${esc(initialText)}</textarea>
      <div id="waSendError" style="display:none;color:#b00020;font-size:.82rem;margin-top:8px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;">
        <button type="button" onclick="waCloseOverlay()" style="background:#fff;border:1px solid #d8d3c4;color:#0e1b34;padding:9px 18px;border-radius:8px;font-family:inherit;cursor:pointer;">ביטול</button>
        <button type="button" id="waOpenBtn" style="background:#25D366;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;">📲 פתח ב-WhatsApp</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('waOpenBtn').addEventListener('click', async () => {
    const btn = document.getElementById('waOpenBtn');
    const finalText = document.getElementById('waMessageText').value;
    const errEl = document.getElementById('waSendError');
    if (errEl) errEl.style.display = 'none';
    if (!finalText.trim()){
      if (errEl){ errEl.textContent = 'לא ניתן לפתוח הודעה ריקה'; errEl.style.display = 'block'; }
      return;
    }
    btn.disabled = true; btn.textContent = 'פותח...';
    const { data, error } = await window.supabaseClient.from('whatsapp_send_log').insert({
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      template_key: templateKey,
      message_text: finalText,
      phone_snapshot: phoneCheck.e164,
      opened_by: CURRENT_PROFILE.id
    }).select().single();
    if (error){
      btn.disabled = false; btn.textContent = '📲 פתח ב-WhatsApp';
      if (errEl){ errEl.textContent = 'שגיאה בשמירת התיעוד: ' + error.message; errEl.style.display = 'block'; }
      return;
    }
    window.open('https://wa.me/' + phoneCheck.e164 + '?text=' + encodeURIComponent(finalText), '_blank');
    if (typeof bsdLogActivity === 'function') bsdLogActivity('whatsapp_manual_open', opts.entityType, opts.entityId, { template: templateKey, log_id: data.id });
    waShowConfirmStage(data, opts);
  });
}

async function waShowConfirmStage(logRow, opts){
  const overlay = document.getElementById('waSendOverlay');
  if (!overlay) return;
  const openerName = await waGetUserName(CURRENT_PROFILE.id);
  const box = overlay.querySelector('div');
  const when = new Date(logRow.opened_at).toLocaleString('he-IL', {hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'});
  box.innerHTML = `
    <h3 style="margin:0 0 14px;color:#0e1b34;border-right:4px solid #25D366;padding-right:10px;">שלח WhatsApp</h3>
    <div style="background:#eef8f0;border:1px solid #b7e0c0;border-radius:8px;padding:12px 14px;color:#1a5c38;font-size:.86rem;line-height:1.7;">
      נפתחה הודעת WhatsApp ב-${esc(when)} על ידי ${esc(openerName)}.<br>
      אם ההודעה נשלחה בפועל בוואטסאפ, יש לאשר זאת:
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;">
      <button type="button" onclick="waCloseOverlay()" style="background:#fff;border:1px solid #d8d3c4;color:#0e1b34;padding:9px 18px;border-radius:8px;font-family:inherit;cursor:pointer;">סגור בלי לאשר</button>
      <button type="button" id="waConfirmBtn" style="background:#0e1b34;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;">✅ אשר שההודעה נשלחה</button>
    </div>`;
  document.getElementById('waConfirmBtn').addEventListener('click', async () => {
    const btn = document.getElementById('waConfirmBtn');
    btn.disabled = true; btn.textContent = 'מאשר...';
    const { error } = await window.supabaseClient.from('whatsapp_send_log').update({
      confirmed_sent: true, confirmed_by: CURRENT_PROFILE.id, confirmed_at: new Date().toISOString()
    }).eq('id', logRow.id);
    if (error){
      btn.disabled = false; btn.textContent = '✅ אשר שההודעה נשלחה';
      alert('שגיאה באישור: ' + error.message);
      return;
    }
    if (typeof bsdLogActivity === 'function') bsdLogActivity('whatsapp_manual_confirmed', opts.entityType, opts.entityId, { template: opts.templateKey, log_id: logRow.id });
    waCloseOverlay();
    if (typeof toast === 'function') toast('סומן שההודעה נשלחה');
    if (typeof opts.onLogged === 'function') opts.onLogged();
  });
}

// Renders a compact message-history list into an existing container
// element, for embedding inside a card (e.g. under "הערות").
async function waRenderHistory(entityType, entityId, containerId){
  const box = document.getElementById(containerId);
  if (!box) return;
  box.innerHTML = 'טוען...';
  const { data, error } = await window.supabaseClient.from('whatsapp_send_log')
    .select('*').eq('entity_type', entityType).eq('entity_id', entityId)
    .order('opened_at', { ascending: false });
  if (error){ box.innerHTML = `<span style="color:#a02c1d;">שגיאה: ${esc(error.message)}</span>`; return; }
  if (!data || !data.length){ box.innerHTML = '<span style="color:#999;font-size:.82rem;">לא נשלחו עדיין הודעות WhatsApp</span>'; return; }
  const rows = await Promise.all(data.map(async r => {
    const opener = await waGetUserName(r.opened_by);
    const when = new Date(r.opened_at).toLocaleString('he-IL', {hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'});
    const statusHtml = r.confirmed_sent
      ? `<span style="color:#1a5c38;">✅ נשלחה</span>`
      : `<span style="color:#a67c00;">🕓 נפתחה, טרם אושר שנשלחה</span>`;
    return `<div style="padding:6px 0;border-bottom:1px solid #eee;font-size:.82rem;">
      <div>${esc(WA_TYPE_LABELS[r.template_key] || r.template_key || '—')} · נפתח ע"י ${esc(opener)} · ${esc(when)}</div>
      <div>${statusHtml}</div>
    </div>`;
  }));
  box.innerHTML = rows.join('');
}

// Small inline button HTML for a card's action bar.
function waSendButtonHtml(onclickExpr){
  return `<button type="button" class="btn btn-ghost" onclick="${onclickExpr}" style="color:#128C4A;border-color:#b7e0c0;">📲 שלח WhatsApp</button>`;
}
