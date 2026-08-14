// BSD CRM - הקלטת הערות קוליות לכרטיס עסק/קונה
// מקליט תמלול חופשי (לא פגישה מובנית), שולח לתמלול+סיכום (אותו pipeline
// הקיים ב-analyze-meeting-audio), ומאפשר להכניס את הסיכום לתוך שדה ההערות
// של הטופס הפתוח - לא שומר ישירות ל-DB, רק ממלא את תיבת הטקסט, כדי שהשמירה
// בפועל תמשיך לעבור דרך כפתור "שמירה" הרגיל של הטופס.
// שימוש: window.openNotesRecording({ recordId, label, textareaId, currentProfile })

(function(){
  function pickRecorderMimeType(){
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const c of candidates){ if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c; }
    return '';
  }

  let ctx = null; // {recordId, label, textareaId, currentProfile}
  let recorder = null, stream = null, chunks = [], startTime = null, timerHandle = null;

  function buildOverlay(innerHtml){
    let overlay = document.getElementById('notesRecOverlay');
    if (!overlay){
      overlay = document.createElement('div');
      overlay.id = 'notesRecOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,27,52,.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;z-index:220;padding:40px 20px;';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:24px 26px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:inherit;">${innerHtml}</div>`;
  }
  function closeOverlay(){
    const overlay = document.getElementById('notesRecOverlay');
    if (overlay) overlay.remove();
  }

  window.openNotesRecording = function(c){
    if (c.currentProfile && c.currentProfile.can_record === false){
      toast('אין לך הרשאה להקליט - פנה למנהל המערכת');
      return;
    }
    ctx = c;
    buildOverlay(`
      <h3 style="margin:0 0 14px;color:var(--navy,#0e1b34);border-right:4px solid var(--gold,#c9a24b);padding-right:10px;">🎙️ הקלטת הערות — ${esc(ctx.label)}</h3>
      <div style="color:#8a93ab;font-size:.82rem;margin-bottom:14px;">תגיד בקול חופשי מה שאתה רוצה שיירשם - הכל יתומלל ויסוכם באופן מקצועי, ותוכל לערוך/לאשר לפני שזה נכנס להערות.</div>
      <div id="notesRecArea" style="text-align:center;padding:20px 0;">
        <div style="font-size:2.2rem;margin-bottom:14px;">🎙️</div>
        <button type="button" class="btn btn-primary" onclick="window._notesRecStart()">🔴 התחל הקלטה</button>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="window._notesRecCancel()">ביטול</button>
      </div>`);
  };

  window._notesRecCancel = function(){
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (stream) stream.getTracks().forEach(t=>t.stop());
    if (timerHandle) clearInterval(timerHandle);
    closeOverlay();
  };

  window._notesRecStart = async function(){
    const mimeType = pickRecorderMimeType();
    if (!mimeType){ toast('הדפדפן הזה לא תומך בהקלטת אודיו'); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch(e){ document.getElementById('notesRecArea').innerHTML = '<div style="color:#a02c1d;">❌ אין גישה למיקרופון. יש לאשר הרשאה בדפדפן ולנסות שוב.</div>'; return; }
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => processRecording(mimeType);
    recorder.start();
    startTime = Date.now();
    document.getElementById('notesRecArea').innerHTML = `
      <div style="font-size:2.2rem;margin-bottom:10px;color:#c0392b;">🔴</div>
      <div id="notesRecTimer" style="font-size:1.6rem;font-weight:700;color:var(--navy,#0e1b34);margin-bottom:16px;">00:00</div>
      <div style="color:#8a93ab;font-size:.8rem;margin-bottom:16px;">מקליט...</div>
      <button type="button" class="btn btn-danger" onclick="window._notesRecStop()">⏹️ עצור הקלטה</button>`;
    timerHandle = setInterval(()=>{
      const secs = Math.floor((Date.now()-startTime)/1000);
      const el = document.getElementById('notesRecTimer');
      if (el) el.textContent = String(Math.floor(secs/60)).padStart(2,'0') + ':' + String(secs%60).padStart(2,'0');
    }, 500);
  };

  window._notesRecStop = function(){
    if (timerHandle) clearInterval(timerHandle);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (stream) stream.getTracks().forEach(t=>t.stop());
  };

  async function processRecording(mimeType){
    document.getElementById('notesRecArea').innerHTML = '<div style="padding:20px 0;color:#8a93ab;">⏳ מעלה הקלטה...</div>';
    const blob = new Blob(chunks, { type: mimeType });
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    const safeRand = Math.random().toString(36).slice(2, 8);
    const storagePath = `${ctx.recordId}/notes-${Date.now()}_${safeRand}.${ext}`;
    const { error: upErr } = await window.supabaseClient.storage.from('temp-audio').upload(storagePath, blob, { contentType: mimeType });
    if (upErr){ showError('שגיאה בהעלאה: ' + upErr.message, null); return; }
    document.getElementById('notesRecArea').innerHTML = '<div style="padding:20px 0;color:#8a93ab;">🧠 מתמלל ומסכם... עד דקה.</div>';
    await runAnalysis(storagePath);
  }

  async function runAnalysis(storagePath){
    // שדה meeting_type/business_name/buyer_name נדרשים ע"י ה-Edge Function הקיים,
    // גם אם זו לא "פגישה" במובן הרגיל - רק הערה מוקלטת חופשית.
    const body = { storage_path: storagePath, meeting_type: 'הערות מוקלטות', business_name: ctx.label };
    const { data, error } = await window.supabaseClient.functions.invoke('analyze-meeting-audio', { body });
    if (error || data?.error){
      let detail = data?.error || error?.message || 'שגיאה לא ידועה';
      if (error && error.context && typeof error.context.json === 'function'){
        try { const b = await error.context.json(); if (b?.error) detail = b.error; } catch(e){}
      }
      showError(detail, storagePath);
      return;
    }
    openApproval(data);
  }

  function showError(message, storagePath){
    const box = document.getElementById('notesRecArea');
    if (!box) return;
    box.innerHTML = `
      <div style="background:#fbe1de;border:1px solid #e39185;color:#7a1f10;border-radius:8px;padding:10px 14px;margin-bottom:10px;">${esc(message)}</div>
      ${storagePath ? '<div style="font-size:.78rem;color:#8a93ab;margin-bottom:10px;">ההקלטה נשמרה - אפשר לנסות שוב בלי להקליט מחדש.</div>' : ''}
      ${storagePath ? `<button type="button" class="btn btn-primary" onclick='window._notesRecRetry(${JSON.stringify(storagePath)})'>🔁 נסה שוב</button>` : ''}
    `;
  }
  window._notesRecRetry = async function(storagePath){
    document.getElementById('notesRecArea').innerHTML = '<div style="padding:20px 0;color:#8a93ab;">🧠 מנסה שוב...</div>';
    await runAnalysis(storagePath);
  };

  function openApproval(aiData){
    const summary = (aiData.analysis && aiData.analysis.summary) ? aiData.analysis.summary : '';
    const transcript = aiData.transcript || '';
    buildOverlay(`
      <h3 style="margin:0 0 14px;color:var(--navy,#0e1b34);border-right:4px solid var(--gold,#c9a24b);padding-right:10px;">✅ אישור סיכום הערות — ${esc(ctx.label)}</h3>
      <div class="field full"><label>סיכום מקצועי (ניתן לערוך)</label><textarea id="notesRecSummary" style="min-height:110px;">${esc(summary)}</textarea></div>
      <details style="margin:8px 0 14px;">
        <summary style="cursor:pointer;color:#8a93ab;font-size:.8rem;">📄 תמלול מלא (לעיון)</summary>
        <div style="font-size:.8rem;color:#40485c;background:#f7f5ee;border-radius:8px;padding:10px 12px;margin-top:8px;white-space:pre-wrap;max-height:200px;overflow-y:auto;">${esc(transcript) || '(לא זוהה תוכן קולי)'}</div>
      </details>
      <div class="modal-actions" style="flex-wrap:wrap;">
        <button type="button" class="btn btn-ghost" onclick="window._notesRecCancel()">ביטול</button>
        <button type="button" class="btn btn-ghost" onclick="window._notesRecApply('replace')">🔁 החלף את ההערות</button>
        <button type="button" class="btn btn-primary" onclick="window._notesRecApply('append')">➕ הוסף להערות הקיימות</button>
      </div>`);
  }

  window._notesRecApply = function(mode){
    const summary = document.getElementById('notesRecSummary').value.trim();
    const textarea = document.getElementById(ctx.textareaId);
    if (!textarea){ toast('שגיאה: שדה ההערות לא נמצא בטופס'); return; }
    if (mode === 'replace' || !textarea.value.trim()){
      textarea.value = summary;
    } else {
      const stamp = new Date().toLocaleDateString('he-IL') + ' ' + new Date().toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'});
      textarea.value = textarea.value.trim() + `\n\n[הקלטה ${stamp}]\n${summary}`;
    }
    closeOverlay();
    toast('הסיכום הוכנס לשדה ההערות - זכור ללחוץ "שמירה" כדי לשמור');
  };
})();
