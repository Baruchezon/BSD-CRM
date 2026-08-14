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

function sfDisplayName(rawName){
  const idx = rawName.indexOf('__');
  if (idx === -1) return rawName;
  try { return decodeURIComponent(rawName.slice(idx + 2)); }
  catch(e){ return rawName.slice(idx + 2); }
}

let SF_CURRENT_BIZ = null;
let SF_FILES_BY_CATEGORY = {};

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
        <div class="sf-card" onclick="openSaleFileCategory('${bizId}','${cat.key}')" style="cursor:pointer;background:#fff;border:1px solid #e5e1d5;border-radius:10px;padding:10px 6px;text-align:center;box-shadow:0 1px 4px rgba(14,27,52,.07);transition:transform .16s cubic-bezier(.34,1.56,.64,1),box-shadow .16s ease;">
          <div style="font-size:1.15rem;margin-bottom:3px;">${cat.icon}</div>
          <div style="font-weight:700;font-size:.72rem;color:#0e1b34;line-height:1.25;">${esc(cat.label)}</div>
          <div style="font-size:.68rem;color:#8a93ab;margin-top:2px;">${count} ${count === 1 ? 'קובץ' : 'קבצים'}</div>
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
      <span>📄 ${esc(sfDisplayName(f.file_name))} <span style="color:#8a93ab;font-size:.75rem;">${f.confidentiality_level === 1 ? '· אנונימי' : '· חסוי'}</span></span>
      <span style="display:flex;gap:4px;flex-wrap:wrap;">
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="viewSaleFile('${f.id}','${esc(f.storage_path)}')">👁️ צפייה</button>
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="downloadSaleFile('${esc(f.storage_path)}','${esc(sfDisplayName(f.file_name)).replace(/'/g,'')}')">📂 הורדה</button>
        ${canManage ? `
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="renameSaleFile('${f.id}','${esc(sfDisplayName(f.file_name)).replace(/'/g,'')}')">✏️ שינוי שם</button>
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
  for (const rawFile of files){
    if (rawFile.size > SALE_FILE_MAX_MB * 1024 * 1024){
      toast(`הקובץ "${rawFile.name}" גדול מדי (מקסימום ${SALE_FILE_MAX_MB}MB) - דולג`);
      failCount++; continue;
    }
    let file = rawFile;
    if (categoryKey === 'business_photo' && rawFile.type.startsWith('image/')){
      try { file = await sfCompressImage(rawFile); }
      catch(e){ /* אם הדחיסה נכשלת, מעלים את הקובץ המקורי במקום לחסום */ }
    }
    if (statusEl) statusEl.textContent = `מעלה את "${rawFile.name}"...`;
    const path = `${bizId}/sale-file/${categoryKey}/${Date.now()}__${encodeURIComponent(rawFile.name)}`;
    try {
      const { error: upErr } = await window.supabaseClient.storage.from(SALE_FILE_BUCKET).upload(path, file);
      if (upErr){ toast(`שגיאה בהעלאת "${rawFile.name}": ${upErr.message}`); failCount++; continue; }
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
      if (dbErr){ toast(`הקובץ "${rawFile.name}" הועלה אך רישום נכשל: ${dbErr.message}`); failCount++; continue; }
      okCount++;
    } catch(e){
      toast(`שגיאה בלתי צפויה בהעלאת "${rawFile.name}"`);
      failCount++;
    }
  }
  if (statusEl) statusEl.textContent = '';
  input.value = '';
  if (okCount) toast(`הועלו בהצלחה ${okCount} קבצים${failCount ? `, ${failCount} נכשלו` : ''}`);
  await loadSaleFileModule(bizId);
  openSaleFileCategory(bizId, categoryKey);
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
