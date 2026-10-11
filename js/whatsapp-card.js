// BSD WhatsApp (077) section on lead / business / broker cards. 11.10.2026, branch eldad/whatsapp-cloud-api.
// Pages only add an empty slot: BSDWhatsAppCard.slot(table, id) (returns '' while BSD_CONFIG.WHATSAPP_API_UI is off).
// This module fills every slot it sees: channel (054 / 077) with the admin switch, 24h window, the contact's
// conversation timeline, received documents (view / download / «אשר כהסכם חתום»), quick reply, template, reminder.
(function () {
  'use strict';
  const W = () => window.BSDWhatsApp;
  const esc = s => W().esc(s);
  const TABLES = ['leads', 'businesses', 'brokers'];
  const UUID = /^[0-9a-f-]{36}$/i;

  function slot(table, id) {
    if (!W() || !W().enabled() || !TABLES.includes(table) || !UUID.test(String(id || ''))) return '';
    return `<div class="bsd-wa-slot" data-wa-table="${table}" data-wa-id="${esc(id)}"></div>`;
  }

  async function loadRecord(table, id) {
    const cols = table === 'businesses' ? 'id,agreement_status,whatsapp_channel,owner_name' : 'id,agreement_status,whatsapp_channel,full_name';
    const { data } = await window.supabaseClient.from(table).select(cols).eq('id', id).maybeSingle();
    return data;
  }
  async function loadMessages(table, id, convId) {
    const col = table === 'leads' ? 'lead_id' : table === 'businesses' ? 'business_id' : 'broker_id';
    let q = window.supabaseClient.from('whatsapp_messages')
      .select('id,direction,message_type,message_text,template_name,status,error_code,storage_path,media_filename,media_mime,media_size,processing_status,agreement_confirmed_at,received_at,sent_at,created_at,conversation_id,is_test')
      .order('created_at', { ascending: false }).limit(60);
    q = convId && UUID.test(convId) ? q.or(`conversation_id.eq.${convId},${col}.eq.${id}`) : q.eq(col, id);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).filter(m => m.status !== 'refused').reverse();
  }

  function msgHtml(m, rec) {
    const W_ = W();
    const who = m.direction === 'inbound' ? 'in' : 'out';
    let doc = '';
    if (m.storage_path) {
      doc = `<div class="bsd-wa-doc">📎 ${esc(m.media_filename || 'קובץ')} <a data-act="view" data-mid="${m.id}">צפייה</a> · <a data-act="download" data-mid="${m.id}">הורדה</a>`
        + (W_.canConfirmAgreement(m, rec, W_.mayConfirm()) ? ` <button type="button" class="btn btn-success" data-act="confirm" data-mid="${m.id}">✅ אשר כהסכם חתום</button>` : '')
        + (m.agreement_confirmed_at ? ' <span class="bsd-wa-chip">אושר כהסכם חתום</span>' : '') + '</div>';
    } else if (m.direction === 'inbound' && m.processing_status === 'failed') doc = '<div class="bsd-wa-doc">⚠️ הקובץ לא נקלט</div>';
    else if (m.direction === 'inbound' && m.processing_status === 'pending' && m.media_filename) doc = '<div class="bsd-wa-doc">⏳ הקובץ בקליטה</div>';
    const text = m.message_text ? esc(m.message_text) : '';
    const meta = `${esc(W_.fmtTime(W_.messageTime(m)))} ${m.direction === 'outbound' ? esc(W_.statusIcon(m.status)) : ''}${m.is_test ? ' · בדיקה' : ''}`;
    return `<div class="bsd-wa-msg ${who}">${text}${doc}<div class="bsd-wa-meta">${meta}</div></div>`;
  }

  async function render(el) {
    const table = el.dataset.waTable, id = el.dataset.waId, W_ = W();
    W_.injectStyles();
    el.innerHTML = '<div class="bsd-wa-box"><h4>💬 WhatsApp 077</h4><div class="bsd-wa-meta">טוען...</div></div>';
    let rec, st, msgs = [];
    try {
      [rec, st] = await Promise.all([loadRecord(table, id), W_.call('status', { record: { table, id } })]);
      const convId = st && st.record && st.record.conversation_id;
      msgs = await loadMessages(table, id, convId);
    } catch (e) {
      el.innerHTML = `<div class="bsd-wa-box"><h4>💬 WhatsApp 077</h4><div class="bsd-wa-meta">לא ניתן לטעון (${esc(e.message || e)})</div></div>`; return;
    }
    if (!rec) { el.innerHTML = ''; return; }
    const r = (st && st.record) || {};
    const api = rec.whatsapp_channel === 'api';
    const wOpen = !!r.window_open;
    const docs = msgs.filter(m => m.direction === 'inbound' && m.storage_path);
    el.innerHTML = `<div class="bsd-wa-box">
      <h4>💬 WhatsApp 077 <span class="bsd-wa-chip ${api ? '' : 'off'}">${api ? 'הכרטיס עובר דרך 077' : 'הכרטיס עדיין ב-054 (אישי)'}</span>
        ${st && st.mode && st.mode !== 'live' ? `<span class="bsd-wa-chip off">מצב: ${esc(st.mode)}</span>` : ''}
        ${r.opted_out ? '<span class="bsd-wa-chip off">⛔ ביקש הסרה</span>' : ''}</h4>
      ${W_.isManager() ? `<div class="bsd-wa-row"><button type="button" class="btn btn-ghost" data-act="channel">${api ? 'החזר ל-054' : 'העבר ל-077 (פיילוט)'}</button></div>` : ''}
      ${docs.length ? `<div style="margin-top:8px;font-weight:700;font-size:.82rem;">📥 מסמכים שהתקבלו (${docs.length})</div>` : ''}
      <div class="bsd-wa-tl">${msgs.length ? msgs.map(m => msgHtml(m, rec)).join('') : '<div class="bsd-wa-meta">אין עדיין הודעות במספר 077 עם איש הקשר הזה</div>'}</div>
      ${api ? `<div class="bsd-wa-meta">${esc(wOpen ? labelFrom(r) : W_.windowState(null).label)}</div>
      <div class="bsd-wa-row" style="margin-top:6px;">
        ${wOpen ? `<input type="text" class="bsd-wa-quick" placeholder="תשובה חופשית..." style="flex:1;min-width:160px;padding:7px;border:1px solid #d8d3c4;border-radius:8px;font-family:inherit;"><button type="button" class="btn btn-primary" data-act="send">שליחה</button>` : ''}
        <button type="button" class="btn btn-ghost" data-act="template">📋 תבנית</button>
        ${rec.agreement_status === 'נשלח הסכם לחתימה' && W_.mayConfirm() ? '<button type="button" class="btn btn-ghost" data-act="remind">⏰ תזכורת חתימה</button>' : ''}
        ${r.conversation_id ? `<a class="btn btn-ghost" href="whatsapp-inbox.html?c=${encodeURIComponent(r.conversation_id)}">פתח בתיבת WhatsApp</a>` : ''}
      </div>` : ''}
    </div>`;
    const byId = Object.fromEntries(msgs.map(m => [m.id, m]));
    el.onclick = async ev => {
      const b = ev.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act, m = byId[b.dataset.mid];
      try {
        if (act === 'view' || act === 'download') return await W_.openMedia(m.id, act === 'download');
        if (act === 'confirm') {
          if (!confirm(`לשמור את "${m.media_filename || 'הקובץ'}" כהסכם החתום של הכרטיס?\nהכרטיס יסומן "יש הסכם חתום" (ירוק), בדיוק כמו העלאה ידנית.`)) return;
          b.disabled = true; await W_.confirmAgreement(m, table, id); W_.toast('ההסכם החתום נשמר ושויך לכרטיס');
          if (typeof window.manualAgreementRefreshAfterUpload === 'function') return window.manualAgreementRefreshAfterUpload(table, id);
          return render(el);
        }
        if (act === 'channel') {
          const next = api ? 'personal' : 'api';
          if (!confirm(next === 'api' ? 'להעביר את הכרטיס לשליחה מ-077 (WhatsApp עסקי)? כפתורי 054 הקיימים לא משתנים.' : 'להחזיר את הכרטיס ל-054 (אישי)?')) return;
          const { error } = await window.supabaseClient.rpc('wa_set_record_channel', { p_table: table, p_record_id: id, p_channel: next });
          if (error) throw error; return render(el);
        }
        if (act === 'send') {
          const inp = el.querySelector('.bsd-wa-quick'); const text = inp.value.trim(); if (!text) return;
          b.disabled = true; const res = await W_.call('send_text', { record: { table, id }, text });
          if (!res.ok) throw new Error(W_.errorText(res.error)); return render(el);
        }
        if (act === 'template') { if (await W_.templateDialog({ record: { table, id } })) render(el); return; }
        if (act === 'remind') {
          const d = prompt('תאריך שליחת ההסכם (dd.mm.yyyy):', new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem' }).replace(/\//g, '.'));
          if (!d) return;
          const res = await W_.call('send_template', { template: 'bsd_signing_reminder', record: { table, id }, values: { sent_date: d.trim() } });
          if (!res.ok) throw new Error(W_.errorText(res.error)); W_.toast('התזכורת נשלחה'); return render(el);
        }
      } catch (e) { b.disabled = false; W_.toast(e.message || String(e)); }
    };
  }
  function labelFrom(r) {
    if (!r.window_closes_at) return W().windowState(null).label;
    return W().windowState(new Date(Date.parse(r.window_closes_at) - 24 * 3600 * 1000).toISOString()).label;
  }

  function scan(rootEl) {
    if (!W() || !W().enabled()) return;
    (rootEl || document).querySelectorAll('.bsd-wa-slot:not([data-wa-mounted])').forEach(el => { el.dataset.waMounted = '1'; render(el); });
  }
  function start() {
    if (!W() || !W().enabled()) return;
    scan();
    new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
  }
  window.BSDWhatsAppCard = { slot, scan, render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
