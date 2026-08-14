// BSD CRM - הקלטה עצמאית (בלי התאמה) לכרטיס עסק/קונה בודד
// שימוש: window.openStandaloneRecording({ type:'business'|'buyer', id, label, currentProfile })
// דורש שהעמוד המארח יטען html2pdf.js וש-window.supabaseClient/toast()/esc()/fmtDate() קיימים.

(function(){
  const MEETING_TYPES = ['שיחה','שיחת וידאו','פגישה','פגישת נתונים','פגישת המשך','פגישת מו"מ','שיחה פנימית','אחר'];

  function ensurePrintTemplate(){
    if (document.getElementById('bsdRecCaptureOverlay')) return;
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="bsdRecCaptureOverlay" style="display:none;position:fixed;inset:0;background:#fff;z-index:99999;overflow:auto;">
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:14px;color:#5c5648;font-size:13px;">⏳ יוצר קובץ...</div>
        <div id="bsdRecPrintTemplate" style="width:760px;max-width:92vw;margin:0 auto 40px;background:#fff;padding:36px;font-family:'Heebo','Rubik','Arial Hebrew',sans-serif;color:#1c2333;direction:rtl;text-align:right;">
          <div style="display:flex;flex-direction:row;align-items:center;gap:14px;border-bottom:3px solid #c9a24b;padding-bottom:16px;margin-bottom:20px;">
            <div style="width:56px;height:56px;border-radius:50%;background:radial-gradient(circle at 35% 30%, #e8cf8a, #c9a24b 70%);display:flex;align-items:center;justify-content:center;font-weight:800;color:#1c2333;font-size:20px;flex-shrink:0;">BSD</div>
            <div>
              <div style="font-size:20px;font-weight:800;">BSD Business Brokers Israel</div>
              <div style="font-size:12px;color:#5c5648;">סיכום שיחה / פגישה</div>
            </div>
          </div>
          <h2 id="bsdRecPtTitle" style="font-size:22px;margin:0 0 4px;"></h2>
          <div id="bsdRecPtMeta" style="font-size:12px;color:#5c5648;margin-bottom:22px;"></div>
          <div id="bsdRecPtBody" style="font-size:14px;line-height:1.8;"></div>
          <div style="margin-top:30px;border-top:1px solid #e8dfc4;padding-top:12px;font-size:11px;color:#5c5648;text-align:center;">
            Baruch Ezon &nbsp;·&nbsp; BSD Business Brokers Israel &nbsp;·&nbsp; 054-2424999 &nbsp;·&nbsp; baruch@bsd-bbi.co.il &nbsp;·&nbsp; bsd-bbi.co.il
          </div>
        </div>
      </div>`;
    document.body.appendChild(div.firstElementChild);
  }
  function ensureHtml2pdf(){
    return new Promise((resolve, reject)=>{
      if (window.html2pdf){ resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('html2pdf לא נטען - בדוק חסימת רשת ל-CDN'));
      document.head.appendChild(s);
    });
  }

  function pickRecorderMimeType(){
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const c of candidates){ if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c; }
    return '';
  }

  let ctx = null; // {type, id, label, currentProfile}
  let recorder=null, stream=null, chunks=[], startTime=null, timerHandle=null;

  window.openStandaloneRecording = function(c){
    if (c.currentProfile && c.currentProfile.can_record === false){
      if (typeof toast === 'function') toast('אין לך הרשאה להקליט - פנה למנהל המערכת');
      else alert('אין לך הרשאה להקליט - פנה למנהל המערכת');
      return;
    }
    ctx = c;
    ensurePrintTemplate();
    const modal = document.getElementById('modalBox');
    modal.innerHTML = `
      <h3>🎙️ הקלטה — ${esc(ctx.label)}</h3>
      <div class="field"><label>סוג</label><select id="bsdRecType">${MEETING_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select></div>
      <div class="field"><label>מיקום (אופציונלי)</label><input type="text" id="bsdRecLocation"></div>
      <div id="bsdRecArea" style="text-align:center;padding:20px 0;">
        <div style="font-size:2.2rem;margin-bottom:14px;">🎙️</div>
        <div style="color:#8a93ab;font-size:.85rem;margin-bottom:16px;">לחץ להתחיל הקלטה. תתבקש לאשר גישה למיקרופון.</div>
        <button type="button" class="btn btn-primary" onclick="window._bsdRecStart()">🔴 התחל הקלטה</button>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="window._bsdRecCancel()">ביטול</button>
      </div>`;
    document.getElementById('overlay').classList.add('open');
  };

  window._bsdRecCancel = function(){
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (stream) stream.getTracks().forEach(t=>t.stop());
    if (timerHandle) clearInterval(timerHandle);
    document.getElementById('overlay').classList.remove('open');
    document.getElementById('modalBox').innerHTML = '';
  };

  window._bsdRecStart = async function(){
    const mimeType = pickRecorderMimeType();
    if (!mimeType){ toast('הדפדפן הזה לא תומך בהקלטת אודיו'); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch(e){ document.getElementById('bsdRecArea').innerHTML = '<div style="color:#a02c1d;">❌ אין גישה למיקרופון. יש לאשר הרשאה בדפדפן ולנסות שוב.</div>'; return; }
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => processRecording(mimeType);
    recorder.start();
    startTime = Date.now();
    document.getElementById('bsdRecArea').innerHTML = `
      <div style="font-size:2.2rem;margin-bottom:10px;color:#c0392b;">🔴</div>
      <div id="bsdRecTimer" style="font-size:1.6rem;font-weight:700;color:var(--navy,#0e1b34);margin-bottom:16px;">00:00</div>
      <div style="color:#8a93ab;font-size:.8rem;margin-bottom:16px;">מקליט...</div>
      <button type="button" class="btn btn-danger" onclick="window._bsdRecStop()">⏹️ עצור הקלטה</button>`;
    timerHandle = setInterval(()=>{
      const secs = Math.floor((Date.now()-startTime)/1000);
      const el = document.getElementById('bsdRecTimer');
      if (el) el.textContent = String(Math.floor(secs/60)).padStart(2,'0') + ':' + String(secs%60).padStart(2,'0');
    }, 500);
  };
  window._bsdRecStop = function(){
    if (timerHandle) clearInterval(timerHandle);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (stream) stream.getTracks().forEach(t=>t.stop());
  };

  async function processRecording(mimeType){
    const meetingType = document.getElementById('bsdRecType').value;
    const location = document.getElementById('bsdRecLocation').value.trim();
    document.getElementById('bsdRecArea').innerHTML = '<div style="padding:20px 0;color:#8a93ab;">⏳ מעלה הקלטה...</div>';
    const blob = new Blob(chunks, { type: mimeType });
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    const storagePath = `${ctx.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await window.supabaseClient.storage.from('temp-audio').upload(storagePath, blob, { contentType: mimeType });
    if (upErr){ showError('שגיאה בהעלאה: ' + upErr.message, null, meetingType, location); return; }
    document.getElementById('bsdRecArea').innerHTML = '<div style="padding:20px 0;color:#8a93ab;">🧠 מתמלל ומנתח... עד דקה.</div>';
    await runAnalysis(storagePath, meetingType, location);
  }

  async function runAnalysis(storagePath, meetingType, location){
    const body = { storage_path: storagePath, meeting_type: meetingType };
    if (ctx.type === 'business') body.business_name = ctx.label; else body.buyer_name = ctx.label;
    const { data, error } = await window.supabaseClient.functions.invoke('analyze-meeting-audio', { body });
    if (error || data?.error){
      let detail = data?.error || error?.message || 'שגיאה לא ידועה';
      if (error && error.context && typeof error.context.json === 'function'){
        try { const b = await error.context.json(); if (b?.error) detail = b.error; } catch(e){}
      }
      showError(detail, storagePath, meetingType, location);
      return;
    }
    document.getElementById('overlay').classList.remove('open');
    openApproval(data, meetingType, location);
  }

  function showError(message, storagePath, meetingType, location){
    document.getElementById('modalBox').innerHTML = `
      <h3>⚠️ קרתה תקלה</h3>
      <div style="background:#fbe1de;border:1px solid #e39185;color:#7a1f10;border-radius:8px;padding:10px 14px;margin-bottom:10px;">${esc(message)}</div>
      ${storagePath ? '<div style="font-size:.78rem;color:#8a93ab;margin-bottom:10px;">ההקלטה נשמרה - אפשר לנסות שוב בלי להקליט מחדש.</div>' : ''}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="window._bsdRecCancel()">סגור</button>
        ${storagePath ? `<button type="button" class="btn btn-primary" onclick='window._bsdRecRetry(${JSON.stringify(storagePath)},${JSON.stringify(meetingType)},${JSON.stringify(location)})'>🔁 נסה שוב</button>` : ''}
      </div>`;
    document.getElementById('overlay').classList.add('open');
  }
  window._bsdRecRetry = async function(storagePath, meetingType, location){
    document.getElementById('modalBox').innerHTML = '<div style="padding:20px 0;text-align:center;color:#8a93ab;">🧠 מנסה שוב...</div>';
    await runAnalysis(storagePath, meetingType, location);
  };

  let CURRENT_TASKS = [];
  function userOptionsLocal(selected){ return (window.userOptions ? window.userOptions(selected) : `<option value="${ctx.currentProfile.id}">${esc(ctx.currentProfile.full_name||ctx.currentProfile.email)}</option>`); }

  function openApproval(aiData, meetingType, location){
    const a = aiData.analysis || {};
    window._bsdRecTranscript = aiData.transcript || '';
    CURRENT_TASKS = (Array.isArray(a.tasks) ? a.tasks : []).map(t=>({ title: t.title, due_date: t.due_hint||null, assigned_to: ctx.currentProfile.id, approved:true }));
    window._bsdRecTasks = CURRENT_TASKS;
    const now = new Date();
    const modal = document.getElementById('modalBox');
    function card(icon,label,inner){ return `<div style="border:1.5px solid #e3dfd0;border-radius:10px;padding:14px 16px;margin-bottom:14px;background:#fdfcf9;box-sizing:border-box;"><div style="font-weight:700;color:#0e1b34;font-size:1rem;margin-bottom:8px;">${icon} ${label}</div>${inner}</div>`; }
    modal.innerHTML = `
      <h3>✅ אישור סיכום — ${esc(ctx.label)}</h3>
      ${ctx.type === 'general' ? `<div class="field"><label>כותרת (הוצע אוטומטית מהתמלול, ניתן לערוך)</label><input type="text" id="apTitle" value="${esc(a.suggested_title || meetingType)}"></div>` : ''}
      <div style="display:flex;gap:10px;">
        <div class="field" style="flex:1;"><label>סוג</label><select id="apType">${MEETING_TYPES.map(t=>`<option value="${t}" ${t===meetingType?'selected':''}>${t}</option>`).join('')}</select></div>
        <div class="field" style="flex:1;"><label>תאריך</label><input type="date" id="apDate" value="${now.toISOString().slice(0,10)}"></div>
        <div class="field" style="flex:1;"><label>שעה</label><input type="time" id="apStart" value="${now.toTimeString().slice(0,5)}"></div>
      </div>
      <div class="field"><label>מיקום</label><input type="text" id="apLocation" value="${esc(location)}"></div>
      ${card('📄','תמלול מלא', `<textarea readonly style="min-height:110px;width:100%;box-sizing:border-box;color:#555;">${esc(window._bsdRecTranscript || '(ריק)')}</textarea>`)}
      ${card('📝','עיקרי הדברים', `<textarea id="apSummary" style="min-height:80px;width:100%;box-sizing:border-box;">${esc(a.summary)}</textarea>`)}
      ${card('✅','החלטות', `<textarea id="apDecisions" style="min-height:60px;width:100%;box-sizing:border-box;">${esc(a.decisions)}</textarea>`)}
      ${card('❓','שאלות פתוחות', `<textarea id="apQuestions" style="min-height:60px;width:100%;box-sizing:border-box;">${esc(a.open_questions)}</textarea>`)}
      ${card('📎','מסמכים שהתבקשו', `<textarea id="apDocs" style="min-height:50px;width:100%;box-sizing:border-box;">${esc(a.requested_documents)}</textarea>`)}
      ${card('✅','משימות שזוהו', `<div id="apTasksList"></div>`)}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="window._bsdRecCancel()">ביטול</button>
        <button type="button" class="btn btn-primary" onclick="window._bsdRecSave()">✅ אשר ושמור</button>
      </div>`;
    document.getElementById('overlay').classList.add('open');
    renderTasks();
  }
  function renderTasks(){
    const box = document.getElementById('apTasksList');
    if (!CURRENT_TASKS.length){ box.innerHTML = '<div style="color:#999;font-size:.85rem;">לא זוהו משימות</div>'; return; }
    box.innerHTML = CURRENT_TASKS.map((t,i)=>`
      <div style="padding:8px 0;border-bottom:1px solid #eee;">
        <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;">
          <input type="checkbox" ${t.approved?'checked':''} onchange="window._bsdRecTasks[${i}].approved=this.checked" style="margin-top:3px;">
          <input type="text" value="${esc(t.title)}" oninput="window._bsdRecTasks[${i}].title=this.value" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #d8d3c4;border-radius:6px;">
        </label>
        <input type="date" value="${t.due_date&&/^\d{4}-\d{2}-\d{2}$/.test(t.due_date)?t.due_date:''}" onchange="window._bsdRecTasks[${i}].due_date=this.value" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #d8d3c4;border-radius:6px;">
      </div>`).join('');
  }
  window._bsdRecTasks = CURRENT_TASKS;

  window._bsdRecSave = async function(){
    const meetingType = document.getElementById('apType').value;
    const titleField = document.getElementById('apTitle');
    const payload = {
      business_id: ctx.type==='business' ? ctx.id : null,
      buyer_id: ctx.type==='buyer' ? ctx.id : null,
      title: titleField ? (titleField.value.trim() || null) : null,
      meeting_type: meetingType,
      meeting_date: document.getElementById('apDate').value || null,
      start_time: document.getElementById('apStart').value || null,
      location: document.getElementById('apLocation').value || null,
      agent_id: ctx.currentProfile.id,
      summary_text: document.getElementById('apSummary').value || null,
      decisions: document.getElementById('apDecisions').value || null,
      open_questions: document.getElementById('apQuestions').value || null,
      requested_documents: document.getElementById('apDocs').value || null,
      status: 'סופי',
      raw_transcript: window._bsdRecTranscript || null,
      created_by: ctx.currentProfile.id, updated_by: ctx.currentProfile.id, updated_at: new Date().toISOString()
    };
    const { data, error } = await window.supabaseClient.from('match_meetings').insert(payload).select().single();
    if (error){ toast('שגיאה: ' + error.message); return; }

    await window.supabaseClient.from('meeting_summary_versions').insert({
      meeting_id: data.id, version_number: 1, snapshot: payload, changed_by: ctx.currentProfile.id
    }).then(null, ()=>{});

    // גם כהערה רגילה בכרטיס - כדי שיהיה גלוי מיד בפאנל ההערות הקיים (רק כשיש כרטיס מקושר)
    if (payload.summary_text && ctx.type !== 'general'){
      await window.supabaseClient.from('record_notes').insert({
        table_name: ctx.type==='business' ? 'businesses' : 'leads', record_id: ctx.id,
        note_text: `🎙️ סיכום הקלטה (${meetingType}): ${payload.summary_text}`, author_id: ctx.currentProfile.id
      }).then(null, ()=>{});
    }

    const approvedTasks = CURRENT_TASKS.filter(t=>t.approved && t.title && t.title.trim());
    if (approvedTasks.length){
      await window.supabaseClient.from('tasks').insert(approvedTasks.map(t=>({
        title: t.title, assigned_to: t.assigned_to || ctx.currentProfile.id,
        due_date: (t.due_date && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date)) ? t.due_date : null,
        priority: 'רגילה', status: 'פתוחה',
        business_id: ctx.type==='business' ? ctx.id : null, buyer_id: ctx.type==='buyer' ? ctx.id : null,
        source: 'ai_meeting'
      })));
    }

    toast(`הסיכום נשמר${approvedTasks.length ? ` + ${approvedTasks.length} משימות` : ''}`);
    document.getElementById('overlay').classList.remove('open');
    document.getElementById('modalBox').innerHTML = '';
    if (typeof ctx.onSaved === 'function') ctx.onSaved();
  };

  // ---------- PDF: הפקה + צפייה (לא רק הורדה) ----------
  function rowHtmlLocal(label, value){
    if(!value) return '';
    return '<div style="margin-bottom:12px;"><div style="font-weight:700;color:#c9a24b;font-size:12.5px;text-transform:uppercase;">'+esc(label)+'</div><div style="white-space:pre-wrap;">'+esc(value)+'</div></div>';
  }
  function isCanvasBlank(canvas){
    try{
      const ctx2 = canvas.getContext('2d');
      const { data } = ctx2.getImageData(0,0,canvas.width,canvas.height);
      const r0=data[0],g0=data[1],b0=data[2],a0=data[3];
      for (let i=0;i<data.length;i+=4){ if (data[i]!==r0||data[i+1]!==g0||data[i+2]!==b0||data[i+3]!==a0) return false; }
      return true;
    } catch(e){ return false; }
  }
  window.generateStandaloneMeetingPdf = async function(meeting, labelForFilename){
    await ensureHtml2pdf();
    ensurePrintTemplate();
    const displayTitle = meeting.title || meeting.meeting_type || 'סיכום';
    document.getElementById('bsdRecPtTitle').textContent = displayTitle;
    document.getElementById('bsdRecPtMeta').textContent = `${fmtDate(meeting.meeting_date)} ${meeting.start_time?('· '+meeting.start_time.slice(0,5)):''}${meeting.location?(' · '+meeting.location):''}`;
    let body = rowHtmlLocal('עיקרי הדברים', meeting.summary_text) + rowHtmlLocal('החלטות', meeting.decisions) + rowHtmlLocal('שאלות פתוחות', meeting.open_questions) + rowHtmlLocal('מסמכים שהתבקשו', meeting.requested_documents);
    document.getElementById('bsdRecPtBody').innerHTML = body;
    const safeLabel = (labelForFilename || meeting.title || meeting.meeting_type || 'הקלטה').replace(/[\\/:*?"<>|]/g,'');
    const filename = `${safeLabel} - ${fmtDate(meeting.meeting_date)}.pdf`;

    const overlayEl = document.getElementById('bsdRecCaptureOverlay');
    overlayEl.style.display = 'block';
    window.scrollTo(0,0);
    await new Promise(r => requestAnimationFrame(()=>requestAnimationFrame(r)));
    try{
      const el = document.getElementById('bsdRecPrintTemplate');
      let worker, canvas, attempt=1;
      while(true){
        worker = window.html2pdf().set({ margin:10, filename, html2canvas:{scale:2,useCORS:true}, jsPDF:{unit:'mm',format:'a4',orientation:'portrait'} }).from(el);
        await worker.toCanvas();
        canvas = worker.prop.canvas;
        if ((isCanvasBlank(canvas) || canvas.width<10) && attempt<4){ attempt++; await new Promise(r=>setTimeout(r,400*attempt)); continue; }
        break;
      }
      const blob = await worker.outputPdf('blob');
      return { blob, filename };
    } finally { overlayEl.style.display = 'none'; }
  };
  window.downloadStandaloneMeetingPdf = async function(meeting, labelForFilename){
    const { blob, filename } = await window.generateStandaloneMeetingPdf(meeting, labelForFilename);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  };
  window.viewStandaloneMeetingPdf = async function(meeting, labelForFilename){
    const { blob } = await window.generateStandaloneMeetingPdf(meeting, labelForFilename);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // ---------- שליחה במייל (עם PDF מצורף) ----------
  window.sendStandaloneMeetingEmail = function(meeting, labelForFilename, currentProfile){
    const modal = document.getElementById('modalBox');
    modal.innerHTML = `
      <h3>✉️ שליחה במייל</h3>
      <div class="field"><label>כתובת מייל לשליחה</label><input type="email" id="bsdSendAddr" value="${esc(currentProfile.email)}"></div>
      <div class="field"><label>נושא</label><input type="text" id="bsdSendSubject" value="${esc(meeting.title || meeting.meeting_type || 'סיכום')} - ${fmtDate(meeting.meeting_date)}"></div>
      <div class="field"><label>תצוגה מקדימה</label><textarea readonly style="min-height:120px;">${esc(meeting.summary_text||'')}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="window._bsdRecCancel()">ביטול</button>
        <button type="button" class="btn btn-primary" id="bsdSendBtn" onclick='window._bsdSendConfirm(${JSON.stringify(meeting)}, ${JSON.stringify(labelForFilename)})'>שלח</button>
      </div>`;
    document.getElementById('overlay').classList.add('open');
  };
  window._bsdSendConfirm = async function(meeting, labelForFilename){
    const to = document.getElementById('bsdSendAddr').value.trim();
    const subject = document.getElementById('bsdSendSubject').value || 'סיכום';
    if (!to){ toast('יש להזין כתובת מייל'); return; }
    const btn = document.getElementById('bsdSendBtn');
    btn.disabled = true; btn.textContent = 'שולח...';
    try{
      const { blob } = await window.generateStandaloneMeetingPdf(meeting, labelForFilename);
      const attachment_base64 = await new Promise((resolve,reject)=>{
        const r = new FileReader();
        r.onloadend = () => resolve(String(r.result).split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      const { data, error } = await window.supabaseClient.functions.invoke('send-match-summary', {
        body: { to, subject, body_text: meeting.summary_text || 'מצורף PDF', attachment_base64, attachment_filename: 'summary.pdf' }
      });
      if (error || data?.error){
        let detail = data?.error || error?.message || 'שגיאה לא ידועה';
        if (error && error.context && typeof error.context.json === 'function'){
          try { const b = await error.context.json(); if (b?.error) detail = b.error; } catch(e){}
        }
        throw new Error(detail);
      }
      toast('נשלח בהצלחה');
      window._bsdRecCancel();
    } catch(e){
      toast('שגיאה בשליחה: ' + (e.message||e));
      btn.disabled = false; btn.textContent = 'שלח';
    }
  };
})();
