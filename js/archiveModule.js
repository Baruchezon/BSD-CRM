// ============================================================================
// archiveModule.js — חלונית "העבר לארכיון" משותפת (businesses.html + leads.html)
// נוצר 02.09.2026 כחלק מהסדרת הרשאות ניהול + מנגנון ארכיון מסודר. בכוונה
// גנרי לגמרי (לא תלוי בעסק/קונה) - onConfirm(reason) מבצע את ה-update בפועל
// בקובץ הקורא, כדי לא לשכפל לוגיקה בשני מקומות.
// ============================================================================

const ARCHIVE_REASONS = [
  'לא רלוונטי','נמכר','לא מעוניין כרגע','לא ניתן להשיג','דרישות לא מתאימות',
  'העסק ירד מהמכירה','מצא פתרון באופן עצמאי','כפילות','אחר'
];

function _archModalEsc(s){ return (s||'').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// title: כותרת החלונית (למשל "העברת \"שם העסק\" לארכיון").
// onConfirm: async function(reason) - מבוצע רק אחרי שנבחרה/הוזנה סיבה תקינה.
function openArchiveReasonModal(title, onConfirm){
  const modal = document.getElementById('modalRoot') || (function(){ const d = document.createElement('div'); d.id='modalRoot'; document.body.appendChild(d); return d; })();
  modal.innerHTML = `
    <div class="overlay"><div class="modal">
      <div class="modal-head"><h3>📁 ${_archModalEsc(title)}</h3><button type="button" class="modal-close" onclick="document.getElementById('modalRoot').innerHTML='';">✕</button></div>
      <div class="modal-body">
        <div class="field">
          <label>סיבת העברה לארכיון</label>
          <select id="archReasonSelect" onchange="document.getElementById('archReasonOther').style.display = (this.value==='אחר') ? 'block' : 'none';">
            ${ARCHIVE_REASONS.map(r=>`<option value="${_archModalEsc(r)}">${_archModalEsc(r)}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="archReasonOther" style="display:none;">
          <label>נא לפרט</label>
          <textarea id="archReasonOtherText" rows="2" placeholder="סיבה חופשית..."></textarea>
        </div>
        <div id="archReasonStatus" style="min-height:18px;font-size:.8rem;color:#b3402c;"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('modalRoot').innerHTML='';">ביטול</button>
        <button type="button" class="btn btn-primary" id="archReasonConfirmBtn">📁 העבר לארכיון</button>
      </div>
    </div></div>`;
  document.getElementById('archReasonConfirmBtn').onclick = async function(){
    const sel = document.getElementById('archReasonSelect').value;
    const reason = sel === 'אחר' ? (document.getElementById('archReasonOtherText').value || '').trim() : sel;
    if (!reason){ document.getElementById('archReasonStatus').textContent = 'נדרשת סיבה'; return; }
    document.getElementById('modalRoot').innerHTML = '';
    await onConfirm(reason);
  };
}
