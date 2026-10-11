// BSD WhatsApp inbox (all conversations on 077-444-6707). 11.10.2026, branch eldad/whatsapp-cloud-api.
// List (unread / last message / linked card) + thread (text, documents, media) + reply (free text inside the 24h
// window, approved template outside it) + linking an unlinked / ambiguous conversation to a card.
// What a user sees is decided by RLS (whatsapp_conversation_list / whatsapp_messages): admin & manager see all,
// agents see the conversations of cards they may open. Sending is decided by the whatsapp-send edge function.
(function () {
  'use strict';
  const W = window.BSDWhatsApp;
  const esc = W.esc;
  const sb = () => window.supabaseClient;
  const POLL_MS = 15000;
  const state = { list: [], openId: null, messages: [], filter: 'all', search: '', timer: null, sending: false };
  const $ = id => document.getElementById(id);

  async function loadList() {
    const { data, error } = await sb().from('whatsapp_conversation_list')
      .select('id,phone_e164,profile_name,record_table,record_id,record_label,record_kind_label,ambiguous,candidates,last_message_at,last_message_preview,last_direction,last_inbound_at,unread_count')
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(300);
    if (error) { $('waList').innerHTML = `<div class="empty-msg">שגיאה בטעינה: ${esc(error.message)}</div>`; return; }
    state.list = data || [];
    renderList();
  }
  function visible() {
    const q = state.search.trim().toLowerCase();
    return state.list.filter(c => (state.filter === 'all' || (state.filter === 'unread' && c.unread_count > 0) || (state.filter === 'unlinked' && !c.record_id))
      && (!q || [c.record_label, c.profile_name, c.phone_e164, W.fmtPhone(c.phone_e164), c.last_message_preview].some(v => String(v || '').toLowerCase().includes(q))));
  }
  function renderList() {
    const rows = visible();
    $('waUnreadTotal').textContent = String(state.list.reduce((s, c) => s + (c.unread_count || 0), 0) || '');
    $('waList').innerHTML = rows.length ? rows.map(c => `
      <div class="wa-conv ${c.unread_count ? 'unread' : ''} ${c.id === state.openId ? 'active' : ''}" data-id="${c.id}">
        <div class="wa-conv-top"><b>${esc(W.conversationTitle(c))}</b><span class="wa-time">${esc(W.fmtTime(c.last_message_at))}</span></div>
        <div class="wa-conv-sub">${c.record_id ? esc(c.record_kind_label || '') : (c.ambiguous ? '⚠️ כמה כרטיסים עם המספר' : '❓ לא משויך')} · ${esc(W.fmtPhone(c.phone_e164))}</div>
        <div class="wa-conv-prev">${c.last_direction === 'outbound' ? '↩︎ ' : ''}${esc(c.last_message_preview || '')}${c.unread_count ? `<span class="unread-badge">${c.unread_count}</span>` : ''}</div>
      </div>`).join('') : '<div class="empty-msg">אין שיחות</div>';
  }

  async function openConv(id, keepScroll) {
    state.openId = id;
    const c = state.list.find(x => x.id === id);
    if (!c) { $('waThread').innerHTML = '<div class="empty-msg">השיחה לא נמצאה או שאין לך הרשאה אליה</div>'; return; }
    const { data, error } = await sb().from('whatsapp_messages')
      .select('id,direction,message_type,message_text,template_name,status,error_code,error_message,storage_path,media_filename,media_mime,media_size,processing_status,agreement_confirmed_at,received_at,sent_at,created_at,sent_by,is_test,button_payload')
      .eq('conversation_id', id).order('created_at', { ascending: true }).limit(500);
    if (error) { $('waThread').innerHTML = `<div class="empty-msg">שגיאה: ${esc(error.message)}</div>`; return; }
    state.messages = (data || []).filter(m => m.status !== 'refused');
    let rec = null;
    if (c.record_id) {
      const r = await sb().from(c.record_table).select('id,agreement_status').eq('id', c.record_id).maybeSingle();
      rec = r.data;
    }
    renderThread(c, rec, keepScroll);
    if (c.unread_count) {
      await sb().rpc('wa_mark_conversation_read', { p_conversation_id: id });
      c.unread_count = 0; renderList();
    }
    renderList();
  }

  function bubble(m, c, rec) {
    const mine = m.direction === 'outbound';
    let media = '';
    if (m.storage_path) {
      const img = W.isImage(m);
      media = `<div class="wa-doc">${img ? '🖼️' : '📎'} ${esc(m.media_filename || 'קובץ')}${m.media_size ? ` (${Math.ceil(m.media_size / 1024)}KB)` : ''}
        <a data-act="view" data-mid="${m.id}">צפייה</a> · <a data-act="download" data-mid="${m.id}">הורדה</a>
        ${c.record_id && W.canConfirmAgreement(m, rec, W.mayConfirm()) ? `<button class="btn btn-success" data-act="confirm" data-mid="${m.id}">✅ אשר כהסכם חתום</button>` : ''}
        ${m.agreement_confirmed_at ? '<span class="wa-chip">אושר כהסכם חתום</span>' : ''}</div>`;
    } else if (!mine && m.processing_status === 'failed') media = '<div class="wa-doc">⚠️ הקובץ לא נקלט</div>';
    else if (!mine && m.processing_status === 'pending' && m.media_filename) media = '<div class="wa-doc">⏳ הקובץ בקליטה</div>';
    const tpl = m.template_name ? `<div class="wa-tpl">תבנית: ${esc(m.template_name)}</div>` : '';
    const err = m.status === 'failed' ? `<div class="wa-err">${esc(m.error_message || m.error_code || '')}</div>` : '';
    return `<div class="bubble-row ${mine ? 'mine' : 'theirs'}"><div><div class="bubble ${mine ? 'mine' : 'theirs'}">${tpl}${esc(m.message_text || '')}${media}${err}</div>
      <div class="bubble-time">${esc(W.fmtTime(W.messageTime(m)))} ${mine ? esc(W.statusIcon(m.status)) : ''}${m.is_test ? ' · בדיקה' : ''}</div></div></div>`;
  }

  function renderThread(c, rec, keepScroll) {
    const win = W.windowState(c.last_inbound_at);
    const href = W.recordHref(c.record_table, c.record_id);
    const linkBox = c.record_id ? '' : `<div class="wa-link">
        ${c.ambiguous ? '⚠️ כמה כרטיסים במערכת עם המספר הזה. יש לבחור לאיזה כרטיס לשייך:' : '❓ השיחה לא משויכת לכרטיס.'}
        ${(c.candidates || []).map(k => `<button class="btn btn-ghost" data-act="link" data-t="${esc(k.table)}" data-r="${esc(k.id)}">${esc(W.KIND[k.table] || k.table)} · ${esc(String(k.id).slice(0, 8))}</button>`).join('')}
        <div class="wa-row"><input id="waLinkSearch" placeholder="חיפוש כרטיס לפי שם או טלפון..."><button class="btn btn-ghost" data-act="search">חיפוש</button></div><div id="waLinkResults"></div></div>`;
    const prev = $('waMsgs') ? $('waMsgs').scrollTop : 0;
    $('waThread').innerHTML = `
      <div class="wa-head"><div><b>${esc(W.conversationTitle(c))}</b> <span class="wa-time">${esc(W.fmtPhone(c.phone_e164))}${c.profile_name && c.record_label ? ' · ' + esc(c.profile_name) : ''}</span></div>
        <div>${href ? `<a class="btn btn-ghost" href="${href}">פתח כרטיס ${esc(c.record_kind_label || '')}</a>` : ''}</div></div>
      ${linkBox}
      <div class="wa-msgs" id="waMsgs">${state.messages.map(m => bubble(m, c, rec)).join('') || '<div class="empty-msg">אין הודעות</div>'}</div>
      <div class="wa-win ${win.open ? 'open' : ''}">${esc(win.label)}</div>
      <div class="wa-reply">
        ${win.open ? `<textarea id="waText" rows="2" placeholder="כתיבת הודעה..."></textarea>
          <div class="wa-row"><button class="btn btn-primary" data-act="send">שליחה</button>
          <label class="btn btn-ghost">📎 קובץ<input type="file" id="waFile" hidden></label>` : '<div class="wa-row">'}
          <button class="btn btn-ghost" data-act="template" ${c.record_id ? '' : 'disabled title="יש לשייך לכרטיס קודם"'}>📋 תבנית מאושרת</button></div>
      </div>`;
    const box = $('waMsgs'); box.scrollTop = keepScroll ? prev : box.scrollHeight;
    const f = $('waFile'); if (f) f.onchange = () => sendFile(c, f);
  }

  async function sendFile(c, input) {
    const file = input.files && input.files[0]; if (!file) return;
    if (file.size > 100 * 1024 * 1024) { W.toast('הקובץ גדול מדי'); return; }
    try {
      const doc = await W.uploadForSend({ conversation_id: c.id }, file);
      const r = await W.call('send_document', { conversation_id: c.id, document: { storage_path: doc.storage_path, filename: doc.filename } });
      if (!r.ok) throw new Error(W.errorText(r.error));
      await refresh(true);
    } catch (e) { W.toast(e.message); } finally { input.value = ''; }
  }

  async function onThreadClick(ev) {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const c = state.list.find(x => x.id === state.openId); if (!c) return;
    const m = state.messages.find(x => x.id === b.dataset.mid);
    try {
      switch (b.dataset.act) {
        case 'view': case 'download': return await W.openMedia(m.id, b.dataset.act === 'download');
        case 'confirm':
          if (!confirm(`לשמור את "${m.media_filename || 'הקובץ'}" כהסכם החתום של ${c.record_label || 'הכרטיס'}?\nהכרטיס יסומן "יש הסכם חתום" (ירוק), בדיוק כמו העלאה ידנית.`)) return;
          b.disabled = true; await W.confirmAgreement(m, c.record_table, c.record_id); W.toast('ההסכם החתום נשמר ושויך לכרטיס'); return refresh(true);
        case 'send': {
          if (state.sending) return;
          const t = $('waText'); const text = t.value.trim(); if (!text) return;
          state.sending = true; b.disabled = true;
          const r = await W.call('send_text', { conversation_id: c.id, text });
          state.sending = false;
          if (!r.ok) { b.disabled = false; throw new Error(W.errorText(r.error)); }
          t.value = ''; return refresh(true);
        }
        case 'template': if (await W.templateDialog({ conversation_id: c.id })) await refresh(true); return;
        case 'link': {
          if (!confirm('לשייך את השיחה לכרטיס הזה?')) return;
          const { error } = await sb().rpc('wa_link_conversation', { p_conversation_id: c.id, p_table: b.dataset.t, p_record_id: b.dataset.r });
          if (error) throw error; return refresh(false);
        }
        case 'search': return searchCards($('waLinkSearch').value.trim());
      }
    } catch (e) { state.sending = false; W.toast(e.message || String(e)); }
  }
  async function searchCards(q) {
    if (q.length < 2) return;
    const like = '%' + q.replace(/[%_,()]/g, ' ') + '%';
    const [b, l, k] = await Promise.all([
      sb().from('businesses').select('id,owner_name,internal_name').or(`owner_name.ilike.${like},internal_name.ilike.${like},owner_phone.ilike.${like}`).eq('is_archived', false).limit(8),
      sb().from('leads').select('id,full_name').or(`full_name.ilike.${like},phone.ilike.${like}`).eq('is_archived', false).limit(8),
      sb().from('brokers').select('id,full_name').or(`full_name.ilike.${like},phone.ilike.${like}`).limit(5),
    ]);
    const rows = [...(b.data || []).map(r => ({ t: 'businesses', id: r.id, label: [r.owner_name, r.internal_name].filter(Boolean).join(' · ') })),
      ...(l.data || []).map(r => ({ t: 'leads', id: r.id, label: r.full_name })), ...(k.data || []).map(r => ({ t: 'brokers', id: r.id, label: r.full_name }))];
    $('waLinkResults').innerHTML = rows.length ? rows.map(r => `<button class="btn btn-ghost" data-act="link" data-t="${r.t}" data-r="${esc(r.id)}">${esc(W.KIND[r.t])}: ${esc(r.label || '')}</button>`).join(' ') : '<span class="wa-time">לא נמצאו כרטיסים</span>';
  }

  async function refresh(keepScroll) {
    await loadList();
    if (state.openId) await openConv(state.openId, keepScroll);
  }
  function poll() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      if (document.hidden) return;
      const typing = document.activeElement && document.activeElement.id === 'waText' && document.activeElement.value;
      if (!typing && !document.querySelector('.bsd-wa-overlay')) refresh(true);
    }, POLL_MS);
  }

  async function init() {
    W.injectStyles();
    if (!W.enabled()) { $('waMain').innerHTML = '<div class="empty-msg">תיבת ה-WhatsApp העסקי (077) עדיין לא הופעלה.</div>'; return; }
    $('waList').addEventListener('click', ev => { const r = ev.target.closest('.wa-conv'); if (r) { history.replaceState(null, '', '?c=' + r.dataset.id); openConv(r.dataset.id); } });
    $('waThread').addEventListener('click', onThreadClick);
    $('waSearch').addEventListener('input', e => { state.search = e.target.value; renderList(); });
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
      state.filter = b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('on', x === b)); renderList(); }));
    await loadList();
    const want = new URLSearchParams(location.search).get('c');
    if (want && /^[0-9a-f-]{36}$/i.test(want)) await openConv(want);
    const st = await W.call('status');
    if (st && st.mode && st.mode !== 'live') $('waMode').textContent = st.mode === 'dry_run' ? 'מצב בדיקה: שליחה רק למספר הבדיקה' : st.mode === 'simulate' ? 'מצב סימולציה: שום הודעה לא יוצאת' : 'השליחה כבויה';
    poll();
  }
  window.BSDWhatsAppInbox = { init, state };
})();
