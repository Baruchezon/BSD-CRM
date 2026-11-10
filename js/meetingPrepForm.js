/* BSD meeting preparation form. Screen + print. Internal only. */
(function () {
  'use strict';
  const printStyles = String.raw`
    @page { size: A4; margin: 7mm; }
    html,body {direction:rtl;font-family:Arial,sans-serif;color:#17243a;background:#fff;font-size:14pt;line-height:1.25;}
    h1{font-size:16pt;margin:0 0 3px;border-bottom:2px solid #bea05b;padding-bottom:3px}
    h2{font-size:15pt;margin:5px 0 2px}
    .meta{font-size:14pt;margin-bottom:3px}.tbl{width:100%;border-collapse:collapse;font-size:14pt}
    .tbl td,.tbl th{border:1px solid #bbc2cb;padding:2px 5px;vertical-align:top;text-align:right}
    .tbl th{background:#f0f1f4}.remarks{height:18px;min-width:70px}
    .tbl.facts td:nth-child(1),.tbl.facts th:nth-child(1){width:24%}
    .tbl.facts td:nth-child(2){width:40%}.tbl.facts td:nth-child(3){width:36%}
    .tbl.prose th{width:20%;font-weight:700}
    .tbl.prose td{width:80%}
    .value-box{white-space:pre-wrap}
    .write-box{white-space:pre-wrap;min-height:9mm}
    .line{border-bottom:1px solid #aeb4bf;height:22px}
    .meeting-section{break-inside:avoid}.screenonly{margin:8px 0}
    @media print{.screenonly{display:none!important} body,table,td,th,p,div,span,strong{font-size:14pt!important;line-height:1.25!important} h1{font-size:16pt!important} h2{font-size:15pt!important}}
  `;
  const dateToday = () => new Date().toLocaleDateString('en-CA');
  function contentApi() {
    const api = window.BSDMeetingPrepContent;
    if (!api) throw Error('קובץ תוכן הטופס לא נטען');
    return api;
  }
  async function soft(promise) {
    try {
      const res = await promise;
      if (!res || res.error) return null;
      return res.data;
    } catch (_e) {
      return null;
    }
  }
  function phone9(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.startsWith('972')) d = d.slice(3);
    if (d.startsWith('0')) d = d.slice(1);
    return /^\d{8,9}$/.test(d) ? d.slice(0, 9) : '';
  }
  async function loadPrepContext(db, biz) {
    const meetingSelect = 'id,meeting_date,meeting_type,summary_text,decisions,notes,raw_transcript,match_id';
    const { data, error } = await db.from('match_meetings').select(meetingSelect)
      .eq('business_id', biz.id).is('deleted_at', null).order('meeting_date', { ascending: false }).limit(30);
    if (error) throw error;
    const meetings = data || [];
    const sellerId = biz.seller_id || null;
    const p9 = phone9(biz.owner_phone);
    const leadPromise = sellerId
      ? soft(db.from('leads').select('id,business_name,company,lead_business_label,notes,meeting_summary,intake_conversation_summary,intake_conversation_notes').eq('id', sellerId).maybeSingle())
      : Promise.resolve(null);
    const notesPromise = soft(db.from('record_notes').select('note_text,created_at').eq('table_name', 'businesses').eq('record_id', biz.id).order('created_at', { ascending: false }).limit(8));
    let callsPromise = Promise.resolve(null);
    if (sellerId || p9) {
      let q = db.from('phone_calls').select('id,started_at,ai_gist,ai_body,transcript,lead_id').eq('is_test', false).order('started_at', { ascending: false }).limit(6);
      const filters = [];
      if (sellerId) filters.push('lead_id.eq.' + sellerId);
      if (p9) filters.push('caller_phone9.eq.' + p9, 'destination_e164.ilike.%' + p9 + '%');
      callsPromise = soft(q.or(filters.join(',')));
    }
    const activityPromise = (async () => {
      const matches = await soft(db.from('matches').select('id').eq('business_id', biz.id).limit(40));
      const ids = (matches || []).map(m => m.id).filter(Boolean);
      if (!ids.length) return [];
      const extra = await soft(db.from('match_meetings').select(meetingSelect).in('match_id', ids).is('deleted_at', null).order('meeting_date', { ascending: false }).limit(15));
      (extra || []).forEach(m => { if (!meetings.some(x => x.id === m.id)) meetings.push(m); });
      return soft(db.from('match_activity_log').select('description,note,action_type').in('match_id', ids).is('deleted_at', null).order('created_at', { ascending: false }).limit(20));
    })();
    const [lead, recordNotes, calls, activity] = await Promise.all([leadPromise, notesPromise, callsPromise, activityPromise]);
    return { meetings, lead: lead || null, recordNotes: recordNotes || [], calls: calls || [], activity: activity || [] };
  }
  let active = null;
  async function open(biz) {
    if (!biz || !biz.id) throw Error('יש לפתוח עסק שמור');
    const db = window.supabaseClient;
    if (!db) throw Error('אין חיבור מאומת למסד הנתונים');
    const api = contentApi();
    const ctx = await loadPrepContext(db, biz);
    const existing = document.getElementById('bsdMeetingPrepOverlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'bsdMeetingPrepOverlay';
    overlay.dir = 'rtl';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#f3f5f8;overflow:auto;padding:16px;font-family:Arial,sans-serif';
    overlay.innerHTML = `<style id="bsdPrepStyle">${printStyles}</style>
      <div style="max-width:210mm;margin:auto">
      <div class="screenonly" style="display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" id="bsdPrepClose">סגור</button>
        <button type="button" id="bsdPrepPrint">הדפסה / שמירה כ PDF</button>
        <button type="button" id="bsdPrepSave">שמור סיכום בכרטיס העסק</button>
        <button type="button" id="bsdPrepResearch">🔎 רענון חקר שוק מהרשת</button>
        <span id="bsdPrepStatus" role="status" aria-live="polite"></span>
      </div>
      <div class="screenonly" style="display:grid;gap:8px;background:white;padding:12px;border:1px solid #d5dbe5;border-radius:8px">
        <label>תאריך פגישה <input id="bsdPrepDate" type="date" value="${dateToday()}"></label>
        <label>סוג פגישה <select id="bsdPrepType"><option>פגישה</option><option>שיחת טלפון</option><option>שיחת וידאו</option><option>פגישת המשך</option></select></label>
        <label>סיכום הפגישה <textarea id="bsdPrepSummary" rows="5" style="width:100%"></textarea></label>
        <label>החלטות והמשך טיפול <textarea id="bsdPrepNext" rows="3" style="width:100%"></textarea></label>
      </div>
      <div id="bsdPrepPaper" style="background:white;padding:6mm;margin:10px auto;width:210mm;max-width:100%;box-sizing:border-box">${api.renderPaper(biz, ctx, {})}</div>
      </div>`;
    document.body.appendChild(overlay);
    const parentState = history.state && typeof history.state === 'object' ? history.state : {};
    const meetingHistory = parentState.bsdCardType === 'business';
    if (meetingHistory) history.pushState({ ...parentState, bsdMeetingPrep: true }, '', location.href);
    let closing = false;
    const onBack = () => {
      if (closing) return;
      closing = true;
      window.removeEventListener('popstate', onBack);
      overlay.remove();
    };
    if (meetingHistory) window.addEventListener('popstate', onBack);
    const closePrep = () => {
      if (closing) return;
      closing = true;
      window.removeEventListener('popstate', onBack);
      overlay.remove();
      if (meetingHistory && history.state && history.state.bsdMeetingPrep) history.back();
    };
    active = { biz, ctx, overlay };
    const el = id => overlay.querySelector('#' + id);
    const edits = () => ({ date: el('bsdPrepDate').value, summary: el('bsdPrepSummary').value, next: el('bsdPrepNext').value });
    const refresh = () => { el('bsdPrepPaper').innerHTML = api.renderPaper(biz, ctx, edits()); };
    el('bsdPrepSummary').addEventListener('input', refresh);
    el('bsdPrepNext').addEventListener('input', refresh);
    el('bsdPrepDate').addEventListener('change', refresh);
    el('bsdPrepClose').onclick = closePrep;
    el('bsdPrepPrint').onclick = () => {
      refresh();
      const w = window.open('', '_blank');
      if (!w) { el('bsdPrepStatus').textContent = 'יש לאפשר חלון קופץ להדפסה'; return; }
      w.document.write('<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>BSD פגישה</title><style>' + printStyles + '</style><body>' + el('bsdPrepPaper').innerHTML + '</body></html>');
      w.document.close(); w.focus(); w.print();
    };
    el('bsdPrepSave').onclick = async () => {
      const e = edits();
      if (!e.summary.trim()) { el('bsdPrepStatus').textContent = 'יש להקליד סיכום לפני שמירה'; return; }
      if (!window.confirm('לשמור סיכום פגישה חדש בכרטיס העסק?')) return;
      const row = { business_id: biz.id, meeting_type: el('bsdPrepType').value, meeting_date: e.date, summary_text: e.summary, decisions: e.next, status: 'טיוטה' };
      el('bsdPrepSave').disabled = true;
      try {
        const { error } = await db.from('match_meetings').insert(row);
        if (error) throw error;
        el('bsdPrepStatus').textContent = 'הסיכום נשמר בכרטיס העסק';
        if (typeof window.loadBizMeetings === 'function') await window.loadBizMeetings(biz.id);
      } catch (err) { el('bsdPrepStatus').textContent = 'השמירה נכשלה: ' + (err.message || err); }
      finally { el('bsdPrepSave').disabled = false; }
    };
    el('bsdPrepResearch').onclick = async () => {
      if (!window.confirm('לחפש ברשת מידע פומבי על העסק ולשמור אותו בכרטיס? זה לשימוש פנימי בלבד, ולא נשלח ללקוח.')) return;
      const btn = el('bsdPrepResearch');
      btn.disabled = true;
      el('bsdPrepStatus').textContent = 'מחפש ברשת...';
      try {
        const { data, error } = await db.functions.invoke('meeting-prep-research', { body: { business_id: biz.id } });
        if (error) {
          let msg = error.message || String(error);
          try {
            const body = await error.context.json();
            if (body && body.error) msg = body.error;
          } catch (_e) { /* invoke error has no JSON body */ }
          throw Error(msg);
        }
        if (data && data.error) throw Error(data.error);
        const parsed = api.parseWebResearch((data && data.raw) || '');
        const research = api.cleanBlock((data && data.research) || parsed.research);
        const reviews = api.cleanBlock((data && data.reviews) || parsed.reviews);
        const { error: upErr } = await db.from('businesses').update({
          market_research_brief: research || null,
          market_reviews: reviews || null
        }).eq('id', biz.id);
        if (upErr) throw upErr;
        biz.market_research_brief = research;
        biz.market_reviews = reviews;
        refresh();
        el('bsdPrepStatus').textContent = (research || reviews)
          ? 'חקר השוק נשמר בכרטיס העסק'
          : 'החיפוש לא מצא מידע פומבי. השורות נשארו ריקות.';
      } catch (err) {
        el('bsdPrepStatus').textContent = 'חקר השוק נכשל: ' + (err.message || err);
      } finally {
        btn.disabled = false;
      }
    };
  }
  window.BSDMeetingPrep = { open };
})();
