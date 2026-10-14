// 14.10.2026 BSD Smart Telephony – «📞 שיחות טלפון» section in the lead card + calls dashboard helpers.
// Reads public.phone_calls (RLS: admins only). Recording links come from edge function exm-recording-url
// (5-minute signed link, every request audited). Never writes to leads except «סמן כטופל» on the call row.
(function(){
  const sb = () => window.supabaseClient;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = iso => iso ? new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
  const dur = s => s == null ? '' : `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  const REC = { available:'הקלטה זמינה', pending:'ההקלטה בעיבוד', none:'אין הקלטה', unavailable:'ההקלטה לא זמינה', excluded:'לא הוקלט (החרגה)' };
  const SUM = { queued:'ממתין לסיכום הקלטת שיחה', processing:'ממתין לסיכום הקלטת שיחה', done:'סיכום מוכן', error:'הסיכום נכשל' };
  const CRM_LEAD = id => `leads-hub.html?open=${encodeURIComponent(id)}`;
  // Old buyers are no longer in the leads inbox. Their card is the buyers list.
  const EXISTING_CARD = id => `leads.html?open=${encodeURIComponent(id)}`;

  function badge(text, color){ return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:.75rem;background:${color}1a;color:${color};border:1px solid ${color}55;margin-inline-end:4px">${esc(text)}</span>`; }

  function callRow(c, opts){
    const phone = c.is_hidden ? 'מספר חסוי' : (c.caller_friendly || c.caller_e164 || '');
    const local = c.caller_e164 && c.caller_e164.startsWith('+972') ? '0' + c.caller_e164.slice(4) : c.caller_e164;
    const steps = Array.isArray(c.ai_next_steps) ? c.ai_next_steps : [];
    return `<div class="pc-call" data-id="${esc(c.id)}" style="border:1px solid #e3dccb;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fffdf8">
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between">
        <div><b>${esc(fmt(c.started_at))}</b> · ${esc(phone)} ${c.duration_sec ? '· ' + dur(c.duration_sec) : ''}</div>
        <div>${c.missed ? badge('לא נענתה','#c0392b') : badge('נענתה','#1e8449')}${badge(REC[c.recording_status] || c.recording_status,'#566573')}${SUM[c.summary_status] ? badge(SUM[c.summary_status],'#2e5c9e') : ''}${c.handled_at ? badge('טופל','#1e8449') : ''}</div>
      </div>
      ${opts && opts.leadLink && c.lead_id ? `<div style="margin-top:4px"><a href="${CRM_LEAD(c.lead_id)}">פתח את הליד</a></div>` : ''}
      <div class="pc-actions" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
        ${c.recording_status === 'available' || c.recording_status === 'pending' ? `<button type="button" class="pc-listen">▶️ האזן לשיחה</button>` : ''}
        ${c.ai_gist || c.ai_body ? `<button type="button" class="pc-summary">📝 צפה בסיכום</button>` : ''}
        ${c.summary_status === 'done' ? `<button type="button" class="pc-doc" data-mode="view">צפייה</button><button type="button" class="pc-doc" data-mode="download">הורדה</button>` : ''}
        ${!c.is_hidden && local ? `<a class="pc-callback" href="tel:${esc(local)}" style="text-decoration:none"><button type="button">📞 חזור למתקשר</button></a>` : ''}
        ${(c.existing_lead_ids || []).map((id, i) => `<a href="${EXISTING_CARD(id)}" target="_blank" rel="noopener"><button type="button">📂 פתח כרטיס קיים${(c.existing_lead_ids.length > 1) ? ' ' + (i+1) : ''}</button></a>`).join('')}
        ${!c.handled_at ? `<button type="button" class="pc-handled">✔️ סמן כטופל</button>` : ''}
      </div>
      <div class="pc-panel" style="display:none;margin-top:8px;white-space:pre-wrap;background:#f6f8fc;border-radius:8px;padding:8px 10px;font-size:.88rem"></div>
      <audio class="pc-audio" controls preload="none" style="display:none;width:100%;margin-top:8px"></audio>
      <template class="pc-sum">${esc(c.ai_gist ? c.ai_gist + '\n\n' : '')}${esc(c.ai_body || '')}${steps.length ? '\n\nצעדים להמשך:\n• ' + steps.map(esc).join('\n• ') : ''}</template>
    </div>`;
  }

  async function wire(root, reload){
    root.addEventListener('click', async ev => {
      const card = ev.target.closest('.pc-call'); if (!card) return;
      const id = card.dataset.id, panel = card.querySelector('.pc-panel');
      if (ev.target.closest('.pc-listen')){
        const btn = ev.target.closest('.pc-listen'); btn.disabled = true; btn.textContent = 'טוען הקלטה…';
        const { data, error } = await sb().functions.invoke('exm-recording-url', { body: { phone_call_id: id } });
        btn.disabled = false; btn.textContent = '▶️ האזן לשיחה';
        if (error || !data || !data.ok){ panel.style.display = 'block'; panel.textContent = data && data.error === 'forbidden' ? 'אין לך הרשאה להאזין להקלטות.' : 'ההקלטה עדיין לא זמינה. נסה שוב בעוד כמה דקות.'; return; }
        const a = card.querySelector('.pc-audio'); a.src = data.url; a.style.display = 'block'; a.play().catch(() => {});
      } else if (ev.target.closest('.pc-summary')){
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; panel.textContent = card.querySelector('.pc-sum').innerHTML.replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, m => ({'&lt;':'<','&gt;':'>','&amp;':'&','&quot;':'"','&#39;':"'"}[m]));
      } else if (ev.target.closest('.pc-doc')){
        const mode = ev.target.closest('.pc-doc').dataset.mode;
        const btn = ev.target.closest('.pc-doc'); btn.disabled = true;
        try {
          const doc = await sb().from('lead_documents').select('storage_path,display_name').eq('phone_call_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1);
          const row = doc.data && doc.data[0];
          if (doc.error || !row || !row.storage_path) throw new Error('הסיכום עדיין לא זמין');
          const signed = await sb().storage.from('business-files').createSignedUrl(row.storage_path, 300, mode === 'download' ? { download: row.display_name || 'summary.pdf' } : undefined);
          if (signed.error || !signed.data || !signed.data.signedUrl) throw new Error(signed.error && signed.error.message || 'אין קישור');
          if (mode === 'download'){
            const a = document.createElement('a'); a.href = signed.data.signedUrl; a.download = row.display_name || 'summary.pdf'; a.target = '_blank'; a.rel = 'noopener'; a.click();
          } else window.open(signed.data.signedUrl, '_blank', 'noopener');
        } catch (e) {
          panel.style.display = 'block'; panel.textContent = e && e.message ? e.message : 'לא ניתן לפתוח את הסיכום';
        } finally { btn.disabled = false; }
      } else if (ev.target.closest('.pc-handled')){
        const { data: u } = await sb().auth.getUser();
        const { error } = await sb().from('phone_calls').update({ handled_at: new Date().toISOString(), handled_by: u && u.user ? u.user.id : null }).eq('id', id);
        if (error){ alert('הסימון נכשל: ' + error.message); return; }
        reload();
      }
    });
  }

  async function mountLead(el){
    if (!el || el.dataset.pcMounted) return; el.dataset.pcMounted = '1';
    const leadId = el.dataset.leadId; if (!leadId || !sb()) return;
    const load = async () => {
      const { data, error } = await sb().from('phone_calls').select('*').eq('lead_id', leadId).order('started_at', { ascending: false });
      if (error || !data || !data.length){ el.innerHTML = ''; el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.innerHTML = `<div style="font-weight:700;margin:6px 0 8px">📞 שיחות טלפון (${data.length})</div>` + data.map(c => callRow(c)).join('');
    };
    await wire(el, load); await load();
  }
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function docButtons(path, name){
    return `<button type="button" class="ld-doc" data-mode="view" data-path="${esc(path)}" data-name="${esc(name)}">צפייה</button> <button type="button" class="ld-doc" data-mode="download" data-path="${esc(path)}" data-name="${esc(name)}">הורדה</button>`;
  }
  async function openDoc(path, name, mode){
    const signed = await sb().storage.from('business-files').createSignedUrl(path, 300, mode === 'download' ? { download: name || 'document.pdf' } : undefined);
    if (signed.error || !signed.data || !signed.data.signedUrl) throw new Error(signed.error && signed.error.message || 'אין קישור');
    if (mode === 'download'){
      const a = document.createElement('a'); a.href = signed.data.signedUrl; a.download = name || 'document.pdf'; a.target = '_blank'; a.rel = 'noopener'; a.click();
    } else window.open(signed.data.signedUrl, '_blank', 'noopener');
  }
  async function mountDocuments(el){
    if (!el || el.dataset.ldMounted) return; el.dataset.ldMounted = '1';
    if (!sb()) return;
    const leadId = el.dataset.leadId, buyerId = el.dataset.buyerId, businessId = el.dataset.businessId;
    let q = sb().from('lead_documents').select('id,display_name,category,storage_path,created_at').is('deleted_at', null).order('created_at', { ascending: false });
    if (leadId && UUID.test(leadId)) q = q.eq('lead_id', leadId);
    else if (buyerId && UUID.test(buyerId)) q = q.or(`buyer_id.eq.${buyerId},lead_id.eq.${buyerId}`);
    else if (businessId && UUID.test(businessId)) q = q.eq('business_id', businessId);
    else { el.style.display = 'none'; return; }
    const { data, error } = await q;
    if (error){ el.innerHTML = ''; el.style.display = 'none'; return; }
    const rows = data || [];
    el.style.display = 'block';
    el.innerHTML = `<div style="font-weight:700;margin:6px 0 8px">מסמכים${rows.length ? ' (' + rows.length + ')' : ''}</div>` +
      (rows.length ? rows.map(d => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid #f0ede4;font-size:.85rem"><span>📄 ${esc(d.display_name || d.category || 'מסמך')}</span>${d.storage_path ? docButtons(d.storage_path, d.display_name || 'document.pdf') : ''}</div>`).join('')
        : '<div style="color:#888;font-size:.85rem">אין מסמכים</div>');
    el.addEventListener('click', async ev => {
      const btn = ev.target.closest('.ld-doc'); if (!btn) return;
      btn.disabled = true;
      try { await openDoc(btn.dataset.path, btn.dataset.name, btn.dataset.mode); }
      catch (e) { alert(e && e.message ? e.message : 'לא ניתן לפתוח את המסמך'); }
      finally { btn.disabled = false; }
    });
  }
  // Lead card renders asynchronously; mount whenever the placeholder appears.
  new MutationObserver(() => {
    document.querySelectorAll('#wlPhoneCalls:not([data-pc-mounted])').forEach(mountLead);
    document.querySelectorAll('[data-lead-docs]:not([data-ld-mounted])').forEach(mountDocuments);
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.bsdPhoneCalls = { mountLead, mountDocuments, callRow, wire, esc, fmt, SUM };
})();
