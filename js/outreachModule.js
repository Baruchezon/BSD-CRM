/* פניות יזומות — כרטיס עסק (18.10.2026).
   אנשי קשר שעדיין לא רשומים כקונים. צוות בלבד. הפורטל קורא תצוגה בלי טלפון/מייל. */
(function () {
  const CHANNELS = ['טלפון', 'וואטסאפ', 'מייל', 'לינקדאין', 'אחר'];
  const STAGES = ['פנינו', 'לא ענה', 'יחזור', 'ממתינים לתשובה', 'ביקש חומר', 'נשלח חומר', 'שאלות', 'נקבעה פגישה', 'מעוניין — העבר לקונה', 'לא מעוניין'];
  const INTERESTED = 'מעוניין — העבר לקונה';
  let bizId = null;
  let rows = [];

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function todayIL() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (m) return m[3] + '.' + m[2] + '.' + m[1];
    try { return new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }); } catch (e) { return String(iso); }
  }
  function note(msg) { if (typeof toast === 'function') toast(msg); }
  function me() {
    return (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE && CURRENT_PROFILE.id) || null;
  }
  function sb() { return window.supabaseClient; }
  function opts(list, selected) {
    return list.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
  }
  function byId(id) { return rows.find(r => r.id === id) || null; }

  function editorHtml(row) {
    const r = row || {};
    const stage = r.status || 'פנינו';
    return `<div id="outreachEditor" data-id="${esc(r.id || '')}" style="background:#f7f5ef;border:1px solid #e3ddcf;border-radius:8px;padding:12px;margin-bottom:10px;">
      <div style="font-weight:800;color:#0e1b34;margin-bottom:8px;">${r.id ? 'עריכת פנייה' : 'פנייה חדשה'}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">
        <label>שם איש הקשר<input name="contact_name" required maxlength="160" value="${esc(r.contact_name || '')}" style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;"></label>
        <label>טלפון<input name="phone" maxlength="40" value="${esc(r.phone || '')}" style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;"></label>
        <label>אימייל<input name="email" type="email" maxlength="160" value="${esc(r.email || '')}" style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;"></label>
        <label>ערוץ<select name="channel" required style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;">${opts(CHANNELS, r.channel || 'טלפון')}</select></label>
        <label>שלב<select name="status" required style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;">${opts(STAGES, stage)}</select></label>
        <label>צעד הבא<input name="next_step" maxlength="500" value="${esc(r.next_step || '')}" style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;"></label>
        <label>תאריך לצעד הבא<input name="next_step_at" type="date" value="${esc((r.next_step_at || '').slice(0, 10))}" style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;"></label>
      </div>
      <label style="display:block;margin-top:8px;">חברה / הערות פנימיות<textarea name="company_notes" maxlength="4000" rows="2" style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;box-sizing:border-box;">${esc(r.company_notes || '')}</textarea></label>
      <label style="display:block;margin-top:8px;">סיבת הפנייה<textarea name="reason" maxlength="4000" rows="2" style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;box-sizing:border-box;">${esc(r.reason || '')}</textarea></label>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-weight:700;"><input type="checkbox" name="hidden_from_owner" style="width:auto;" ${r.hidden_from_owner ? 'checked' : ''}> הסתר את כל הפנייה מבעל העסק בפורטל</label>
      <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #d8d3c4;">
        <div style="font-weight:700;margin-bottom:6px;">עדכון ליומן</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
          <label>תאריך<input name="event_date" type="date" value="${todayIL()}" style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;"></label>
          <label>שלב בעדכון<select name="event_stage" style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;">${opts(STAGES, stage)}</select></label>
        </div>
        <label style="display:block;margin-top:8px;">הערה<textarea name="event_note" maxlength="4000" rows="2" style="width:100%;padding:7px 8px;border:1px solid #d8d3c4;border-radius:6px;font-family:inherit;box-sizing:border-box;"></textarea></label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:6px;"><input type="checkbox" name="visible_to_owner" style="width:auto;" checked> גלוי לבעל העסק</label>
      </div>
      <div id="outreachFormMsg" style="min-height:1.2em;font-size:.82rem;font-weight:700;margin-top:6px;"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button type="button" class="btn btn-primary" data-act="save">שמור פנייה</button>
        <button type="button" class="btn btn-ghost" data-act="cancel">ביטול</button>
      </div>
    </div>`;
  }

  function timelineHtml(events) {
    const list = (events || []).slice().sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)) || String(b.created_at).localeCompare(String(a.created_at)));
    if (!list.length) return '<div style="color:#999;font-size:.78rem;">אין עדיין עדכונים ביומן.</div>';
    return list.map(e => `<div style="border-right:3px solid #c9a24b;padding:4px 8px;margin:4px 0;">
      <b>${fmtDate(e.occurred_on)}</b> · ${esc(e.stage || '—')}
      ${e.visible_to_owner ? '<span style="color:#1e7b34;font-size:.72rem;"> · גלוי לבעלים</span>' : '<span style="color:#8a5a00;font-size:.72rem;"> · פנימי</span>'}
      ${e.note ? `<div style="font-size:.8rem;color:#333;">${esc(e.note)}</div>` : ''}
    </div>`).join('');
  }

  function listHtml() {
    if (!rows.length) return '<div style="color:#999;font-size:.82rem;">אין עדיין פניות יזומות לעסק הזה. פנייה כזו היא למי שעדיין לא רשום כקונה.</div>';
    return rows.map(r => `<article style="border:1px solid #e3ddcf;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fff;">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
        <div><b>${esc(r.contact_name || '—')}</b> <span style="background:#eef1f8;border-radius:10px;padding:2px 8px;font-size:.75rem;">${esc(r.channel || '')}</span>
          <span style="background:#fdedcf;border-radius:10px;padding:2px 8px;font-size:.75rem;">${esc(r.status || '')}</span>
          ${r.hidden_from_owner ? '<span style="background:#fbe2df;color:#a32d21;border-radius:10px;padding:2px 8px;font-size:.75rem;">מוסתר מהפורטל</span>' : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost" style="padding:4px 10px;font-size:.75rem;" data-act="edit" data-id="${esc(r.id)}">עריכה</button>
          ${r.converted_match_id
            ? `<a class="btn btn-ghost" style="padding:4px 10px;font-size:.75rem;text-decoration:none;" href="match-detail.html?id=${esc(r.converted_match_id)}">📁 ההתאמה</a>`
            : (r.status === INTERESTED ? `<button type="button" class="btn btn-primary" style="padding:4px 10px;font-size:.75rem;" data-act="convert" data-id="${esc(r.id)}">העבר לקונה + התאמה</button>` : '')}
        </div>
      </div>
      <div style="font-size:.8rem;color:#444;margin-top:4px;">${esc(r.phone || '—')} · ${esc(r.email || '—')}</div>
      ${r.company_notes ? `<div style="font-size:.8rem;margin-top:4px;"><b>חברה / הערות:</b> ${esc(r.company_notes)}</div>` : ''}
      ${r.reason ? `<div style="font-size:.8rem;margin-top:4px;"><b>סיבת הפנייה:</b> ${esc(r.reason)}</div>` : ''}
      <div style="font-size:.8rem;margin-top:4px;"><b>צעד הבא:</b> ${esc(r.next_step || '—')} ${r.next_step_at ? '· ' + fmtDate(r.next_step_at) : ''}</div>
      <div style="margin-top:6px;">${timelineHtml(r.events)}</div>
    </article>`).join('');
  }

  function paint(editor) {
    const box = document.getElementById('bizOutreachBox');
    if (!box) return;
    box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
      <div style="font-size:.82rem;color:#665;">פניות לאנשי קשר שאינם רשומים במערכת. טלפון ומייל נשארים כאן ולא נשלחים לפורטל בעל העסק.</div>
      <button type="button" class="btn btn-ghost" data-act="add">➕ פנייה חדשה</button>
    </div>${editor || ''}${listHtml()}`;
  }

  async function load() {
    const box = document.getElementById('bizOutreachBox');
    if (!box || !bizId) return;
    const { data, error } = await sb().from('business_outreach').select('*').eq('business_id', bizId).order('updated_at', { ascending: false });
    if (error) { box.innerHTML = `<span style="color:#a02c1d;">שגיאה בטעינת פניות יזומות: ${esc(error.message)}</span>`; return; }
    const ids = (data || []).map(r => r.id);
    let events = [];
    if (ids.length) {
      const ev = await sb().from('business_outreach_events').select('*').in('outreach_id', ids).order('occurred_on', { ascending: false });
      if (ev.error) { box.innerHTML = `<span style="color:#a02c1d;">שגיאה ביומן הפניות: ${esc(ev.error.message)}</span>`; return; }
      events = ev.data || [];
    }
    rows = (data || []).map(r => ({ ...r, events: events.filter(e => e.outreach_id === r.id) }));
    paint('');
  }

  function field(root, name) {
    const el = root.querySelector('[name="' + name + '"]');
    return el ? String(el.value || '').trim() : '';
  }
  function formValues(root) {
    const g = name => field(root, name);
    const hidden = root.querySelector('[name="hidden_from_owner"]');
    const visible = root.querySelector('[name="visible_to_owner"]');
    return {
      contact_name: g('contact_name'),
      phone: g('phone') || null,
      email: g('email') || null,
      company_notes: g('company_notes') || null,
      channel: g('channel'),
      reason: g('reason') || null,
      status: g('status'),
      next_step: g('next_step') || null,
      next_step_at: g('next_step_at') || null,
      hidden_from_owner: !!(hidden && hidden.checked),
      event_date: g('event_date') || todayIL(),
      event_stage: g('event_stage') || g('status'),
      event_note: g('event_note'),
      visible_to_owner: !!(visible && visible.checked)
    };
  }

  async function save(root) {
    const msg = document.getElementById('outreachFormMsg');
    const v = formValues(root);
    if (!v.contact_name) { msg.style.color = '#a02c1d'; msg.textContent = 'חסר שם איש קשר'; return; }
    if (!CHANNELS.includes(v.channel) || !STAGES.includes(v.status) || !STAGES.includes(v.event_stage)) {
      msg.style.color = '#a02c1d'; msg.textContent = 'ערוץ או שלב לא מוכר'; return;
    }
    const id = root.dataset.id || '';
    const prev = id ? byId(id) : null;
    const payload = {
      business_id: bizId,
      contact_name: v.contact_name,
      phone: v.phone,
      email: v.email,
      company_notes: v.company_notes,
      channel: v.channel,
      reason: v.reason,
      status: v.status,
      next_step: v.next_step,
      next_step_at: v.next_step_at,
      hidden_from_owner: v.hidden_from_owner,
      updated_by: me()
    };
    let outreachId = id;
    if (id) {
      const { error } = await sb().from('business_outreach').update(payload).eq('id', id).eq('business_id', bizId);
      if (error) { msg.style.color = '#a02c1d'; msg.textContent = error.message; return; }
    } else {
      payload.created_by = me();
      const { data, error } = await sb().from('business_outreach').insert(payload).select('id').single();
      if (error) { msg.style.color = '#a02c1d'; msg.textContent = error.message; return; }
      outreachId = data.id;
    }
    const statusChanged = !prev || prev.status !== v.status;
    if (!prev || v.event_note || statusChanged) {
      const { error } = await sb().from('business_outreach_events').insert({
        outreach_id: outreachId,
        occurred_on: v.event_date,
        stage: v.event_stage,
        note: v.event_note || null,
        visible_to_owner: v.visible_to_owner,
        created_by: me()
      });
      if (error) { msg.style.color = '#a02c1d'; msg.textContent = 'הפנייה נשמרה, אבל היומן לא: ' + error.message; return; }
    }
    note('הפנייה נשמרה');
    await load();
  }

  async function convert(id) {
    const row = byId(id);
    if (!row) return;
    if (row.converted_match_id) { location.href = 'match-detail.html?id=' + row.converted_match_id; return; }
    if (!window.confirm('ליצור קונה רשום והתאמה לעסק הזה מ«' + (row.contact_name || '') + '»?')) return;
    try {
      let leadId = null;
      const dup = await sb().rpc('bsd_check_lead_duplicate', {
        p_full_name: row.contact_name || null, p_phone: row.phone || null, p_id_number: null, p_exclude_id: null
      });
      const strong = (dup.data || []).filter(m => m.match_level === 'phone' || m.match_level === 'id_number');
      if (strong.length) {
        const ok = window.confirm('כבר קיים קונה עם אותו טלפון (' + (strong[0].full_name || 'ללא שם') + '). לחבר את ההתאמה אליו בלי קונה חדש?');
        if (!ok) return;
        leadId = strong[0].id;
      } else {
        const ins = await sb().from('leads').insert({
          type: 'buyer',
          full_name: row.contact_name,
          phone: row.phone || null,
          email: row.email || null,
          notes: [row.company_notes, row.reason].filter(Boolean).join('\n') || null,
          source: 'פנייה יזומה',
          agreement_status: 'אין הסכם',
          created_by: me(),
          handled_by: me()
        }).select('id').single();
        if (ins.error) throw new Error(ins.error.message);
        leadId = ins.data.id;
      }
      let matchId = null;
      const existing = await sb().from('matches').select('id').eq('business_id', bizId).eq('buyer_id', leadId).maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      if (existing.data) matchId = existing.data.id;
      else {
        const created = await sb().from('matches').insert({
          business_id: bizId,
          buyer_id: leadId,
          status: 'התאמה חדשה',
          match_source: 'פנייה יזומה - כרטיס עסק',
          created_by: me()
        }).select('id').single();
        if (created.error) throw new Error(created.error.message);
        matchId = created.data.id;
      }
      const upd = await sb().from('business_outreach').update({
        status: INTERESTED,
        converted_lead_id: leadId,
        converted_match_id: matchId,
        updated_by: me()
      }).eq('id', row.id).eq('business_id', bizId);
      if (upd.error) throw new Error(upd.error.message);
      await sb().from('business_outreach_events').insert({
        outreach_id: row.id,
        occurred_on: todayIL(),
        stage: INTERESTED,
        note: 'הועבר לקונה רשום ונפתחה התאמה',
        visible_to_owner: true,
        created_by: me()
      });
      note('נוצרו קונה והתאמה');
      location.href = 'match-detail.html?id=' + matchId;
    } catch (e) {
      note('שגיאה בהעברה לקונה: ' + (e.message || e));
    }
  }

  function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || !document.getElementById('bizOutreachBox').contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'add') paint(editorHtml(null));
    else if (act === 'cancel') paint('');
    else if (act === 'edit') paint(editorHtml(byId(btn.dataset.id)));
    else if (act === 'convert') convert(btn.dataset.id);
    else if (act === 'save') { const root = document.getElementById('outreachEditor'); if (root) save(root); }
  }
  function onKey(e) {
    if (e.key !== 'Enter' || !e.target.closest || !e.target.closest('#outreachEditor')) return;
    if (e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
  }

  function onChange(e) {
    const editor = e.target.closest && e.target.closest('#outreachEditor');
    if (!editor) return;
    if (e.target.name === 'event_stage') e.target.dataset.touched = '1';
    if (e.target.name === 'status') {
      const stage = editor.querySelector('[name="event_stage"]');
      if (stage && !stage.dataset.touched) stage.value = e.target.value;
    }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('change', onChange);

  window.BSDOutreach = {
    mount(id) { bizId = id; load(); }
  };
})();
