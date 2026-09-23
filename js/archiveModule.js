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
// Verify the row returned by PostgreSQL; an UPDATE affecting zero rows is not success.
async function updateArchiveRecord(table, id, archived, reason){
  if (!['businesses', 'leads'].includes(table) || !id) throw new Error('רשומה לא תקינה');
  const values = { is_archived: archived };
  if (archived){
    values.archive_reason = String(reason || '').trim();
    if (!values.archive_reason) throw new Error('נדרשת סיבה להעברה לארכיון');
  } else if (table === 'businesses'){
    Object.assign(values, { listing_status:'active', removal_reason:null, sold_to:null });
  }
  const { data, error } = await window.supabaseClient.from(table)
    .update(values).eq('id', id).select('*').single();
  if (error) throw new Error(error.message);
  if (!data || data.id !== id || data.is_archived !== archived){
    throw new Error('השינוי לא אושר בשרת. בדוק הרשאות ונסה שוב.');
  }
  return data;
}

function openArchiveReasonModal(title, onConfirm){
  // Separate from the record card: cancellation/failure must preserve the open card.
  if (document.getElementById('archiveReasonRoot')) return;
  const previousFocus = document.activeElement;
  const modal = document.createElement('div');
  modal.id = 'archiveReasonRoot';
  modal.innerHTML = `
    <div class="overlay open" style="display:flex;z-index:450;padding:16px;align-items:center;" role="dialog" aria-modal="true" aria-labelledby="archReasonTitle" dir="rtl">
      <div style="background:#fff;color:#14243f;border-radius:16px;padding:24px;width:100%;max-width:480px;max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;box-shadow:0 16px 48px #0005;">
        <h3 id="archReasonTitle" style="margin:0 0 20px;font-size:1.15rem;">📁 ${_archModalEsc(title)}</h3>
        <div class="field">
          <label for="archReasonSelect">סיבת העברה לארכיון</label>
          <select id="archReasonSelect">
            ${ARCHIVE_REASONS.map(r=>`<option value="${_archModalEsc(r)}">${_archModalEsc(r)}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="archReasonOther" style="display:none;">
          <label for="archReasonOtherText">נא לפרט</label>
          <textarea id="archReasonOtherText" rows="2" placeholder="סיבה חופשית..."></textarea>
        </div>
        <div id="archReasonStatus" role="status" aria-live="polite" style="min-height:24px;margin:12px 0;font-size:1rem;color:#a42517;"></div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="archReasonConfirmBtn">📁 העבר לארכיון</button>
          <button type="button" class="btn btn-ghost" id="archReasonCancelBtn">ביטול</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const select = modal.querySelector('#archReasonSelect');
  const other = modal.querySelector('#archReasonOtherText');
  const status = modal.querySelector('#archReasonStatus');
  const confirmButton = modal.querySelector('#archReasonConfirmBtn');
  const cancelButton = modal.querySelector('#archReasonCancelBtn');
  let busy = false;
  function close(){
    if (busy) return;
    modal.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  select.onchange = () => {
    modal.querySelector('#archReasonOther').style.display = select.value === 'אחר' ? 'block' : 'none';
    if (select.value === 'אחר') other.focus();
  };
  cancelButton.onclick = close;
  modal.onkeydown = event => {
    if (event.key === 'Escape'){ event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab'){
      const controls = [...modal.querySelectorAll('select,textarea,button')].filter(el => !el.disabled && el.getClientRects().length);
      if (!controls.length){ event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first){ event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last){ event.preventDefault(); first.focus(); }
    }
  };
  confirmButton.onclick = async () => {
    if (busy) return;
    const reason = select.value === 'אחר' ? other.value.trim() : select.value;
    if (!reason){ status.textContent = 'נדרשת סיבה'; other.focus(); return; }
    busy = true;
    [confirmButton, cancelButton, select, other].forEach(el => el.disabled = true);
    status.textContent = 'מעביר לארכיון…';
    try {
      await onConfirm(reason);
      busy = false;
      close();
    } catch (error){
      status.textContent = 'שגיאה בהעברה לארכיון: ' + (error.message || 'נסה שוב');
    } finally {
      busy = false;
      [confirmButton, cancelButton, select, other].forEach(el => el.disabled = false);
    }
  };
  select.focus();
}
