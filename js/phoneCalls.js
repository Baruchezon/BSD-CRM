// 14.10.2026 BSD Smart Telephony – «📞 שיחות טלפון» section in the lead card + calls dashboard helpers.
// Reads public.phone_calls (RLS: admins only). Recording links come from edge function exm-recording-url
// (5-minute signed link, every request audited). Never writes to leads except «סמן כטופל» on the call row.
(function(){
  const sb = () => window.supabaseClient;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = iso => iso ? new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
  const dur = s => s == null ? '' : `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  const REC = { available:'הקלטה זמינה', pending:'ההקלטה בעיבוד', none:'אין הקלטה', unavailable:'ההקלטה לא זמינה', excluded:'לא הוקלט (החרגה)' };
  const RES = { queued:'ממתין למחקר', in_progress:'מחקר בתהליך', done:'מחקר הושלם', failed:'המחקר נכשל', skipped:'אין מחקר (מספר חסוי)' };
  const CRM_LEAD = id => `leads-hub.html?open=${encodeURIComponent(id)}`;

  function badge(text, color){ return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:.75rem;background:${color}1a;color:${color};border:1px solid ${color}55;margin-inline-end:4px">${esc(text)}</span>`; }

  function callRow(c, opts){
    const phone = c.is_hidden ? 'מספר חסוי' : (c.caller_friendly || c.caller_e164 || '');
    const local = c.caller_e164 && c.caller_e164.startsWith('+972') ? '0' + c.caller_e164.slice(4) : c.caller_e164;
    const steps = Array.isArray(c.ai_next_steps) ? c.ai_next_steps : [];
    return `<div class="pc-call" data-id="${esc(c.id)}" style="border:1px solid #e3dccb;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fffdf8">
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between">
        <div><b>${esc(fmt(c.started_at))}</b> · ${esc(phone)} ${c.duration_sec ? '· ' + dur(c.duration_sec) : ''}</div>
        <div>${c.missed ? badge('לא נענתה','#c0392b') : badge('נענתה','#1e8449')}${badge(REC[c.recording_status] || c.recording_status,'#566573')}${badge(RES[c.research_status] || c.research_status,'#2e5c9e')}${c.handled_at ? badge('טופל','#1e8449') : ''}</div>
      </div>
      ${opts && opts.leadLink && c.lead_id ? `<div style="margin-top:4px"><a href="${CRM_LEAD(c.lead_id)}">פתח את הליד</a></div>` : ''}
      <div class="pc-actions" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
        ${c.recording_status === 'available' || c.recording_status === 'pending' ? `<button type="button" class="pc-listen">▶️ האזן לשיחה</button>` : ''}
        ${c.ai_gist || c.ai_body ? `<button type="button" class="pc-summary">📝 צפה בסיכום</button>` : ''}
        <button type="button" class="pc-research">🔎 פרטי המחקר</button>
        ${!c.is_hidden && local ? `<a class="pc-callback" href="tel:${esc(local)}" style="text-decoration:none"><button type="button">📞 חזור למתקשר</button></a>` : ''}
        ${(c.existing_lead_ids || []).map((id, i) => `<a href="${CRM_LEAD(id)}" target="_blank" rel="noopener"><button type="button">📂 פתח כרטיס קיים${(c.existing_lead_ids.length > 1) ? ' ' + (i+1) : ''}</button></a>`).join('')}
        ${!c.handled_at ? `<button type="button" class="pc-handled">✔️ סמן כטופל</button>` : ''}
      </div>
      <div class="pc-panel" style="display:none;margin-top:8px;white-space:pre-wrap;background:#f6f8fc;border-radius:8px;padding:8px 10px;font-size:.88rem"></div>
      <audio class="pc-audio" controls preload="none" style="display:none;width:100%;margin-top:8px"></audio>
      <template class="pc-sum">${esc(c.ai_gist ? c.ai_gist + '\n\n' : '')}${esc(c.ai_body || '')}${steps.length ? '\n\nצעדים להמשך:\n• ' + steps.map(esc).join('\n• ') : ''}</template>
      <template class="pc-res">${esc(c.research_summary || RES[c.research_status] || '')}</template>
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
      } else if (ev.target.closest('.pc-research')){
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; panel.textContent = card.querySelector('.pc-res').textContent || 'אין עדיין פרטי מחקר.';
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
  // Lead card renders asynchronously; mount whenever the placeholder appears.
  new MutationObserver(() => document.querySelectorAll('#wlPhoneCalls:not([data-pc-mounted])').forEach(mountLead))
    .observe(document.documentElement, { childList: true, subtree: true });

  window.bsdPhoneCalls = { mountLead, callRow, wire, esc, fmt };
})();
