// מנגנון מניעת כפילויות משותף - עסקים וקונים (31.08.2026)
// נטען ע"י businesses.html / leads.html / intake-form.html / buyer-form.html.
// אחראי רק על ה-UI (באנר בזמן הקלדה + דיאלוג לפני שמירה); הבדיקה עצמה
// מתבצעת מול בסיס הנתונים דרך bsd_check_business_duplicate/
// bsd_check_lead_duplicate (RPC), והאכיפה האמיתית (חסימה בפועל) קיימת
// בטריגר בצד השרת - זה כאן הוא רק שכבת נוחות/אזהרה מוקדמת למשתמש.

function bsdDupDebounce(fn, ms){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms || 500); };
}

function bsdDupIsStrong(level){
  return level === 'phone' || level === 'name_owner' || level === 'id_number';
}

// --- באנר "בזמן הקלדה" (לא חוסם) - מוצג בתוך קונטיינר שכבר קיים בטופס ---
function bsdRenderDupBanner(containerId, matches, openFnName){
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!matches || !matches.length){ el.style.display = 'none'; el.innerHTML = ''; return; }
  const strong = matches.filter(m => bsdDupIsStrong(m.match_level));
  const weak = matches.filter(m => !bsdDupIsStrong(m.match_level));
  const shown = (strong.length ? strong : weak).slice(0, 3);
  const rows = shown.map(m => {
    const label = m.internal_name || m.full_name || 'ללא שם';
    const sub = [m.owner_name, m.owner_phone || m.phone, m.business_number || m.client_number, m.status]
      .filter(Boolean).join(' · ');
    return `<div style="padding:6px 0;border-top:1px solid rgba(0,0,0,.08);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <div><b>${esc(label)}</b>${m.is_archived ? ' <span style="color:#999;">(ארכיון)</span>' : ''}<div style="font-size:.75rem;color:#777;">${esc(sub)}</div></div>
      <button type="button" class="btn btn-ghost" style="padding:3px 10px;font-size:.72rem;white-space:nowrap;" onclick="${openFnName}('${m.id}')">📂 פתח כרטיס קיים</button>
    </div>`;
  }).join('');
  const isStrong = strong.length > 0;
  const bg = isStrong ? '#fdeceb' : '#fff8e1';
  const border = isStrong ? '#e08a80' : '#e0c168';
  const title = isStrong
    ? '⚠️ קיים כבר במערכת כרטיס שעשוי להתאים לפרטים שהוזנו:'
    : '🔎 נמצא כרטיס בעל שם דומה. בדוק לפני יצירת כרטיס חדש:';
  el.style.display = 'block';
  el.style.cssText = `display:block;background:${bg};border:1px solid ${border};border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:.82rem;color:#4a3220;`;
  el.innerHTML = `<div style="font-weight:700;margin-bottom:2px;">${title}</div>${rows}`;
}

// --- דיאלוג חוסם לפני שמירה בפועל ---
// options: { matches, entityLabel }
// מחזיר Promise שמתממש ל-{action:'cancel'} | {action:'open', id} | {action:'override', reason}
function bsdShowDupConfirmDialog(options){
  const matches = options.matches || [];
  const strong = matches.filter(m => bsdDupIsStrong(m.match_level));
  const list = (strong.length ? strong : matches).slice(0, 5);
  const canOverride = window.CURRENT_PROFILE && ['admin', 'manager'].includes(window.CURRENT_PROFILE.role) && strong.length > 0;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,27,52,.6);display:flex;align-items:center;justify-content:center;z-index:600;padding:20px;';
  const rowsHtml = list.map(m => {
    const label = m.internal_name || m.full_name || 'ללא שם';
    const sub = [m.owner_name, m.owner_phone || m.phone, m.business_number || m.client_number, m.status]
      .filter(Boolean).join(' · ');
    return `<div style="padding:8px 0;border-top:1px solid #eee;">
      <div><b>${esc(label)}</b>${m.is_archived ? ' <span style="color:#999;">(ארכיון)</span>' : ''}</div>
      <div style="font-size:.78rem;color:#777;">${esc(sub)}</div>
      <button type="button" class="btn btn-ghost" style="margin-top:4px;padding:3px 12px;font-size:.75rem;" data-open-id="${m.id}">📂 פתח כרטיס קיים</button>
    </div>`;
  }).join('');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:22px 24px;box-shadow:0 20px 60px rgba(0,0,0,.4);max-height:88vh;overflow-y:auto;">
      <div style="font-size:1.05rem;font-weight:800;color:#8a2c1f;margin-bottom:4px;">⚠️ קיים כבר במערכת ${esc(options.entityLabel || 'כרטיס')} שעשוי להתאים</div>
      <div style="font-size:.85rem;color:#555;margin-bottom:10px;">בדוק את הכרטיסים הבאים לפני יצירת כרטיס חדש:</div>
      <div id="bsdDupList">${rowsHtml}</div>
      ${canOverride ? `
        <div style="margin-top:14px;border-top:1px solid #eee;padding-top:12px;">
          <label style="font-size:.78rem;color:#777;">אישור חריגה (מנהל/מנג'ר בלבד) - נדרש נימוק קצר:</label>
          <input type="text" id="bsdDupOverrideReason" placeholder="לדוגמה: שני עסקים שונים עם אותו טלפון" style="width:100%;margin-top:4px;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;">
        </div>` : ''}
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" class="btn btn-ghost" id="bsdDupCancelBtn">ביטול - חזרה לעריכה</button>
        ${canOverride ? `<button type="button" class="btn btn-ghost" style="color:#a33;" id="bsdDupOverrideBtn">צור בכל זאת (חריגה מבוקרת)</button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  return new Promise((resolve) => {
    overlay.querySelectorAll('[data-open-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-open-id');
        overlay.remove();
        resolve({ action: 'open', id });
      });
    });
    overlay.querySelector('#bsdDupCancelBtn').addEventListener('click', () => {
      overlay.remove();
      resolve({ action: 'cancel' });
    });
    const overrideBtn = overlay.querySelector('#bsdDupOverrideBtn');
    if (overrideBtn){
      overrideBtn.addEventListener('click', () => {
        const reasonEl = overlay.querySelector('#bsdDupOverrideReason');
        const reason = reasonEl ? reasonEl.value.trim() : '';
        if (!reason){
          reasonEl.style.borderColor = '#c00';
          reasonEl.focus();
          return;
        }
        overlay.remove();
        resolve({ action: 'override', reason });
      });
    }
  });
}

// מפרש שגיאת PostgREST הנובעת מהטריגר בשרת (ERRCODE='BSD01') לאובייקט
// matches אחיד, כדי שאותו דיאלוג ישמש גם כרשת ביטחון אם מסיבה כלשהי
// הבדיקה המוקדמת בצד הלקוח לא רצה/פספסה (למשל race בין שני משתמשים).
function bsdParseServerDupError(error){
  if (!error || error.code !== 'BSD01') return null;
  try {
    const match = JSON.parse(error.details);
    return [match];
  } catch(e){
    return [];
  }
}
