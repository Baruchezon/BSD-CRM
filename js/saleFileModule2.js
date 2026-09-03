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

// ------------------------------------------------------------------
// 6 buckets exactly as specified (29.08.2026), replacing the previous
// 6 raw-category tiles whose labels/mapping didn't match what's actually
// needed (e.g. market-research files had no tile of their own and landed
// under "מסמכים נוספים"; "מצגת אנונימית"/"הערכת שווי" didn't match the
// Sale File Builder's real document types). Each bucket carries the real
// DB (category, document_type) pair to WRITE when a file is filed into it
// (manual upload or category change) - see sfBucketKeyForFile() below for
// the READ side, which maps existing rows (including legacy ones written
// before this scheme, verified against real production data) into the
// same 6 buckets.
const SALE_FILE_CATEGORIES = [
  { key: 'anonymous_summary', label: 'תקציר אנונימי', icon: '🕶️', confidentiality: 1, dbCategory: 'exec_summary',     dbDocumentType: 'anonymous_summary' },
  { key: 'full_summary',      label: 'תקציר מלא',      icon: '📋', confidentiality: 2, dbCategory: 'exec_summary',     dbDocumentType: 'internal_full_summary' },
  { key: 'market_research',   label: 'חקר שוק',        icon: '📊', confidentiality: 2, dbCategory: 'other',            dbDocumentType: 'market_research' },
  { key: 'economic_analysis', label: 'ניתוח כלכלי',    icon: '💰', confidentiality: 2, dbCategory: 'economic_analysis', dbDocumentType: null },
  { key: 'business_photo',    label: 'תמונות',         icon: '🖼️', confidentiality: 1, dbCategory: 'business_photo',   dbDocumentType: null },
  { key: 'other',             label: 'קבצים נוספים',   icon: '📁', confidentiality: 2, dbCategory: 'other',            dbDocumentType: null },
];
const SALE_FILE_MAX_MB = 20;
const SALE_FILE_MAX_PHOTOS = 3;
const SALE_FILE_BUCKET = 'business-files';

function sfCategoryMeta(key){
  return SALE_FILE_CATEGORIES.find(c => c.key === key) || { key, label: key, icon: '📁', confidentiality: 2, dbCategory: 'other', dbDocumentType: null };
}

// Maps a real DB row (raw category + document_type, however it was written -
// including legacy rows from before this bucket scheme) to one of the 6
// display buckets above. Verified against every distinct (category,
// document_type) combination actually present in production before writing
// this (8 combos, 25 active rows) - not guessed:
//  business_photo/null, exec_summary/null, economic_analysis/null, other/null,
//  anon_presentation/null, exec_summary/anonymous_summary,
//  exec_summary/internal_full_summary, exec_summary/client_report.
function sfBucketKeyForFile(f){
  if (f.category === 'anon_presentation') return 'anonymous_summary'; // legacy raw category, pre-dates this scheme
  if (f.category === 'exec_summary'){
    // Only a real 'anonymous_summary' document_type counts as the anonymous
    // bucket; everything else under exec_summary (null, internal_full_summary,
    // short_summary, client_report) defaults to "תקציר מלא" - all of those are
    // internal/full-style documents, never anonymous ones.
    return f.document_type === 'anonymous_summary' ? 'anonymous_summary' : 'full_summary';
  }
  if (f.category === 'economic_analysis' || f.category === 'valuation') return 'economic_analysis';
  if (f.category === 'business_photo') return 'business_photo';
  if (f.category === 'other') return f.document_type === 'market_research' ? 'market_research' : 'other';
  return 'other'; // safety net for any category value not seen in the data above
}

// אבחון אמיתי של כשל העלאה - לא מסתפק בהודעה שהמערכת מציגה למשתמש.
// בודק: פרטי השגיאה המדויקים, האם יש session תקף בכלל, והאם יש חיבור רשת
// חי לשרת Supabase באותו רגע - ומציג הכל על המסך (alert חוסם כדי שאפשר
// לצלם מסך לפני שהוא נעלם) כי אין גישת Chrome Remote Debugging למכשיר.
async function sfDiagnoseUploadFailure(err, rawFile){
  const lines = ['--- אבחון שגיאת העלאה ---'];
  lines.push(`קובץ: ${rawFile ? rawFile.name : '?'} | גודל: ${rawFile ? rawFile.size : '?'} bytes | type: ${rawFile ? (rawFile.type || '(ריק)') : '?'}`);
  lines.push(`שם שגיאה (err.name): ${(err && err.name) || '?'}`);
  lines.push(`הודעת שגיאה (err.message): ${(err && err.message) || '?'}`);
  lines.push(`navigator.onLine: ${navigator.onLine}`);
  try {
    const { data: sessionData, error: sessErr } = await window.supabaseClient.auth.getSession();
    const s = sessionData && sessionData.session;
    lines.push(`יש session פעיל: ${!!s}`);
    if (s) lines.push(`ה-session פג תוקף ב: ${new Date(s.expires_at * 1000).toLocaleString('he-IL')}`);
    if (sessErr) lines.push(`שגיאת session: ${sessErr.message}`);
  } catch(e){ lines.push(`שגיאה בבדיקת session: ${e.message}`); }
  try {
    const t0 = Date.now();
    const res = await fetch(window.BSD_CONFIG.SUPABASE_URL + '/auth/v1/health');
    lines.push(`בדיקת חיבור לשרת (auth/v1/health): הצליחה - status ${res.status}, ${Date.now() - t0}ms`);
  } catch(e){ lines.push(`בדיקת חיבור לשרת (auth/v1/health): נכשלה - ${e.name}: ${e.message}`); }
  try {
    const t0 = Date.now();
    const res = await fetch(window.BSD_CONFIG.SUPABASE_URL + '/storage/v1/bucket/' + SALE_FILE_BUCKET, {
      headers: { 'apikey': window.BSD_CONFIG.SUPABASE_PUBLISHABLE_KEY, 'Authorization': 'Bearer ' + window.BSD_CONFIG.SUPABASE_PUBLISHABLE_KEY }
    });
    lines.push(`בדיקת חיבור ל-Storage bucket: status ${res.status}, ${Date.now() - t0}ms`);
  } catch(e){ lines.push(`בדיקת חיבור ל-Storage bucket: נכשלה - ${e.name}: ${e.message}`); }
  alert(lines.join('\n'));
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
let SF_SEND_BROKERS_CACHE = null;   // 03.09.2026 (מודול מתווכים) - מקביל ל-SF_SEND_BUYERS_CACHE, לא מחליף אותו
let SF_SEND_RECIPIENT_TYPE = 'buyer';   // 'buyer' | 'broker' - איזה select גלוי כרגע במודאל השליחה

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
    const bucket = sfBucketKeyForFile(f);
    (SF_FILES_BY_CATEGORY[bucket] = SF_FILES_BY_CATEGORY[bucket] || []).push(f);
  });
  renderSaleFileCards(bizId);
  // רענון הסימון "מצגת אנונימית: יש/אין" ברשימה הראשית של עסקים, אם היא טעונה כרגע
  if (typeof loadAnonPresentationIndicator === 'function' && typeof renderTable === 'function'){
    loadAnonPresentationIndicator().then(renderTable).catch(()=>{});
  }
}

function renderSaleFileCards(bizId){
  const box = document.getElementById('saleFileModuleBox');
  if (!box) return;
  box.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <button type="button" class="btn btn-primary" style="font-size:.78rem;padding:6px 14px;" onclick="sfOpenSendModalForCurrentBiz('${bizId}')">📤 שלח לקונה / מתווך</button>
    </div>
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
    style.textContent = '.sf-card:hover{transform:translateY(-3px);box-shadow:0 8px 20px rgba(14,27,52,.16);}.sf-card:active{transform:translateY(1px) scale(.97);box-shadow:0 2px 6px rgba(14,27,52,.14);}';
    document.head.appendChild(style);
  }
}

// 30.08.2026: תוקן באג אמיתי שנמצא בבדיקה - openSendToBuyerModal הייתה
// פונקציה קיימת אבל בלי שום כפתור בממשק שקורא לה בפועל (קוד "יתום").
// הכפתור מעל נוסף עכשיו; העטיפה הזו רק פותרת את שם העסק מתוך ה-cache
// הגלובלי הקיים (ALL_BIZ) כדי לא לשנות את חתימת הפונקציה עצמה.
function sfOpenSendModalForCurrentBiz(bizId){
  const biz = (typeof ALL_BIZ !== 'undefined' ? ALL_BIZ : []).find(b => b.id === bizId);
  const bizName = (biz && (biz.internal_name || biz.anonymous_name)) || 'עסק';
  openSendToBuyerModal(bizId, bizName);
}

// ---------------------------------------------------------------
// תיעוד מקור/גרסה (26.08.2026) - קבצים שנוצרו אוטומטית ע"י מודול
// התקצירים משתייכים ל-version_group_id משותף; מציגים רק את הגרסה
// האחרונה כשורה ראשית, עם קישור להרחבת היסטוריית הגרסאות הקודמות.
// קבצים שהועלו ידנית (source='manual_upload' או ריק, קבצים ישנים
// מלפני המיגרציה) ממשיכים להתנהג בדיוק כמו קודם - שום שינוי התנהגות.
// ---------------------------------------------------------------
function sfGroupForDisplay(files){
  const grouped = {}; // version_group_id -> [files]
  const standalone = [];
  files.forEach(f => {
    if (f.version_group_id){
      (grouped[f.version_group_id] = grouped[f.version_group_id] || []).push(f);
    } else {
      standalone.push(f);
    }
  });
  const primaryRows = [];
  Object.values(grouped).forEach(group => {
    group.sort((a,b) => (b.version_number||1) - (a.version_number||1));
    primaryRows.push({ latest: group[0], history: group.slice(1) });
  });
  standalone.forEach(f => primaryRows.push({ latest: f, history: [] }));
  primaryRows.sort((a,b) => new Date(b.latest.created_at) - new Date(a.latest.created_at));
  return primaryRows;
}

function sfSourceBadge(f){
  if (f.source !== 'auto_generated') return '';
  const typeLabel = f.document_type === 'short_summary' ? 'תקציר קצר'
    : f.document_type === 'internal_full_summary' ? 'תקציר עסקי מלא'
    : f.document_type === 'anonymous_summary' ? 'תקציר אנונימי'
    : 'נוצר אוטומטית';
  return `<span style="background:#eaf1fb;color:#1a4d8f;border-radius:6px;padding:1px 7px;font-size:.68rem;font-weight:700;white-space:nowrap;">🤖 ${esc(typeLabel)} · גרסה ${f.version_number||1}</span>`;
}

function toggleSfVersionHistory(groupId){
  const el = document.getElementById('sfHistory_' + groupId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function openSaleFileCategory(bizId, categoryKey){
  const cat = sfCategoryMeta(categoryKey);
  const files = SF_FILES_BY_CATEGORY[categoryKey] || [];
  const panel = document.getElementById('saleFileCategoryPanel');
  if (!panel) return;
  const hasUploadPermission = sfCanUpload();
  const canUpload = hasUploadPermission && !isAndroidMobile();
  const isPhotoCat = categoryKey === 'business_photo';
  const rows = sfGroupForDisplay(files);
  // 30.08.2026: הוסר "הפקת תקציר PDF חדש" (היה כאן כפילות מיותרת מול
  // הפקת התקצירים הקיימת כבר במקום אחר בתיק המכירה - לפי הנחיה מפורשת).
  // generateAndSaveSummaryPdf עצמה לא נמחקה, רק הכפתורים כאן שקראו לה.
  panel.innerHTML = `
    <div style="background:#f7f5ef;border-radius:12px;padding:14px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-weight:700;color:#0e1b34;">${cat.icon} ${esc(cat.label)}</div>
        <button type="button" class="btn btn-ghost" style="padding:2px 10px;font-size:.75rem;" onclick="document.getElementById('saleFileCategoryPanel').innerHTML=''">סגור</button>
      </div>
      <div id="sfFilesList">
        ${rows.length === 0
          ? `<div style="color:#5a6172;font-size:.85rem;margin-bottom:10px;">לא קיים עדיין קובץ ${esc(cat.label)}</div>` +
            (canUpload ? `<button type="button" class="btn btn-primary" style="font-size:.8rem;padding:6px 14px;" onclick="document.getElementById('sfUploadInput').click()">📤 העלה קובץ מהמחשב</button>` : '')
          : rows.map(r => {
              const row = sfFileRow(r.latest, sfCanManageFile(r.latest), bizId, categoryKey);
              if (!r.history.length) return row;
              const gid = r.latest.version_group_id;
              return row + `
                <div style="padding:2px 0 8px;">
                  <a href="#" onclick="toggleSfVersionHistory('${gid}');return false;" style="font-size:.72rem;color:#8a93ab;text-decoration:underline;">🕘 היסטוריית גרסאות קודמות (${r.history.length})</a>
                  <div id="sfHistory_${gid}" style="display:none;margin-inline-start:12px;">
                    ${r.history.map(h => sfFileRow(h, false, bizId, categoryKey)).join('')}
                  </div>
                </div>`;
            }).join('')}
      </div>
      ${canUpload ? `
      <div style="margin-top:12px;border-top:1px solid #e5e1d5;padding-top:10px;">
        <input type="file" id="sfUploadInput" multiple>
        <button type="button" class="btn btn-ghost" id="sfUploadBtn" style="margin-inline-start:8px;" onclick="uploadSaleFiles('${bizId}','${categoryKey}')">⬆️ העלה</button>
        ${isPhotoCat ? `<div style="font-size:.75rem;color:#8a93ab;margin-top:4px;">עד ${SALE_FILE_MAX_PHOTOS} תמונות סה"כ (תמונות ידחסו אוטומטית)</div>` : ''}
        <div id="sfUploadStatus" style="font-size:.78rem;color:#999;margin-top:4px;"></div>
      </div>` : (hasUploadPermission && isAndroidMobile() ? `
      <div style="margin-top:12px;border-top:1px solid #e5e1d5;padding-top:10px;color:#8a5a00;background:#fff8e6;border-radius:8px;padding:10px 12px;font-size:.82rem;">
        📱 העלאת קבצים זמינה כרגע מהמחשב בלבד
      </div>` : '')}
      <div style="margin-top:12px;border-top:1px solid #e5e1d5;padding-top:10px;text-align:end;">
        <button type="button" class="btn btn-primary" style="font-size:.78rem;padding:6px 14px;" onclick="sfOpenSendModalForCurrentBiz('${bizId}')">📤 שלח לקונה / מתווך</button>
      </div>
    </div>
  `;
}

function sfFileRow(f, canManage, bizId, categoryKey){
  const isAuto = f.source === 'auto_generated';
  const updatedDiffers = f.updated_at && f.updated_at !== f.created_at;
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e5e1d5;font-size:.83rem;flex-wrap:wrap;gap:4px;">
      <span>📄 ${esc(f.file_name)} <span style="color:#8a93ab;font-size:.75rem;">${f.confidentiality_level === 1 ? '· אנונימי' : '· חסוי'}</span> ${sfSourceBadge(f)}
        <span style="color:#b3a98a;font-size:.7rem;">נוצר: ${fmtDateTime ? fmtDateTime(f.created_at) : ''}${updatedDiffers ? (' · עודכן: ' + fmtDateTime(f.updated_at)) : ''}${f.version_number ? (' · גרסה ' + f.version_number) : ''}${f.uploaded_by ? (' · ' + (typeof userName === 'function' ? userName(f.uploaded_by) : '')) : ''}</span>
      </span>
      <span style="display:flex;gap:4px;flex-wrap:wrap;">
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="viewSaleFile('${f.id}','${esc(f.storage_path)}')">👁️ צפייה</button>
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="downloadSaleFile('${esc(f.storage_path)}','${esc(f.file_name.replace(/'/g,''))}')">📂 הורדה</button>
        ${canManage && !isAuto ? `
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="replaceSaleFile('${f.id}','${bizId}','${categoryKey}')">🔄 גרסה חדשה</button>
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="renameSaleFile('${f.id}','${esc(f.file_name.replace(/'/g,''))}')">✏️ שינוי שם</button>
        <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;" onclick="changeSaleFileCategory('${f.id}','${sfBucketKeyForFile(f)}')">🔀 שינוי קטגוריה</button>` : ''}
        ${canManage ? `<button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:.72rem;color:#b3402c;" onclick="deleteSaleFile('${f.id}')">מחק</button>` : ''}
      </span>
    </div>`;
}

// Replace a file with a new version - reuses the same version_group_id
// mechanism already used for auto-generated summaries, so the new version
// becomes primary and the old one moves into the same "🕘 היסטוריית גרסאות"
// expandable history that already existed - no new UI mechanism.
async function replaceSaleFile(fileId, bizId, categoryKey){
  if (!sfCanUpload()){ toast('אין לך הרשאת העלאת קבצים'); return; }
  const oldFile = sfAllActiveFiles().find(f => f.id === fileId);
  if (!oldFile){ toast('הקובץ המקורי לא נמצא'); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const rawFile = input.files[0];
    if (!rawFile) return;
    if (rawFile.size > SALE_FILE_MAX_MB * 1024 * 1024){ toast(`הקובץ גדול מדי (מקסימום ${SALE_FILE_MAX_MB}MB)`); return; }
    try {
      const groupId = oldFile.version_group_id || crypto.randomUUID();
      const { data: versionNum, error: verErr } = await window.supabaseClient.rpc('allocate_sale_file_version', { p_group_id: groupId });
      if (verErr) throw new Error('שגיאה בהקצאת מספר גרסה: ' + verErr.message);
      if (!oldFile.version_group_id){
        await window.supabaseClient.from('business_sale_files')
          .update({ version_group_id: groupId, version_number: 1 }).eq('id', fileId);
      }
      const cat = sfCategoryMeta(categoryKey);
      const extMatch = rawFile.name.match(/\.[A-Za-z0-9]+$/);
      const safeExt = extMatch ? extMatch[0] : '';
      const safeRand = Math.random().toString(36).slice(2, 8);
      const path = `${bizId}/sale-file/${categoryKey}/${Date.now()}_${safeRand}${safeExt}`;
      const { error: upErr } = await bsdUploadFile(SALE_FILE_BUCKET, path, rawFile, { contentType: rawFile.type || undefined });
      if (upErr) throw new Error('שגיאה בהעלאת הקובץ: ' + upErr.message);
      const { error: dbErr } = await window.supabaseClient.from('business_sale_files').insert({
        business_id: bizId, category: cat.dbCategory, document_type: cat.dbDocumentType,
        file_name: rawFile.name, storage_path: path,
        file_type: rawFile.type || safeExt, file_size: rawFile.size,
        confidentiality_level: cat.confidentiality, uploaded_by: CURRENT_PROFILE.id,
        version_group_id: groupId, version_number: versionNum,
      });
      if (dbErr) throw new Error('הקובץ הועלה אך רישום נכשל: ' + dbErr.message);
      toast('גרסה חדשה נשמרה');
      await sfLogAudit(bizId, 'replace_sale_file', { old_file_id: fileId, new_version: versionNum, category: categoryKey });
      await loadSaleFileModule(bizId);
      openSaleFileCategory(bizId, categoryKey);
    } catch (e) {
      toast('שגיאה: ' + e.message);
    }
  };
  input.click();
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
  const uploadBtn = document.getElementById('sfUploadBtn');
  const files = Array.from(input.files || []);
  if (!files.length){ toast('יש לבחור קובץ קודם'); return; }
  bsdSetButtonLoading(uploadBtn, true, 'מעלה...');

  if (categoryKey === 'business_photo'){
    const existing = (SF_FILES_BY_CATEGORY['business_photo'] || []).length;
    if (existing + files.length > SALE_FILE_MAX_PHOTOS){
      toast(`ניתן להעלות עד ${SALE_FILE_MAX_PHOTOS} תמונות סה"כ (קיימות ${existing})`);
      bsdSetButtonLoading(uploadBtn, false);
      return;
    }
  }

  const cat = sfCategoryMeta(categoryKey);
  let okCount = 0, failCount = 0;
  const errorMessages = [];
  const uploadedNames = [];
  for (const rawFile of files){
    // בעבר הסינון "רק תמונות" נעשה ע"י accept="image/*" על ה-input, אבל זה
    // גרם ל-Chrome באנדרואיד לפתוח את ה-Photo Picker המובנה של המערכת במקום
    // הבורר הרגיל - וה-Photo Picker הזה לא מציג אפשרות "Browse"/Google Drive
    // בכלל. לכן ה-input עכשיו פתוח לכל סוגי הקבצים, והסינון "רק תמונות"
    // לקטגוריית תמונות עסק נעשה כאן, אחרי הבחירה, כדי לשמור על הבורר המלא.
    if (categoryKey === 'business_photo' && rawFile.type && !rawFile.type.startsWith('image/')){
      const msg = `"${rawFile.name}" אינו קובץ תמונה - דולג (קטגוריה זו מיועדת לתמונות בלבד)`;
      toast(msg); errorMessages.push(msg); failCount++; continue;
    }
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
      const { error: upErr } = await bsdUploadFile(SALE_FILE_BUCKET, path, file, {
        contentType: file.type || undefined,
        onProgress: pct => { if (statusEl) statusEl.textContent = `מעלה את "${rawFile.name}" - ${pct}%`; }
      });
      if (upErr){
        console.error('sale-file storage upload error:', upErr, { bizId, categoryKey, fileName: rawFile.name });
        const msg = `שגיאה בהעלאת "${rawFile.name}": ${upErr.message}`;
        toast(msg); errorMessages.push(msg); failCount++;
        await sfDiagnoseUploadFailure(upErr, rawFile);
        continue;
      }
      const { error: dbErr } = await window.supabaseClient.from('business_sale_files').insert({
        business_id: bizId,
        category: cat.dbCategory,
        document_type: cat.dbDocumentType,
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
      uploadedNames.push(rawFile.name);
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
    await sfLogAudit(bizId, 'upload_sale_files', { category: categoryKey, file_names: uploadedNames, count: okCount });
    await loadSaleFileModule(bizId);
    openSaleFileCategory(bizId, categoryKey);
  } else if (failCount){
    // כשל מוחלט: לא בונים מחדש את הפאנל (זה היה מוחק את הודעת השגיאה) -
    // משאירים את הטקסט האדום גלוי עד שהמשתמש ינסה שוב.
    if (statusEl) statusEl.innerHTML = `<span style="color:#b3402c;">${errorMessages.map(esc).join('<br>')}</span>`;
    bsdSetButtonLoading(uploadBtn, false);
  }
}

async function viewSaleFile(fileId, path){
  // חלון נפתח מיד ולא אחרי await, כדי שחוסמי pop-up לא יבלמו אותו בשקט
  const win = window.open('', '_blank');
  const { data, error } = await window.supabaseClient.storage.from(SALE_FILE_BUCKET).createSignedUrl(path, 300);
  if (error){ toast('שגיאה: ' + error.message); if (win) win.close(); return; }
  if (win) win.location.href = data.signedUrl; else window.open(data.signedUrl, '_blank');
}

async function downloadSaleFile(path, suggestedName){
  const win = window.open('', '_blank');
  const { data, error } = await window.supabaseClient.storage.from(SALE_FILE_BUCKET).createSignedUrl(path, 300, { download: suggestedName });
  if (error){ toast('שגיאה: ' + error.message); if (win) win.close(); return; }
  if (win) win.location.href = data.signedUrl; else window.open(data.signedUrl, '_blank');
}

async function renameSaleFile(fileId, currentName){
  const newName = prompt('שם חדש לקובץ:', currentName);
  if (!newName || newName.trim() === currentName) return;
  const { error } = await window.supabaseClient.from('business_sale_files')
    .update({ file_name: newName.trim(), updated_at: new Date().toISOString() }).eq('id', fileId);
  if (error){ toast('שגיאה בשינוי שם: ' + error.message); return; }
  toast('שם הקובץ עודכן');
  await sfLogAudit(SF_CURRENT_BIZ, 'rename_sale_file', { file_id: fileId, old_name: currentName, new_name: newName.trim() });
  await loadSaleFileModule(SF_CURRENT_BIZ);
}

async function changeSaleFileCategory(fileId, currentBucketKey){
  const options = SALE_FILE_CATEGORIES.map(c => `${c.key} - ${c.label}`).join('\n');
  const input = prompt(`הקלד את מפתח הקטגוריה החדשה:\n${options}`, currentBucketKey);
  if (!input) return;
  const newCat = sfCategoryMeta(input.trim());
  if (!SALE_FILE_CATEGORIES.some(c => c.key === newCat.key)){ toast('קטגוריה לא מזוהה'); return; }
  const { error } = await window.supabaseClient.from('business_sale_files')
    .update({ category: newCat.dbCategory, document_type: newCat.dbDocumentType, confidentiality_level: newCat.confidentiality, updated_at: new Date().toISOString() }).eq('id', fileId);
  if (error){ toast('שגיאה בשינוי קטגוריה: ' + error.message); return; }
  toast('הקטגוריה עודכנה');
  await sfLogAudit(SF_CURRENT_BIZ, 'change_sale_file_category', { file_id: fileId, old_bucket: currentBucketKey, new_bucket: newCat.key });
  await loadSaleFileModule(SF_CURRENT_BIZ);
}

async function deleteSaleFile(fileId){
  if (!confirm('למחוק קובץ זה מתיק המכירה?')) return;
  // שולפים את שם הקובץ לפני המחיקה כדי שהתיעוד יהיה קריא (לא רק מזהה טכני)
  const fileBeingDeleted = sfAllActiveFiles().find(f => f.id === fileId);
  const { error } = await window.supabaseClient.from('business_sale_files')
    .update({ status: 'deleted', deleted_at: new Date().toISOString() }).eq('id', fileId);
  if (error){ toast('שגיאה במחיקה: ' + error.message); return; }
  toast('הקובץ נמחק');
  await sfLogAudit(SF_CURRENT_BIZ, 'delete_sale_file', { file_id: fileId, file_name: fileBeingDeleted ? fileBeingDeleted.file_name : null, category: fileBeingDeleted ? fileBeingDeleted.category : null });
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

// 30.08.2026: שודרג לפי הנחיה מפורשת (מנגנון הרשאות קשיח, לא רק אזהרת
// ממשק). שינויים עיקריים מול הגרסה הקודמת:
//  - רשימת הקונים מציגה גם טלפון וגם סטטוס התאמה לעסק הזה (לא רק שם),
//    וסטטוס ההסכם מוצג בלשון 3 המצבים המדויקת (אין הסכם / הסכם נשלח /
//    הסכם חתום) ולא רק "חתום/לא חתום".
//  - נוסף שלב תצוגה מקדימה (sfShowSendPreview) עם נושא ותוכן ניתנים
//    לעריכה, לפני שנשלח בפועל - השליחה בפועל היא רק מתוך התצוגה המקדימה.
//  - השליחה עברה לפונקציית שרת ייעודית וקשיחה, send-sale-files-to-buyer
//    (supabase/functions/send-sale-files-to-buyer) - הלקוח שולח רק
//    business_id/buyer_id/file_ids/נושא/פתיח; הבדיקה שקובץ חסוי מותר רק
//    לקונה עם הסכם חתום מתבצעת שם, בשרת, מול ה-DB בזמן אמת - לא ניתנת
//    לעקיפה מקריאת API ישירה. הנטרול כאן בממשק (sfOnBuyerChange) נשאר
//    כפי שהיה כרשת ביטחון/חוויית משתמש בלבד, לא כהגנה יחידה.
async function openSendToBuyerModal(bizId, bizName){
  // מגן הכרחי: אם ניסיון קודם השאיר overlay ישן בדף (למשל אחרי שגיאה שלא
  // נסגרה), פתיחה חוזרת הייתה יוצרת שני אלמנטים עם אותם id - ואז
  // getElementById בכל הפונקציות למטה היה עלול לתפוס בטעות את הישן/הנסתר
  // במקום את זה שבאמת רואים, וגורם לתחושת "לא קורה כלום" בלחיצה על שלח.
  document.querySelectorAll('#sfSendOverlay').forEach(el => el.remove());

  const files = sfAllActiveFiles();
  if (!files.length){ toast('אין עדיין קבצים בתיק המכירה לשליחה'); return; }

  // 03.09.2026 (מודול מתווכים, שלב 3): נטען גם רשימת מתווכים לצד רשימת
  // הקונים הקיימת - לפי הנחיה מפורשת (סעיף 6 בפרומפט הראשון + סעיף 6
  // בפרומפט השני): "בשליחת מסמך... צריך להיות אפשר לבחור: קונה או מתווך".
  // מתווכים חסומים (status='חסום') לא מוצגים כלל ברשימת הבחירה - לא ניתן
  // לבחור אותם כנמען חדש (דרישה מפורשת בסבב 3, סעיף 6).
  const [{ data: buyers, error }, { data: bizMatches }, { data: brokers, error: brokersErr }] = await Promise.all([
    window.supabaseClient.from('leads')
      .select('id, full_name, first_name, last_name, email, phone, agreement_status')
      .eq('type', 'buyer').eq('is_archived', false).order('full_name'),
    window.supabaseClient.from('matches').select('buyer_id, broker_id, counterparty_type, status').eq('business_id', bizId),
    window.supabaseClient.from('brokers')
      .select('id, full_name, first_name, last_name, email, phone, agreement_status, status')
      .eq('is_archived', false).neq('status', 'חסום').order('full_name'),
  ]);
  if (error){ toast('שגיאה בטעינת רשימת קונים: ' + error.message); return; }
  if (brokersErr){ console.error('[openSendToBuyerModal] שגיאה בטעינת מתווכים (לא חוסם את מסלול הקונה):', brokersErr); }
  const matchStatusByBuyer = {};
  const matchStatusByBroker = {};
  (bizMatches || []).forEach(m => {
    if (m.counterparty_type === 'broker' && m.broker_id) matchStatusByBroker[m.broker_id] = m.status;
    else if (m.buyer_id) matchStatusByBuyer[m.buyer_id] = m.status;
  });
  SF_SEND_BUYERS_CACHE = {};
  (buyers || []).forEach(b => { SF_SEND_BUYERS_CACHE[b.id] = b; });
  SF_SEND_BROKERS_CACHE = {};
  (brokers || []).forEach(b => { SF_SEND_BROKERS_CACHE[b.id] = b; });
  SF_SEND_RECIPIENT_TYPE = 'buyer';

  const overlay = document.createElement('div');
  overlay.id = 'sfSendOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,27,52,.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;z-index:150;padding:40px 20px;';
  const buyerOptions = (buyers || []).map(b => {
    const name = b.full_name || [b.first_name, b.last_name].filter(Boolean).join(' ') || '(ללא שם)';
    const match = matchStatusByBuyer[b.id];
    const extra = [match ? `התאמה: ${match}` : null, b.email ? null : 'אין אימייל'].filter(Boolean).join(' · ');
    return `<option value="${b.id}">${esc(name)}${extra ? ' — ⚠️ ' + esc(extra) : ''}</option>`;
  }).join('');
  const brokerOptions = (brokers || []).map(b => {
    const name = b.full_name || [b.first_name, b.last_name].filter(Boolean).join(' ') || '(ללא שם)';
    const match = matchStatusByBroker[b.id];
    const extra = [match ? `התאמה: ${match}` : null, b.email ? null : 'אין אימייל'].filter(Boolean).join(' · ');
    return `<option value="${b.id}">${esc(name)} (מתווך)${extra ? ' — ⚠️ ' + esc(extra) : ''}</option>`;
  }).join('');
  overlay.innerHTML = `
    <div id="sfSendModalBody" style="background:#fff;border-radius:14px;max-width:520px;width:100%;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:inherit;">
      <h3 style="margin:0 0 14px;color:var(--navy);border-right:4px solid var(--gold);padding-right:10px;">📤 שליחת חומרים</h3>
      <div style="display:flex;gap:8px;margin-bottom:14px;" id="sfRecipientTypeToggle">
        <button type="button" id="sfTypeBuyerBtn" onclick="sfSwitchRecipientType('buyer')" style="flex:1;padding:9px;border-radius:8px;border:1px solid #2b6fc9;background:#2b6fc9;color:#fff;cursor:pointer;font-family:inherit;font-weight:700;">🧍 קונה</button>
        <button type="button" id="sfTypeBrokerBtn" onclick="sfSwitchRecipientType('broker')" style="flex:1;padding:9px;border-radius:8px;border:1px solid #7a3fd1;background:#fff;color:#7a3fd1;cursor:pointer;font-family:inherit;font-weight:700;">🔵 מתווך / סוכן</button>
      </div>
      <div class="field" id="sfSendBuyerField"><label>קונה</label>
        <select id="sfSendBuyer" onchange="sfOnBuyerChange()"><option value="">— בחר קונה —</option>${buyerOptions}</select>
      </div>
      <div class="field" id="sfSendBrokerField" style="display:none;"><label>מתווך / סוכן</label>
        <select id="sfSendBroker" onchange="sfOnBrokerChange()"><option value="">— בחר מתווך —</option>${brokerOptions}</select>
        ${!brokerOptions ? '<div style="font-size:.75rem;color:#8a93ab;margin-top:4px;">אין מתווכים פעילים במערכת. אפשר להוסיף במסך מתווכים / סוכנים.</div>' : ''}
      </div>
      <div id="sfSendBuyerDetails" style="font-size:.8rem;margin:6px 0;color:#5a6172;"></div>
      <div id="sfSendAgreementNote" style="font-size:.8rem;margin:8px 0;font-weight:700;"></div>
      <div style="font-weight:700;font-size:.85rem;color:var(--navy);margin-top:10px;">בחר קבצים לשליחה:</div>
      <div id="sfSendFilesList" style="max-height:220px;overflow-y:auto;margin:8px 0;border:1px solid #e5e1d5;border-radius:8px;padding:8px;">
        ${files.map(f => {
          const cat = sfCategoryMeta(sfBucketKeyForFile(f));
          return `
          <label style="display:flex;align-items:center;gap:8px;padding:5px 2px;font-size:.83rem;cursor:pointer;" onclick="sfOnFileLabelClick(event,this)">
            <input type="checkbox" class="sfSendFileChk" data-conf="${f.confidentiality_level}" value="${f.id}" data-name="${esc(f.file_name)}" data-cat="${esc(cat.label)}" data-path="${esc(f.storage_path)}" style="width:auto;">
            ${cat.icon} ${esc(f.file_name)} <span style="color:#8a93ab;font-size:.75rem;">(${esc(cat.label)}${f.confidentiality_level === 2 ? ' · חסוי' : ' · אנונימי'})</span>
          </label>`;
        }).join('')}
      </div>
      <div id="sfSendStatus" style="font-size:.8rem;min-height:18px;margin-top:6px;"></div>
      <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px;">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('sfSendOverlay').remove()">ביטול</button>
        <button type="button" class="btn btn-primary" id="sfSendBtn" onclick="sfShowSendPreview('${bizId}','${esc((bizName || 'עסק').replace(/'/g,''))}')">המשך לתצוגה מקדימה</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  sfOnBuyerChange();
}

// 03.09.2026 (מודול מתווכים, שלב 3): החלפת סוג הנמען בתוך אותו מודאל -
// לא פותח מודאל חדש, רק מחליף איזה select גלוי ואיזה onChange חל, לפי
// הדרישה שהבחירה בין קונה למתווך תהיה ברורה ובולטת (סעיף 9 בסבב 2:
// "לא להציג רשימה שבה כולם נראים אותו הדבר").
function sfSwitchRecipientType(type){
  SF_SEND_RECIPIENT_TYPE = type;
  const buyerBtn = document.getElementById('sfTypeBuyerBtn');
  const brokerBtn = document.getElementById('sfTypeBrokerBtn');
  const buyerField = document.getElementById('sfSendBuyerField');
  const brokerField = document.getElementById('sfSendBrokerField');
  if (type === 'broker'){
    buyerBtn.style.background = '#fff'; buyerBtn.style.color = '#2b6fc9';
    brokerBtn.style.background = '#7a3fd1'; brokerBtn.style.color = '#fff';
    buyerField.style.display = 'none'; brokerField.style.display = '';
    document.getElementById('sfSendBuyer').value = '';
    sfOnBrokerChange();
  } else {
    brokerBtn.style.background = '#fff'; brokerBtn.style.color = '#7a3fd1';
    buyerBtn.style.background = '#2b6fc9'; buyerBtn.style.color = '#fff';
    brokerField.style.display = 'none'; buyerField.style.display = '';
    document.getElementById('sfSendBroker').value = '';
    sfOnBuyerChange();
  }
}

// לחיצה על label של קובץ חסוי המנוטרל (checkbox disabled) לא עושה כלום
// מבחינת הדפדפן - כך שהמשתמש רואה "שום דבר לא קרה" בלי הסבר. זה מציג את
// ההודעה המפורשת שנדרשה בהנחיה ("לא ניתן לשלוח קובץ זה...") בכל לחיצה כזו.
function sfOnFileLabelClick(ev, labelEl){
  const chk = labelEl.querySelector('.sfSendFileChk');
  if (chk && chk.disabled){
    ev.preventDefault();
    const who = SF_SEND_RECIPIENT_TYPE === 'broker' ? 'למתווך' : 'לקונה';
    toast(`לא ניתן לשלוח קובץ זה. ${who} אין הסכם סודיות חתום. (${chk.dataset.name})`);
  }
}

function sfOnBuyerChange(){
  const sel = document.getElementById('sfSendBuyer');
  const buyerId = sel.value;
  const note = document.getElementById('sfSendAgreementNote');
  const detailsEl = document.getElementById('sfSendBuyerDetails');
  const checkboxes = Array.from(document.querySelectorAll('.sfSendFileChk'));
  const buyer = buyerId && SF_SEND_BUYERS_CACHE ? SF_SEND_BUYERS_CACHE[buyerId] : null;
  if (!buyer){
    note.textContent = '';
    if (detailsEl) detailsEl.textContent = '';
    checkboxes.forEach(c => { c.disabled = false; c.closest('label').style.opacity = '1'; });
    return;
  }
  if (detailsEl){
    detailsEl.textContent = `📞 ${buyer.phone || 'אין טלפון'} · 📧 ${buyer.email || 'אין אימייל'}`;
  }
  const status = buyer.agreement_status || 'אין הסכם';
  const signed = status === 'יש הסכם חתום';
  if (signed){
    note.innerHTML = '<span style="color:#1f7a45;">✅ הסכם סודיות חתום, ניתן לשלוח חומר מלא</span>';
    checkboxes.forEach(c => { c.disabled = false; c.closest('label').style.opacity = '1'; });
  } else {
    const statusLabel = status === 'נשלח הסכם לחתימה' ? 'הסכם נשלח לחתימה (טרם נחתם)' : 'אין הסכם';
    note.innerHTML = `<span style="color:#b3402c;">🚫 ${esc(statusLabel)} — ניתן לשלוח חומר אנונימי בלבד</span>`;
    checkboxes.forEach(c => {
      const confidential = c.dataset.conf === '2';
      c.disabled = confidential;
      if (confidential) c.checked = false;
      c.closest('label').style.opacity = confidential ? '.45' : '1';
    });
  }
}

// 03.09.2026 (מודול מתווכים, שלב 3): מקבילה מדויקת ל-sfOnBuyerChange, לא
// נוגעת בה. אותה בדיוק לוגיקת חסימת קבצים חסויים לפי agreement_status -
// לפי הנחיה מפורשת ש"ישתמש באותו מנגנון אבטחה והרשאות של קונה ככל שניתן".
// ה-badge "🔵 מתווך" מוצג תמיד ליד השם שנבחר, לפי דרישת הסימון הבולט.
function sfOnBrokerChange(){
  const sel = document.getElementById('sfSendBroker');
  const brokerId = sel.value;
  const note = document.getElementById('sfSendAgreementNote');
  const detailsEl = document.getElementById('sfSendBuyerDetails');
  const checkboxes = Array.from(document.querySelectorAll('.sfSendFileChk'));
  const broker = brokerId && SF_SEND_BROKERS_CACHE ? SF_SEND_BROKERS_CACHE[brokerId] : null;
  if (!broker){
    note.textContent = '';
    if (detailsEl) detailsEl.textContent = '';
    checkboxes.forEach(c => { c.disabled = false; c.closest('label').style.opacity = '1'; });
    return;
  }
  if (detailsEl){
    detailsEl.innerHTML = `<span style="background:#7a3fd1;color:#fff;font-weight:800;font-size:.68rem;padding:2px 8px;border-radius:10px;">🔵 מתווך / סוכן</span> · 📞 ${esc(broker.phone || 'אין טלפון')} · 📧 ${esc(broker.email || 'אין אימייל')}`;
  }
  const status = broker.agreement_status || 'אין הסכם';
  const signed = status === 'יש הסכם חתום';
  if (signed){
    note.innerHTML = '<span style="color:#1f7a45;">✅ הסכם סודיות חתום, ניתן לשלוח חומר מלא</span>';
    checkboxes.forEach(c => { c.disabled = false; c.closest('label').style.opacity = '1'; });
  } else {
    const statusLabel = status === 'נשלח הסכם לחתימה' ? 'הסכם נשלח לחתימה (טרם נחתם)' : 'אין הסכם';
    note.innerHTML = `<span style="color:#b3402c;">🚫 ${esc(statusLabel)} — ניתן לשלוח חומר אנונימי בלבד</span>`;
    checkboxes.forEach(c => {
      const confidential = c.dataset.conf === '2';
      c.disabled = confidential;
      if (confidential) c.checked = false;
      c.closest('label').style.opacity = confidential ? '.45' : '1';
    });
  }
}

// שלב תצוגה מקדימה (סעיף 5 בהנחיה) - נושא ותוכן ניתנים לעריכה, לפני שנשלח
// בפועל. השליחה בפועל (sfConfirmSend) קוראת רק ל-Edge Function הקשיחה;
// שום קישור/קובץ לא נבחר או נבנה כאן - רק טקסט חופשי לעריכה.
function sfShowSendPreview(bizId, bizName){
  const statusEl = document.getElementById('sfSendStatus');
  const fail = (msg) => {
    toast(msg);
    if (statusEl) statusEl.innerHTML = `<span style="color:#b3402c;">${esc(msg)}</span>`;
  };
  try {
    const recipientType = SF_SEND_RECIPIENT_TYPE === 'broker' ? 'broker' : 'buyer';
    let recipientId, recipient, recipientLabel;
    if (recipientType === 'broker'){
      const brokerSel = document.getElementById('sfSendBroker');
      recipientId = brokerSel.value;
      if (!recipientId){ fail('יש לבחור מתווך'); return; }
      recipient = SF_SEND_BROKERS_CACHE[recipientId];
      if (!recipient?.email){ fail('למתווך הזה אין כתובת אימייל שמורה - יש להוסיף אחת בכרטיס המתווך קודם'); return; }
      recipientLabel = '🔵 מתווך / סוכן';
    } else {
      const buyerSel = document.getElementById('sfSendBuyer');
      recipientId = buyerSel.value;
      if (!recipientId){ fail('יש לבחור קונה'); return; }
      recipient = SF_SEND_BUYERS_CACHE[recipientId];
      if (!recipient?.email){ fail('לקונה הזה אין כתובת אימייל שמורה - יש להוסיף אחת בכרטיס הקונה קודם'); return; }
    }

    const selected = Array.from(document.querySelectorAll('.sfSendFileChk:checked'));
    if (!selected.length){ fail('יש לבחור לפחות קובץ אחד מהרשימה למעלה (סמן ✔️ ליד הקובץ)'); return; }
    const signed = recipient.agreement_status === 'יש הסכם חתום';
    const blockedNow = selected.filter(c => !signed && c.dataset.conf === '2');
    if (blockedNow.length){
      // רשת ביטחון בממשק בלבד - השרת יחסום את זה בכל מקרה גם אם זה נעקף
      const who = recipientType === 'broker' ? 'למתווך' : 'לקונה';
      fail(`לא ניתן לשלוח את הקבצים הבאים: ${blockedNow.map(c=>c.dataset.name).join(', ')}. ${who} אין הסכם סודיות חתום.`);
      return;
    }
    if (statusEl) statusEl.textContent = '';

    const recipientName = recipient.full_name || [recipient.first_name, recipient.last_name].filter(Boolean).join(' ') || (recipientType === 'broker' ? 'מתווך' : 'קונה');
    const fileIds = selected.map(c => c.value);
    const defaultSubject = `חומרי מכירה${signed ? ' - ' + bizName : ' (אנונימי)'}`;
    const defaultBody = `שלום ${recipientName},\n\nמצורפים קישורים להורדת החומרים בנוגע ל${bizName} (בתוקף לשבוע):`;

    const body = document.getElementById('sfSendModalBody');
    body.innerHTML = `
      <h3 style="margin:0 0 14px;color:var(--navy);border-right:4px solid var(--gold);padding-right:10px;">📄 תצוגה מקדימה לפני שליחה</h3>
      <div style="background:#f7f5ef;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:.85rem;">
        <div><b>${esc(recipientName)}</b> ${recipientType==='broker' ? `<span style="background:#7a3fd1;color:#fff;font-weight:800;font-size:.68rem;padding:2px 8px;border-radius:10px;">${recipientLabel}</span>` : ''} · ${esc(recipient.email)}</div>
        <div style="color:#5a6172;">${esc(bizName)}</div>
      </div>
      <div style="font-weight:700;font-size:.85rem;color:var(--navy);margin-bottom:6px;">קבצים מצורפים:</div>
      <div style="margin-bottom:12px;font-size:.83rem;">
        ${selected.map(c => `<div>📄 ${esc(c.dataset.name)} <span style="color:#8a93ab;font-size:.75rem;">(${esc(c.dataset.cat)})</span></div>`).join('')}
      </div>
      <div class="field"><label>נושא</label>
        <input type="text" id="sfPreviewSubject" value="${esc(defaultSubject)}">
      </div>
      <div class="field"><label>תוכן ההודעה</label>
        <textarea id="sfPreviewBody" rows="5" style="width:100%;">${esc(defaultBody)}</textarea>
      </div>
      <div id="sfSendStatus" style="font-size:.8rem;min-height:18px;margin-top:6px;"></div>
    <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px;">
      <button type="button" class="btn btn-ghost" onclick="document.getElementById('sfSendOverlay').remove()">ביטול</button>
      <button type="button" class="btn btn-secondary" id="sfSendWaBtn" onclick="sfConfirmSendWhatsApp('${bizId}', '${recipientId}', ${esc(JSON.stringify(fileIds))}, '${recipientType}')">📱 שלח בWhatsApp</button>
      <button type="button" class="btn btn-primary" id="sfSendBtn" onclick="sfConfirmSend('${bizId}', '${recipientId}', ${esc(JSON.stringify(fileIds))}, '${recipientType}')">📤 שלח מייל ל${recipientType==='broker' ? 'מתווך' : 'קונה'}</button>
    </div>`;
  } catch(e){
    console.error('sfShowSendPreview error:', e);
    fail('שגיאה בפתיחת התצוגה המקדימה: ' + ((e && e.message) ? e.message : String(e)));
  }
}

// 03.09.2026: תוקן באג אמיתי שדווח - לחיצה על "שלח מייל לקונה" הייתה יכולה
// להישאר תקועה לצמיתות על "שולח..." בלי שום הודעה, כי ה-await על
// functions.invoke() לא היה מוגבל בזמן: אם הבקשה ברשת נתקעת (ולא רק נכשלת),
// ה-Promise פשוט לא נפתר ולעולם לא מגיע ל-catch. sfWithClientTimeout מבטיח
// שגם אם invoke() עצמו נתקע, הפונקציה כאן תמיד תסתיים תוך 25 שניות עם
// הודעת שגיאה אמיתית - הכפתור לעולם לא יישאר תקוע.
function sfWithClientTimeout(promise, ms, label){
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`הבקשה נתקעה ולא קיבלה תשובה תוך ${Math.round(ms/1000)} שניות (${label}). בדוק את החיבור לאינטרנט ונסה שוב.`)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); },
                 (e) => { clearTimeout(timer); reject(e); });
  });
}

async function sfConfirmSend(bizId, recipientId, fileIds, recipientType){
  recipientType = recipientType === 'broker' ? 'broker' : 'buyer';
  const btn = document.getElementById('sfSendBtn');
  const statusEl = document.getElementById('sfSendStatus');
  if (btn) bsdSetButtonLoading(btn, true, 'שולח...');
  try {
    const subject = document.getElementById('sfPreviewSubject').value.trim();
    const introText = document.getElementById('sfPreviewBody').value;
    if (!subject) throw new Error('נושא המייל לא יכול להיות ריק');

    if (statusEl) statusEl.textContent = 'שולח מייל...';
    console.log('[sfConfirmSend] קורא ל-send-sale-files-to-buyer', { bizId, recipientId, recipientType, fileIds });
    // כל הבדיקה האמיתית (סטטוס הסכם, רמת סודיות כל קובץ, שליפת האימייל,
    // בניית קישורי ההורדה) מתבצעת בתוך send-sale-files-to-buyer בשרת -
    // לא כאן. הלקוח שולח רק מזהים וטקסט חופשי לעריכה.
    // 03.09.2026 (מודול מתווכים, שלב 3): recipient_type/broker_id נוספו
    // כפרמטרים אופציונליים - כשrecipientType='buyer' (ברירת המחדל, המצב
    // היחיד שהיה קיים קודם) הבקשה זהה לחלוטין למה שנשלח קודם.
    const invokeBody = { business_id: bizId, file_ids: fileIds, subject, intro_text: introText, reply_to: CURRENT_PROFILE.email, recipient_type: recipientType };
    if (recipientType === 'broker') invokeBody.broker_id = recipientId; else invokeBody.buyer_id = recipientId;
    const { data: sendResult, error: sendErr } = await sfWithClientTimeout(
      window.supabaseClient.functions.invoke('send-sale-files-to-buyer', { body: invokeBody }),
      25000, recipientType === 'broker' ? 'שליחת מייל למתווך' : 'שליחת מייל לקונה'
    );
    console.log('[sfConfirmSend] תשובה התקבלה', { sendResult, sendErr });
    if (sendErr || sendResult?.error){
      let detail = sendResult?.error || sendErr?.message || 'שגיאה לא ידועה';
      if (sendErr && sendErr.context && typeof sendErr.context.json === 'function'){
        try { const b = await sendErr.context.json(); if (b?.error) detail = b.error; } catch(e2){}
      }
      throw new Error(detail);
    }

    // 03.09.2026: תיעוד ההתאמה עצמו קורה בשרת (בתוך send-sale-files-to-buyer,
    // רק אחרי הצלחה אמיתית מ-Resend) - כאן רק מציגים למשתמש את אחת משתי
    // ההודעות המדויקות שנדרשו, לפי match_action שהפונקציה מחזירה. נוסח
    // הקונה נשאר בדיוק כפי שהיה (לא שינוי טקסט קיים); למתווך נוסף נוסח
    // מדויק כפי שנדרש במפורש בהנחיה ("ההתאמה החדשה נוצרה ותועדה" / "השליחה
    // נוספה להתאמה קיימת").
    const matchMsg = recipientType === 'broker'
      ? (sendResult?.match_action === 'created' ? 'ההתאמה החדשה נוצרה ותועדה.' : sendResult?.match_action === 'updated' ? 'השליחה נוספה להתאמה קיימת.' : 'החומרים נשלחו בהצלחה')
      : (sendResult?.match_action === 'created' ? 'השליחה בוצעה ונוצרה התאמה חדשה.' : sendResult?.match_action === 'updated' ? 'השליחה בוצעה והפעילות נוספה להתאמה הקיימת.' : 'החומרים נשלחו בהצלחה');
    toast(matchMsg);
    document.getElementById('sfSendOverlay').remove();
  } catch(e){
    console.error('[sfConfirmSend] שגיאה:', e);
    const msg = (e && e.message) ? e.message : String(e);
    if (statusEl) statusEl.innerHTML = `<span style="color:#b3402c;">${esc(msg)}</span>`;
    else toast('שגיאה: ' + msg);
  } finally {
    // finally ולא רק בתוך ה-catch: מבטיח שהכפתור תמיד חוזר למצב רגיל,
    // גם אם ייפול חריג לא צפוי שלא נתפס במפורש למעלה.
    if (btn) bsdSetButtonLoading(btn, false);
  }
}

// 03.09.2026: ערוץ שליחה נוסף - WhatsApp - לצד המייל הקיים, לפי הנחיה
// מפורשת. פונקציה עצמאית לגמרי, לא נוגעת ב-sfConfirmSend/send-sale-files-to-buyer
// (מנגנון המייל שעובד) בשום צורה - אותו קונה/קבצים/טקסט שכבר נבחרו במסך,
// רק ערוץ פתיחה שונה.
//
// נורמליזציית טלפון מקומית (לא תלויה בטעינת js/waSendModule.js בדף
// המארח, כדי שהפונקציה לעולם לא תיפול עם ReferenceError בדף שלא טוען
// את זה) - אותה לוגיקה בדיוק כמו waNormalizePhone הקיים (0->972,
// תמיכה במספר שכבר מתחיל ב-972).
function sfNormalizePhoneForWa(phone){
  if (typeof waNormalizePhone === 'function') return waNormalizePhone(phone);
  if (!phone || !String(phone).trim()) return { valid:false, reason:'missing', e164:null };
  const d = String(phone).replace(/\D/g,'');
  if (!d) return { valid:false, reason:'missing', e164:null };
  if (d.startsWith('972')){
    const rest = d.slice(3);
    return rest.length === 9 ? { valid:true, reason:null, e164:d } : { valid:false, reason:'invalid', e164:null };
  }
  if (d.startsWith('0')){
    return (d.length === 9 || d.length === 10) ? { valid:true, reason:null, e164:'972' + d.slice(1) } : { valid:false, reason:'invalid', e164:null };
  }
  return { valid:false, reason:'invalid', e164:null };
}

// 03.09.2026: תיעוד אוטומטי במרכז ההתאמות - לפי הנחיה מפורשת. פונקציה
// עצמאית חדשה, לא נוגעת בשום קוד קיים - נקראת רק אחרי ששליחה (מייל או
// WhatsApp) כבר הצליחה בפועל. בודקת buyer_id+business_id (לא שמות) כדי
// למנוע כפילות, לפי אותו דפוס שכבר קיים בקוד (למשל confirmAddBuyerToMatch
// ב-businesses.html). אם קיימת התאמה - מעדכנת רק last_action/last_action_at
// (לא נוגעת בסטטוס/הערות/פגישות קיימים). אם לא - יוצרת התאמה חדשה עם
// סטטוס קיים ומתאים ("חומרים מלאים נשלחו"). כשל כאן לעולם לא מוצג
// כשגיאת שליחה - השליחה עצמה כבר הושלמה בהצלחה לפני הקריאה לפונקציה הזו.
async function sfDocumentMatchAfterSend(bizId, recipientId, fileIds, channelLabel, recipientType){
  recipientType = recipientType === 'broker' ? 'broker' : 'buyer';
  try {
    const allFiles = sfAllActiveFiles();
    const fileNames = fileIds.map(id => {
      const f = allFiles.find(x => x.id === id);
      return f ? f.file_name : null;
    }).filter(Boolean).join(', ');

    if (recipientType === 'broker'){
      // 03.09.2026 (מודול מתווכים, שלב 3): ענף מקביל לגמרי לענף הקונה
      // למטה - לא נוגע בו. כותב ל-broker_id/counterparty_type='broker'
      // (לא buyer_id), ומתעד גם ב-broker_document_log (מעקב עסקים
      // ומסמכים שהועברו - סעיף 5 בהנחיה הראשונה, אין מקבילה כזו לקונים).
      const broker = SF_SEND_BROKERS_CACHE ? SF_SEND_BROKERS_CACHE[recipientId] : null;
      const brokerName = broker ? (broker.full_name || [broker.first_name, broker.last_name].filter(Boolean).join(' ') || 'מתווך') : 'מתווך';
      const actionText = `נשלחו למתווך ${brokerName} קבצים: ${fileNames} (${channelLabel})`;
      const nowIso = new Date().toISOString();

      const { data: existing, error: findErr } = await window.supabaseClient
        .from('matches').select('id').eq('business_id', bizId).eq('broker_id', recipientId).maybeSingle();
      if (findErr) throw findErr;

      let matchId, action;
      if (existing){
        const { error: updErr } = await window.supabaseClient.from('matches')
          .update({ last_action: actionText, last_action_at: nowIso }).eq('id', existing.id);
        if (updErr) throw updErr;
        matchId = existing.id; action = 'updated';
      } else {
        const { data: newMatch, error: insErr } = await window.supabaseClient.from('matches').insert({
          business_id: bizId, broker_id: recipientId, counterparty_type: 'broker', status: 'חומרים מלאים נשלחו',
          match_source: `אוטומטי - נשלחו קבצים ב${channelLabel}`,
          last_action: actionText, last_action_at: nowIso,
          created_by: (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE ? CURRENT_PROFILE.id : null),
        }).select('id').single();
        if (insErr) throw insErr;
        matchId = newMatch?.id; action = 'created';
      }

      try {
        const channelKey = channelLabel === 'WhatsApp' ? 'whatsapp' : 'email';
        const docLogRows = fileIds.map(id => {
          const f = allFiles.find(x => x.id === id);
          return {
            broker_id: recipientId, business_id: bizId, match_id: matchId || null,
            file_id: id, file_name: f ? f.file_name : null, document_type: f ? (f.document_type || f.category || null) : null,
            channel: channelKey, sent_by: (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE ? CURRENT_PROFILE.id : null),
          };
        });
        await window.supabaseClient.from('broker_document_log').insert(docLogRows);
      } catch (logErr) {
        console.error('[sfDocumentMatchAfterSend] כשל בכתיבה ל-broker_document_log (לא חוסם - ההתאמה כבר תועדה):', logErr);
      }

      return { action };
    }

    const buyer = SF_SEND_BUYERS_CACHE ? SF_SEND_BUYERS_CACHE[recipientId] : null;
    const buyerName = buyer ? (buyer.full_name || [buyer.first_name, buyer.last_name].filter(Boolean).join(' ') || 'קונה') : 'קונה';
    const actionText = `נשלחו לקונה ${buyerName} קבצים: ${fileNames} (${channelLabel})`;
    const nowIso = new Date().toISOString();

    const { data: existing, error: findErr } = await window.supabaseClient
      .from('matches').select('id').eq('business_id', bizId).eq('buyer_id', recipientId).maybeSingle();
    if (findErr) throw findErr;

    if (existing){
      const { error: updErr } = await window.supabaseClient.from('matches')
        .update({ last_action: actionText, last_action_at: nowIso }).eq('id', existing.id);
      if (updErr) throw updErr;
      return { action: 'updated' };
    }
    const { error: insErr } = await window.supabaseClient.from('matches').insert({
      business_id: bizId, buyer_id: recipientId, status: 'חומרים מלאים נשלחו',
      match_source: `אוטומטי - נשלחו קבצים ב${channelLabel}`,
      last_action: actionText, last_action_at: nowIso,
      created_by: (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE ? CURRENT_PROFILE.id : null),
    });
    if (insErr) throw insErr;
    return { action: 'created' };
  } catch (e) {
    console.error('[sfDocumentMatchAfterSend] שגיאה (לא חוסמת - השליחה כבר בוצעה בהצלחה):', e);
    return { action: 'failed' };
  }
}

async function sfConfirmSendWhatsApp(bizId, recipientId, fileIds, recipientType){
  recipientType = recipientType === 'broker' ? 'broker' : 'buyer';
  const btn = document.getElementById('sfSendWaBtn');
  const statusEl = document.getElementById('sfSendStatus');
  const recipient = recipientType === 'broker'
    ? (SF_SEND_BROKERS_CACHE ? SF_SEND_BROKERS_CACHE[recipientId] : null)
    : (SF_SEND_BUYERS_CACHE ? SF_SEND_BUYERS_CACHE[recipientId] : null);
  if (!recipient){
    const who = recipientType === 'broker' ? 'המתווך' : 'הקונה';
    if (statusEl) statusEl.innerHTML = `<span style="color:#b3402c;">שגיאה: פרטי ${who} לא נטענו - סגור ופתח את המסך מחדש</span>`;
    return;
  }
  if (recipientType === 'broker' && recipient.status === 'חסום'){
    if (statusEl) statusEl.innerHTML = `<span style="color:#b3402c;">🚫 מתווך זה חסום - לא ניתן לשלוח אליו חומרים חדשים</span>`;
    return;
  }

  // בדיקת טלפון תקין - לפני הכל, לפני פתיחת שום חלון ולפני כל קריאת רשת
  const phoneCheck = sfNormalizePhoneForWa(recipient.phone);
  if (!phoneCheck.valid){
    const who = recipientType === 'broker' ? 'למתווך' : 'לקונה';
    const cardName = recipientType === 'broker' ? 'המתווך' : 'הקונה';
    const msg = phoneCheck.reason === 'missing'
      ? `${who} הזה אין מספר טלפון שמור - יש להוסיף אחד בכרטיס ${cardName} קודם`
      : `מספר הטלפון של ${cardName} אינו תקין ל-WhatsApp - יש לתקן אותו בכרטיס ${cardName}`;
    if (statusEl) statusEl.innerHTML = `<span style="color:#b3402c;">${esc(msg)}</span>`;
    else toast(msg);
    return;
  }

  // חלון ריק נפתח סינכרונית, בתוך אותו קליק - לפני כל await - כדי לא
  // להיחסם ע"י חוסם פופ-אבים בנייד (אותו באג שכבר נתקל בו ותוקן בעבר
  // באותה מסך בדיוק: חלון WhatsApp אחד ויחיד, נפתח מיד עם הלחיצה).
  const win = window.open('', '_blank');

  if (btn) bsdSetButtonLoading(btn, true, 'מכין...');
  try {
    const subjectEl = document.getElementById('sfPreviewSubject');
    const bodyEl = document.getElementById('sfPreviewBody');
    const introText = (bodyEl ? bodyEl.value : '') || (subjectEl ? subjectEl.value : '') || 'שלום,';

    console.log('[sfConfirmSendWhatsApp] קורא ל-get-sale-files-signed-links', { bizId, recipientId, recipientType, fileIds });
    const linkBody = { business_id: bizId, file_ids: fileIds, recipient_type: recipientType };
    if (recipientType === 'broker') linkBody.broker_id = recipientId; else linkBody.buyer_id = recipientId;
    const { data: linkResult, error: linkErr } = await sfWithClientTimeout(
      window.supabaseClient.functions.invoke('get-sale-files-signed-links', { body: linkBody }),
      25000, 'הכנת קישורים ל-WhatsApp'
    );
    console.log('[sfConfirmSendWhatsApp] תשובה התקבלה', { linkResult, linkErr });
    if (linkErr || linkResult?.error){
      let detail = linkResult?.error || linkErr?.message || 'שגיאה לא ידועה';
      if (linkErr && linkErr.context && typeof linkErr.context.json === 'function'){
        try { const b = await linkErr.context.json(); if (b?.error) detail = b.error; } catch(e2){}
      }
      throw new Error(detail);
    }
    const links = Array.isArray(linkResult?.links) ? linkResult.links : [];
    if (!links.length) throw new Error('לא נמצאו קבצים זמינים לשליחה');

    const messageText = introText + '\n\n' + links.map(l => `${l.name}:\n${l.url}`).join('\n\n');
    const waUrl = `https://wa.me/${phoneCheck.e164}?text=${encodeURIComponent(messageText)}`;
    if (win && !win.closed) { win.location.href = waUrl; } else { window.open(waUrl, '_blank'); }

    if (statusEl) statusEl.innerHTML = '<span style="color:#1f7a45;">✅ נפתחה שיחת WhatsApp עם הודעה מוכנה, כולל קישורי הורדה מאובטחים לקבצים שנבחרו. הלחיצה על Send בפועל היא בידיך בתוך WhatsApp.</span>';

    // 03.09.2026: תיעוד אוטומטי במרכז ההתאמות - תוספת בלבד, אחרי ששורת
    // ההצלחה למעלה כבר נקבעה. לא נוגע בשום דבר קודם בפונקציה הזו. נוסח
    // ההודעה למתווך תואם בדיוק את מה שנדרש במפורש בהנחיה; נוסח הקונה
    // נשאר בדיוק כפי שהיה.
    sfDocumentMatchAfterSend(bizId, recipientId, fileIds, 'WhatsApp', recipientType).then((matchResult) => {
      if (recipientType === 'broker'){
        if (matchResult.action === 'created') toast('ההתאמה החדשה נוצרה ותועדה.');
        else if (matchResult.action === 'updated') toast('השליחה נוספה להתאמה קיימת.');
      } else {
        if (matchResult.action === 'created') toast('השליחה בוצעה ונוצרה התאמה חדשה.');
        else if (matchResult.action === 'updated') toast('השליחה בוצעה והפעילות נוספה להתאמה הקיימת.');
      }
    });
  } catch(e){
    console.error('[sfConfirmSendWhatsApp] שגיאה:', e);
    const msg = (e && e.message) ? e.message : String(e);
    if (win && !win.closed){ try { win.close(); } catch(_e){} }
    if (statusEl) statusEl.innerHTML = `<span style="color:#b3402c;">${esc(msg)}</span>`;
    else toast('שגיאה: ' + msg);
  } finally {
    if (btn) bsdSetButtonLoading(btn, false);
  }
}

// ---------------------------------------------------------------
// שמירת PDF שנוצר אוטומטית ע"י מודול התקצירים (26.08.2026) - קטגוריה
// קיימת (exec_summary/"תקציר מנהלים"), בלי קטגוריה חדשה. גרסה חדשה בכל
// הפקה, אף פעם לא דורס קובץ קודם. מספר הגרסה מוקצה אטומית דרך
// allocate_sale_file_version() כדי שלא ייווצר מרוץ בין שתי הפקות
// מקבילות לאותו סוג מסמך.
// documentType: 'short_summary' | 'internal_full_summary'
// ---------------------------------------------------------------
async function saveAutoGeneratedSummaryPdf(bizId, documentType, blob, humanLabel){
  const { data: existing, error: findErr } = await window.supabaseClient
    .from('business_sale_files')
    .select('version_group_id')
    .eq('business_id', bizId)
    .eq('document_type', documentType)
    .eq('status', 'active')
    .order('version_number', { ascending: false })
    .limit(1);
  if (findErr) throw new Error('שגיאה באיתור גרסה קודמת: ' + findErr.message);

  const groupId = (existing && existing[0] && existing[0].version_group_id) || crypto.randomUUID();

  const { data: versionNum, error: verErr } = await window.supabaseClient.rpc('allocate_sale_file_version', { p_group_id: groupId });
  if (verErr) throw new Error('שגיאה בהקצאת מספר גרסה: ' + verErr.message);

  const fileName = `${humanLabel} - גרסה ${versionNum}.pdf`;
  const path = `${bizId}/sale-file/exec_summary/${Date.now()}_v${versionNum}.pdf`;

  const { error: upErr } = await window.supabaseClient.storage.from(SALE_FILE_BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: false });
  if (upErr) throw new Error('שגיאה בהעלאת הקובץ: ' + upErr.message);

  const { error: dbErr } = await window.supabaseClient.from('business_sale_files').insert({
    business_id: bizId,
    category: 'exec_summary',
    file_name: fileName,
    storage_path: path,
    file_type: 'application/pdf',
    file_size: blob.size,
    confidentiality_level: 2,
    uploaded_by: (window.CURRENT_PROFILE ? window.CURRENT_PROFILE.id : null),
    source: 'auto_generated',
    document_type: documentType,
    version_number: versionNum,
    version_group_id: groupId,
  });
  if (dbErr) throw new Error('שגיאה בשמירת רשומת הקובץ: ' + dbErr.message);

  await sfLogAudit(bizId, 'generate_summary_pdf', { document_type: documentType, version_number: versionNum });
  return { versionNum, path, fileName };
}
