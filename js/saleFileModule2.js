// ============================================================
// BSD CRM — מודול "תיק מכירה" בכרטיס עסק
// ------------------------------------------------------------
// טבלת business_sale_files (מטא-דאטה) + bucket business-files הקיים
// (נתיב: <businessId>/sale-file/<category>/<timestamp>__<שם מקודד>).
// הקטגוריות מנוהלות כאן בקוד (לא ב-DB) כדי שיהיה אפשר להוסיף
// קטגוריה חדשה בעתיד בלי migration - ר' סעיף 6 בהנחיות.
// שכבת ההרשאה האמיתית היא ה-RLS (migrations/2026-08-14_sale_file_module.sql);
// הבדיקות כאן הן נוחות ממשק בלבד ולא תחליף לה.
// ============================================================

const SALE_FILE_CATEGORIES = [
  { key: 'anon_presentation', label: 'מצגת אנונימית', icon: '📊', confidentiality: 1 },
  { key: 'exec_summary',      label: 'תקציר מנהלים',   icon: '📝', confidentiality: 2 },
  { key: 'economic_analysis', label: 'ניתוח כלכלי',    icon: '📈', confidentiality: 2 },
  { key: 'valuation',         label: 'הערכת שווי',     icon: '💰', confidentiality: 2 },
  { key: 'business_photo',    label: 'תמונות העסק',    icon: '🖼️', confidentiality: 1 },
  { key: 'other',             label: 'מסמכים נוספים',  icon: '📁', confidentiality: 2 },
];
const SALE_FILE_MAX_MB = 20;
const SALE_FILE_MAX_PHOTOS = 3;
const SALE_FILE_BUCKET = 'business-files';

function sfCategoryMeta(key){
  return SALE_FILE_CATEGORIES.find(c => c.key === key) || { key, label: key, icon: '📁', confidentiality: 2 };
}

function sfIsAdminOrManager(){
  return !!CURRENT_PROFILE && (CURRENT_PROFILE.role === 'admin' || CURRENT_PROFILE.role === 'manager');
}

function sfCanUpload(){
  if (!CURRENT_PROFILE) return false;
  return sfIsAdminOrManager() || !!CURRENT_PROFILE.can_upload_sale_files;
}

// ניהול (שינוי שם/קטגוריה/מחיקה) על קובץ ספציפי: admin/manager תמיד;
// מעבר לזה, ה-RLS (sale_files_upload_permitted_update) מתיר עדכון רק לקובץ
// שהמשתמש עצמו העלה - הכפתורים חייבים לשקף בדיוק את אותו תנאי, אחרת
// הכפתור מוצג אך הפעולה נכשלת בשרת בשקט.
function sfCanManageFile(file){
  if (sfIsAdminOrManager()) return true;
  return !!CURRENT_PROFILE && !!CURRENT_PROFILE.can_upload_sale_files && file.uploaded_by === CURRENT_PROFILE.id;
}

let SF_CURRENT_BIZ = null;
let SF_FILES_BY_CATEGORY = {};
let SF_SEND_BUYERS_CACHE = null;

async function loadSaleFileModule(bizId){
  SF_CURRENT_BIZ = bizId;
  const box = document.getElementById('saleFileModuleBox');
  if (!box) return;
  const { data, error } = await window.supabaseClient
    .from('business_sale_files')
    .select('*')
    .eq('business_id', bizId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error){
    box.innerHTML = `<span style="color:#b3402c;">שגיאה בטעינת תיק המכירה: ${esc(error.message)}</span>`;
    return;
  }
  SF_FILES_BY_CATEGORY = {};
  (data || []).forEach(f => {
    (SF_FILES_BY_CATEGORY[f.category] = SF_FILES_BY_CATEGORY[f.category] || []).push(f);
  });
  renderSaleFileCards(bizId);
}

function renderSaleFileCards(bizId){
  const box = document.getElementById('saleFileModuleBox');
  if (!box) return;
  box.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;">
      ${SALE_FILE_CATEGORIES.map(cat => {
        const count = (SF_FILES_BY_CATEGORY[cat.key] || []).length;
        return `
        <div class="sf-card" onclick="openSaleFileCategory('${bizId}','${cat.key}')" style="cursor:pointer;background:#fff;border:1px solid #e5e1d5;border-radius:10px;padding:10px 6px 12px;text-align:center;box-shadow:0 1px 4px rgba(14,27,52,.07);transition:transform .16s cubic-bezier(.34,1.56,.64,1),box-shadow .16s ease;min-height:70px;">
          <div style="font-size:1.15rem;margin-bottom:3px;">${cat.icon}</div>
          <div style="font-weight:700;font-size:.72rem;color:#0e1b34;line-height:1.3;">${esc(cat.label)}</div>
          <div style="font-size:.68rem;color:#8a93ab;margin-top:3px;">${count} ${count === 1 ? 'קובץ' : 'קבצים'}</div>
        </div>`;
      }).join('')}
    </div>
    <div id="saleFileCategoryPanel" style="margin-top:14px;"></div>
  `;
  if (!document.getElementById('sfCardHoverStyle')){
    const style = document.createElement('style');
    style.id = 'sfCardHoverStyle';
    style.textContent = '.sf-card:hover{transform:translateY(-3px);box-shadow:0 8px 20px rgba(14,27,52,.16);}';
    document.head.appendChild(style);
  }
}

function openSaleFileCategory(bizId, categoryKey){
  const cat = sfCategoryMeta(categoryKey);
  const files = SF_FILES_BY_CATEGORY[categoryKey] || [];
  const panel = document.getElementById('saleFileCategoryPanel');
  if (!panel) return;
  const canUpload = sfCanUpload();
  const isPhotoCat = categoryKey === 'business_photo';
  panel.innerHTML = `
    <div style="background:#f7f5ef;border-radius:12px;padding:14px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-weight:700;color:#0e1b34;">${cat.icon} ${esc(cat.label)}</div>
        <button type="button" class="btn btn-ghost" style="padding:2px 10px;font-size:.75rem;" onclick="document.getElementById('saleFileCategoryPanel').innerHTML=''">סגור</button>
      </div>
      <div id="sfFilesList">
        ${files.length === 0
          ? '<div style="color:#999;font-size:.82rem;">אין עדיין קבצים בקטגוריה זו</div>'
          : files.map(f => sfFileRow(f, sfCanManageFile(f))).join('')}
      </div>
      ${canUpload ? `
      <div style="margin-top:12px;border-top:1px solid #e5e1d5;padding-top:10px;">
        <input type="file" id="sfUploadInput" ${isPhotoCat ? 'accept="image/*" multiple' : 'multiple'}>
        <button type="button" class="btn btn-ghost" style="margin-inline-start:8px;" onclick="uploadSaleFiles('${bizId}','${categoryKey}')">⬆️ העלה</button>
        ${isPhotoCat ? `<div style="font-size:.75rem;color:#8a93ab;margin-top:4px;">עד ${SALE_FILE_MAX_PHOTOS} תמונות סה"כ (תמונות ידחסו אוטומטית)</div>` : ''}
        <div id="sfUploadStatus" style="font-size:.78rem;color:#999;margin-top:4px;"></div>
      </div>` : ''}
    </div>
  `;
}

function sfFileRow(f, canManage){
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e5e1d5;font-size:.83rem;">
      <span>📄 ${esc(f.file_name)} <span style="color:#8a93ab;font-size:.75rem;">${f.confidentiality_level === 1 ? '· אנונימי' : '· חסוי'}</span></span>
      <span style="display:flex;gap:4px;flex-wrap:wrap;">
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="viewSaleFile('${f.id}','${esc(f.storage_path)}')">👁️ צפייה</button>
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="downloadSaleFile('${esc(f.storage_path)}','${esc(f.file_name.replace(/'/g,''))}')">📂 הורדה</button>
        ${canManage ? `
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="renameSaleFile('${f.id}','${esc(f.file_name.replace(/'/g,''))}')">✏️ שינוי שם</button>
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="changeSaleFileCategory('${f.id}','${f.category}')">🔀 שינוי קטגוריה</button>
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;color:#b3402c;" onclick="deleteSaleFile('${f.id}')">מחק</button>` : ''}
      </span>
    </div>`;
}

// ---------------------------------------------------------------
// דחיסת תמונה (canvas) - לקטגוריית תמונות העסק בלבד, לפני העלאה.
// ---------------------------------------------------------------
function sfCompressImage(file, maxDim = 1600, quality = 0.8){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim){
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        if (!blob){ reject(new Error('דחיסת התמונה נכשלה')); return; }
        resolve(new File([blob], file.name, { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadSaleFiles(bizId, categoryKey){
  if (!sfCanUpload()){ toast('אין לך הרשאת העלאת קבצים'); return; }
  const input = document.getElementById('sfUploadInput');
  const statusEl = document.getElementById('sfUploadStatus');
  const files = Array.from(input.files || []);
  if (!files.length){ toast('יש לבחור קובץ קודם'); return; }

  if (categoryKey === 'business_photo'){
    const existing = (SF_FILES_BY_CATEGORY['business_photo'] || []).length;
    if (existing + files.length > SALE_FILE_MAX_PHOTOS){
      toast(`ניתן להעלות עד ${SALE_FILE_MAX_PHOTOS} תמונות סה"כ (קיימות ${existing})`);
      return;
    }
  }

  const cat = sfCategoryMeta(categoryKey);
  let okCount = 0, failCount = 0;
  const errorMessages = [];
  for (const rawFile of files){
    if (rawFile.size > SALE_FILE_MAX_MB * 1024 * 1024){
      const msg = `הקובץ "${rawFile.name}" גדול מדי (מקסימום ${SALE_FILE_MAX_MB}MB) - דולג`;
      toast(msg); errorMessages.push(msg); failCount++; continue;
    }
    let file = rawFile;
    if (categoryKey === 'business_photo' && rawFile.type.startsWith('image/')){
      try { file = await sfCompressImage(rawFile); }
      catch(e){ /* אם הדחיסה נכשלת, מעלים את הקובץ המקורי במקום לחסום */ }
    }
    if (statusEl) statusEl.textContent = `מעלה את "${rawFile.name}"...`;
    // מפתח האחסון חייב להיות ASCII בלבד (Supabase Storage דוחה "Invalid key" עבור
    // שמות קבצים בעברית, גם אחרי encodeURIComponent) - אין בעיה, כי השם המקורי
    // האמיתי כבר נשמר בעמודת file_name בטבלה ולא צריך להיגזר מהמפתח באחסון.
    const extMatch = rawFile.name.match(/\.[A-Za-z0-9]+$/);
    const safeExt = extMatch ? extMatch[0] : '';
    const safeRand = Math.random().toString(36).slice(2, 8);
    const path = `${bizId}/sale-file/${categoryKey}/${Date.now()}_${safeRand}${safeExt}`;
    try {
      const { error: upErr } = await window.supabaseClient.storage.from(SALE_FILE_BUCKET).upload(path, file);
      if (upErr){
        console.error('sale-file storage upload error:', upErr, { bizId, categoryKey, fileName: rawFile.name });
        const msg = `שגיאה בהעלאת "${rawFile.name}": ${upErr.message}`;
        toast(msg); errorMessages.push(msg); failCount++; continue;
      }
      const { error: dbErr } = await window.supabaseClient.from('business_sale_files').insert({
        business_id: bizId,
        category: categoryKey,
        file_name: rawFile.name,
        storage_path: path,
        file_type: rawFile.type || (rawFile.name.match(/\.[A-Za-z0-9]+$/) || [''])[0],
        file_size: file.size,
        confidentiality_level: cat.confidentiality,
        uploaded_by: CURRENT_PROFILE.id
      });
      if (dbErr){
        console.error('sale-file DB insert error:', dbErr, { bizId, categoryKey, fileName: rawFile.name });
        const msg = `הקובץ "${rawFile.name}" הועלה אך רישום נכשל: ${dbErr.message}`;
        toast(msg); errorMessages.push(msg); failCount++; continue;
      }
      okCount++;
    } catch(e){
      console.error('sale-file unexpected upload exception:', e, { bizId, categoryKey, fileName: rawFile.name });
      const msg = `שגיאה בלתי צפויה בהעלאת "${rawFile.name}": ${e && e.message ? e.message : String(e)}`;
      toast(msg); errorMessages.push(msg); failCount++;
    }
  }
  input.value = '';
  if (okCount){
    if (statusEl) statusEl.textContent = '';
    toast(`הועלו בהצלחה ${okCount} קבצים${failCount ? `, ${failCount} נכשלו` : ''}`);
    await loadSaleFileModule(bizId);
    openSaleFileCategory(bizId, categoryKey);
  } else if (failCount){
    // כשל מוחלט: לא בונים מחדש את הפאנל (זה היה מוחק את הודעת השגיאה) -
    // משאירים את הטקסט האדום גלוי עד שהמשתמש ינסה שוב.
    if (statusEl) statusEl.innerHTML = `<span style="color:#b3402c;">${errorMessages.map(esc).join('<br>')}</span>`;
  }
}

async function viewSaleFile(fileId, path){
  const { data, error } = await window.supabaseClient.storage.from(SALE_FILE_BUCKET).createSignedUrl(path, 300);
  if (error){ toast('שגיאה: ' + error.message); return; }
  window.open(data.signedUrl, '_blank');
}

async function downloadSaleFile(path, suggestedName){
  const { data, error } = await window.supabaseClient.storage.from(SALE_FILE_BUCKET).createSignedUrl(path, 300, { download: suggestedName });
  if (error){ toast('שגיאה: ' + error.message); return; }
  window.open(data.signedUrl, '_blank');
}

async function renameSaleFile(fileId, currentName){
  const newName = prompt('שם חדש לקובץ:', currentName);
  if (!newName || newName.trim() === currentName) return;
  const { error } = await window.supabaseClient.from('business_sale_files')
    .update({ file_name: newName.trim(), updated_at: new Date().toISOString() }).eq('id', fileId);
  if (error){ toast('שגיאה בשינוי שם: ' + error.message); return; }
  toast('שם הקובץ עודכן');
  await loadSaleFileModule(SF_CURRENT_BIZ);
}

async function changeSaleFileCategory(fileId, currentCategory){
  const options = SALE_FILE_CATEGORIES.map(c => `${c.key} - ${c.label}`).join('\n');
  const input = prompt(`הקלד את מפתח הקטגוריה החדשה:\n${options}`, currentCategory);
  if (!input) return;
  const newCat = sfCategoryMeta(input.trim());
  if (!SALE_FILE_CATEGORIES.some(c => c.key === newCat.key)){ toast('קטגוריה לא מזוהה'); return; }
  const { error } = await window.supabaseClient.from('business_sale_files')
    .update({ category: newCat.key, confidentiality_level: newCat.confidentiality, updated_at: new Date().toISOString() }).eq('id', fileId);
  if (error){ toast('שגיאה בשינוי קטגוריה: ' + error.message); return; }
  toast('הקטגוריה עודכנה');
  await loadSaleFileModule(SF_CURRENT_BIZ);
}

async function deleteSaleFile(fileId){
  if (!confirm('למחוק קובץ זה מתיק המכירה?')) return;
  const { error } = await window.supabaseClient.from('business_sale_files')
    .update({ status: 'deleted', deleted_at: new Date().toISOString() }).eq('id', fileId);
  if (error){ toast('שגיאה במחיקה: ' + error.message); return; }
  toast('הקובץ נמחק');
  await loadSaleFileModule(SF_CURRENT_BIZ);
}

// ============================================================
// שלב 7 — שליחת חומרי תיק מכירה לקונה
// ------------------------------------------------------------
// שולח קישורים חתומים (לא מצרף קבצים גולמיים למייל) - פשוט, לא
// תלוי במגבלת גודל של Gmail, ועובד זהה לקובץ אחד או לכמה קבצים.
// חוסם קבצים ברמת סודיות 2 (חסוי) אם אין לקונה הסכם חתום - נאכף
// גם ב-UI וגם בפועל (קבצים חסויים פשוט לא נכנסים לרשימת הנבחרים).
// ============================================================
const SF_SIGNED_URL_SECONDS = 60 * 60 * 24 * 7; // שבוע

async function sfLogAudit(bizId, action, details){
  try {
    await window.supabaseClient.from('audit_log').insert({
      table_name: 'business_sale_files', record_id: bizId, action,
      actor_id: CURRENT_PROFILE ? CURRENT_PROFILE.id : null, details
    });
  } catch(e){ /* audit_log אופציונלי - לא חוסם את השליחה עצמה */ }
}

function sfAllActiveFiles(){
  return Object.values(SF_FILES_BY_CATEGORY).flat();
}

async function openSendToBuyerModal(bizId, bizName){
  // מגן הכרחי: אם ניסיון קודם השאיר overlay ישן בדף (למשל אחרי שגיאה שלא
  // נסגרה), פתיחה חוזרת הייתה יוצרת שני אלמנטים עם אותם id - ואז
  // getElementById בכל הפונקציות למטה היה עלול לתפוס בטעות את הישן/הנסתר
  // במקום את זה שבאמת רואים, וגורם לתחושת "לא קורה כלום" בלחיצה על שלח.
  document.querySelectorAll('#sfSendOverlay').forEach(el => el.remove());

  const files = sfAllActiveFiles();
  if (!files.length){ toast('אין עדיין קבצים בתיק המכירה לשליחה'); return; }
  const { data: buyers, error } = await window.supabaseClient
    .from('leads').select('id, full_name, first_name, last_name, email, agreement_status')
    .eq('type', 'buyer').order('full_name');
  if (error){ toast('שגיאה בטעינת רשימת קונים: ' + error.message); return; }
  SF_SEND_BUYERS_CACHE = {};
  (buyers || []).forEach(b => { SF_SEND_BUYERS_CACHE[b.id] = b.agreement_status; });

  const overlay = document.createElement('div');
  overlay.id = 'sfSendOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,27,52,.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;z-index:150;padding:40px 20px;';
  const buyerOptions = (buyers || []).map(b => {
    const name = b.full_name || [b.first_name, b.last_name].filter(Boolean).join(' ') || '(ללא שם)';
    return `<option value="${b.id}">${esc(name)}${b.email ? '' : ' — ⚠️ אין אימייל'}</option>`;
  }).join('');
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:520px;width:100%;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:inherit;">
      <h3 style="margin:0 0 14px;color:var(--navy);border-right:4px solid var(--gold);padding-right:10px;">📤 שליחת חומרים לקונה <span style="font-size:.6rem;color:#bbb;">v2</span></h3>
      <div class="field"><label>קונה</label>
        <select id="sfSendBuyer" onchange="sfOnBuyerChange()"><option value="">— בחר קונה —</option>${buyerOptions}</select>
      </div>
      <div id="sfSendAgreementNote" style="font-size:.8rem;margin:8px 0;"></div>
      <div style="font-weight:700;font-size:.85rem;color:var(--navy);margin-top:10px;">בחר קבצים לשליחה:</div>
      <div id="sfSendFilesList" style="max-height:220px;overflow-y:auto;margin:8px 0;border:1px solid #e5e1d5;border-radius:8px;padding:8px;">
        ${files.map(f => {
          const cat = sfCategoryMeta(f.category);
          return `
          <label style="display:flex;align-items:center;gap:8px;padding:5px 2px;font-size:.83rem;cursor:pointer;">
            <input type="checkbox" class="sfSendFileChk" data-conf="${f.confidentiality_level}" value="${f.id}" data-name="${esc(f.file_name)}" data-cat="${esc(cat.label)}" data-path="${esc(f.storage_path)}" style="width:auto;">
            ${cat.icon} ${esc(f.file_name)} <span style="color:#8a93ab;font-size:.75rem;">(${esc(cat.label)}${f.confidentiality_level === 2 ? ' · חסוי' : ' · אנונימי'})</span>
          </label>`;
        }).join('')}
      </div>
      <div id="sfSendStatus" style="font-size:.8rem;min-height:18px;margin-top:6px;"></div>
      <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px;">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('sfSendOverlay').remove()">ביטול</button>
        <button type="button" class="btn btn-primary" id="sfSendBtn" onclick="sfConfirmSend('${bizId}','${esc((bizName || 'עסק').replace(/'/g,''))}')">שלח</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  sfOnBuyerChange();
}

function sfOnBuyerChange(){
  const sel = document.getElementById('sfSendBuyer');
  const buyerId = sel.value;
  const note = document.getElementById('sfSendAgreementNote');
  const checkboxes = Array.from(document.querySelectorAll('.sfSendFileChk'));
  if (!buyerId){
    note.textContent = '';
    checkboxes.forEach(c => { c.disabled = false; c.closest('label').style.opacity = '1'; });
    return;
  }
  const option = sel.selectedOptions[0];
  // agreement_status לא נשלף שוב מהשרת כאן - כבר נטען עם רשימת הקונים; קוראים מה-dataset שנשמר ברגע הפתיחה
  const signed = SF_SEND_BUYERS_CACHE && SF_SEND_BUYERS_CACHE[buyerId] === 'יש הסכם חתום';
  if (signed){
    note.innerHTML = '<span style="color:#1f7a45;">✅ יש הסכם חתום — כל הקבצים זמינים לשליחה</span>';
    checkboxes.forEach(c => { c.disabled = false; c.closest('label').style.opacity = '1'; });
  } else {
    note.innerHTML = '<span style="color:#b3402c;">🚫 אין הסכם חתום לקונה זה — ניתן לשלוח רק קבצים אנונימיים</span>';
    checkboxes.forEach(c => {
      const confidential = c.dataset.conf === '2';
      c.disabled = confidential;
      if (confidential) c.checked = false;
      c.closest('label').style.opacity = confidential ? '.45' : '1';
    });
  }
}

async function sfConfirmSend(bizId, bizName){
  const btn = document.getElementById('sfSendBtn');
  const statusEl = document.getElementById('sfSendStatus');
  if (btn){ btn.disabled = true; btn.textContent = 'שולח...'; }
  try {
    const buyerSel = document.getElementById('sfSendBuyer');
    const buyerId = buyerSel.value;
    if (!buyerId){ throw new Error('יש לבחור קונה'); }
    const buyerOption = buyerSel.selectedOptions[0];
    const buyerName = buyerOption.textContent.replace(' — ⚠️ אין אימייל', '');

    if (statusEl) statusEl.textContent = 'בודק פרטי קונה...';
    const { data: buyerRow, error: buyerErr } = await window.supabaseClient
      .from('leads').select('email, agreement_status').eq('id', buyerId).maybeSingle();
    if (buyerErr) throw new Error('שגיאה בטעינת פרטי הקונה: ' + buyerErr.message);
    if (!buyerRow?.email) throw new Error('לקונה הזה אין כתובת אימייל שמורה - יש להוסיף אחת בכרטיס הקונה קודם');
    // נשלף עכשיו מהשרת, לא מה-cache שנטען כשהמודל נפתח - למקרה שמצב ההסכם השתנה בינתיים
    const signed = buyerRow.agreement_status === 'יש הסכם חתום';

    const selected = Array.from(document.querySelectorAll('.sfSendFileChk:checked'));
    if (!selected.length) throw new Error('יש לבחור לפחות קובץ אחד');

    // הגנה כפולה: לא סומכים רק על ה-UI (checkbox מנוטרל) - גם כאן, ברגע השליחה
    // בפועל, מסננים שוב כל קובץ חסוי אם אין הסכם חתום. אם ה-UI תקין זה תמיד
    // no-op; זו רשת ביטחון למקרה של תקלת מצב ב-JS ולא ההגנה היחידה.
    const blocked = signed ? [] : selected.filter(c => c.dataset.conf === '2');
    const allowed = signed ? selected : selected.filter(c => c.dataset.conf !== '2');
    if (!allowed.length) throw new Error('כל הקבצים שנבחרו חסויים ולקונה הזה אין הסכם חתום - לא ניתן לשלוח');
    if (blocked.length) toast(`${blocked.length} קבצים חסויים הוסרו אוטומטית מהשליחה (אין הסכם חתום לקונה זה)`);

    if (statusEl) statusEl.textContent = 'יוצר קישורים מאובטחים...';
    const linkItems = []; // [{cat, name, url}]
    const fileIds = [];
    for (const chk of allowed){
      const { data, error } = await window.supabaseClient.storage.from(SALE_FILE_BUCKET)
        .createSignedUrl(chk.dataset.path, SF_SIGNED_URL_SECONDS);
      if (error){ throw new Error(`יצירת קישור נכשלה עבור "${chk.dataset.name}": ${error.message}`); }
      linkItems.push({ cat: chk.dataset.cat, name: chk.dataset.name, url: data.signedUrl });
      fileIds.push(chk.value);
    }

    const subject = `חומרי מכירה${signed ? ' - ' + bizName : ' (אנונימי)'}`;

    // גרסת טקסט רגיל (fallback, לתוכנות מייל שלא מציגות HTML)
    const bodyText =
      `שלום ${buyerName},\n\n` +
      `מצורפים קישורים להורדת החומרים (בתוקף לשבוע):\n\n` +
      linkItems.map(l => `${l.cat} - ${l.name}:\n${l.url}`).join('\n\n') +
      `\n\nבברכה,\nBSD Business Brokers Israel`;

    // גרסת HTML - קישור לחיץ יפה במקום URL גולמי וארוך
    const htmlBody = `
      <div dir="rtl" style="font-family:Heebo,Rubik,Arial,sans-serif;color:#0e1b34;max-width:520px;">
        <p style="font-size:15px;">שלום ${esc(buyerName)},</p>
        <p style="font-size:14px;color:#444;">מצורפים קישורים להורדת החומרים (בתוקף לשבוע):</p>
        <div style="margin:18px 0;">
          ${linkItems.map(l => `
            <div style="border:1px solid #e5e1d5;border-radius:10px;padding:12px 16px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <div>
                <div style="font-weight:700;font-size:14px;">${esc(l.name)}</div>
                <div style="font-size:12px;color:#8a93ab;">${esc(l.cat)}</div>
              </div>
              <a href="${l.url}" style="background:#c9a24b;color:#1c2333;text-decoration:none;font-weight:700;font-size:13px;padding:8px 16px;border-radius:8px;white-space:nowrap;">📥 הורדה</a>
            </div>`).join('')}
        </div>
        <p style="font-size:13px;color:#8a93ab;">בברכה,<br>BSD Business Brokers Israel</p>
      </div>`;

    if (statusEl) statusEl.textContent = 'שולח מייל...';
    const { data: sendResult, error: sendErr } = await window.supabaseClient.functions.invoke('send-match-summary', {
      body: { to: buyerRow.email, subject, body_text: bodyText, html_body: htmlBody, reply_to: CURRENT_PROFILE.email }
    });
    if (sendErr || sendResult?.error){
      let detail = sendResult?.error || sendErr?.message || 'שגיאה לא ידועה';
      if (sendErr && sendErr.context && typeof sendErr.context.json === 'function'){
        try { const b = await sendErr.context.json(); if (b?.error) detail = b.error; } catch(e2){}
      }
      throw new Error(detail);
    }

    await sfLogAudit(bizId, 'send_sale_files', {
      buyer_id: buyerId, buyer_email: buyerRow.email, file_ids: fileIds,
      file_names: allowed.map(c => c.dataset.name),
      agreement_status_at_send: signed ? 'יש הסכם חתום' : 'ללא הסכם חתום',
      method: 'email'
    });
    toast('החומרים נשלחו בהצלחה');
    document.getElementById('sfSendOverlay').remove();
  } catch(e){
    console.error('sfConfirmSend error:', e);
    const msg = (e && e.message) ? e.message : String(e);
    if (statusEl) statusEl.innerHTML = `<span style="color:#b3402c;">${esc(msg)}</span>`;
    else toast('שגיאה: ' + msg);
    if (btn){ btn.disabled = false; btn.textContent = 'שלח'; }
  }
}
