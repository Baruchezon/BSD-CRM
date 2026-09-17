// BSD CRM - הגדרות חיבור ל-Supabase
// קובץ זה בטוח לחשיפה בדפדפן - אין בו סודות.
// אסור אף פעם להכניס לכאן service_role key או סיסמת בסיס נתונים.

window.BSD_CONFIG = {
  SUPABASE_URL: "https://zcdlegcvfirwzitfxjcs.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_baq54BVGwvtjB8c7ZiegCQ_tAXevwfN",
  STORAGE_BUCKET: "business-files",
  ORG_NAME: "BSD Business Brokers Israel",
  VIP_API_URL: "https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/vip-api"
};

// מטמון מהיר בין מסכי ה-CRM באותה לשונית דפדפן. הקוד אינו עוקף RLS ואינו
// משתף נתונים בין משתמשים: כל מפתח כולל את מזהה המשתמש, והמידע נשמר רק
// ב-sessionStorage שנמחק עם סגירת הלשונית. המסכים מציגים מיד את העותק
// האחרון לאורך ההתחברות הנוכחית. כל מסך טוען את הרשימה פעם אחת בלבד,
// ושינויים שנשמרים במסך מעדכנים את המטמון בלי טעינה חוזרת בכל מעבר.
window.BSDDataCache = window.BSDDataCache || (() => {
  const PREFIX = 'bsd_crm_page_cache_v2:';
  const MAX_AGE_MS = 12 * 60 * 60 * 1000;
  function key(scope, userId){ return PREFIX + String(userId || 'anonymous') + ':' + scope; }
  function get(scope, userId){
    try {
      const raw = sessionStorage.getItem(key(scope, userId));
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || !entry.savedAt || Date.now() - entry.savedAt > MAX_AGE_MS){
        sessionStorage.removeItem(key(scope, userId));
        return null;
      }
      return entry.value || null;
    } catch(e){ return null; }
  }
  function set(scope, userId, value){
    try {
      sessionStorage.setItem(key(scope, userId), JSON.stringify({ savedAt:Date.now(), value }));
      return true;
    } catch(e){
      // אם מכסת האחסון מלאה, מסירים רק מטמוני BSD ישנים ומנסים פעם נוספת.
      try {
        Object.keys(sessionStorage).filter(k => k.startsWith(PREFIX)).forEach(k => sessionStorage.removeItem(k));
        sessionStorage.setItem(key(scope, userId), JSON.stringify({ savedAt:Date.now(), value }));
        return true;
      } catch(ignore){ return false; }
    }
  }
  function remove(scope, userId){
    try { sessionStorage.removeItem(key(scope, userId)); } catch(e){}
  }
  return { get, set, remove };
})();

// 15.09.2026: רשת ביטחון ממוקדת להעלאת הסכמים חתומים.
// ההעלאה המקורית ב-auth.js נשארת ללא שינוי לכל שאר קבצי המערכת.
// רק נתיבים תחת agreements/ מקבלים מסלול עמיד יותר:
// 1. רענון session כשצריך, 2. ניסיון דרך כתובת Storage הישירה,
// 3. fallback דרך ה-SDK הרשמי והכתובת הכללית של הפרויקט.
// כך כשל רשת, CORS, timeout או שינוי התנהגות באחד הנתיבים לא משאיר
// את המשתמש אחרי בחירת PDF בלי קובץ ובלי מסלול חלופי.
(function installAgreementUploadRecovery(){
  let waitCount = 0;

  function install(){
    if (!window.supabaseClient || typeof window.bsdUploadFile !== 'function'){
      if (waitCount++ < 240) setTimeout(install, 50);
      return;
    }
    if (window.bsdUploadFile.__bsdAgreementRecovery) return;

    const originalUpload = window.bsdUploadFile;

    async function getFreshAccessToken(forceRefresh){
      try {
        let data, error;
        if (forceRefresh){
          ({ data, error } = await window.supabaseClient.auth.refreshSession());
        } else {
          ({ data, error } = await window.supabaseClient.auth.getSession());
        }
        if (error) return null;
        let session = data && data.session;
        if (!forceRefresh && session && session.expires_at && (session.expires_at * 1000 - Date.now()) < 90000){
          const refreshed = await window.supabaseClient.auth.refreshSession();
          if (!refreshed.error && refreshed.data && refreshed.data.session) session = refreshed.data.session;
        }
        return session && session.access_token ? session.access_token : null;
      } catch(e){
        return null;
      }
    }

    function directStorageUrl(bucket, path){
      const match = String(window.BSD_CONFIG.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
      const host = match ? `https://${match[1]}.storage.supabase.co` : window.BSD_CONFIG.SUPABASE_URL;
      return `${host}/storage/v1/object/${bucket}/${path}`;
    }

    function xhrUpload(url, bucket, path, file, opts, accessToken, timeoutMs){
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('apikey', window.BSD_CONFIG.SUPABASE_PUBLISHABLE_KEY);
        xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
        xhr.setRequestHeader('Content-Type', opts.contentType || file.type || 'application/octet-stream');
        xhr.setRequestHeader('x-upsert', opts.upsert ? 'true' : 'false');
        xhr.timeout = timeoutMs;

        xhr.upload.onprogress = function(e){
          if (opts.onProgress && e.lengthComputable) opts.onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = function(){
          if (xhr.status >= 200 && xhr.status < 300){
            resolve({ ok:true, status:xhr.status, error:null });
            return;
          }
          let serverMsg = xhr.responseText || '';
          try {
            const parsed = JSON.parse(xhr.responseText || '{}');
            serverMsg = parsed.message || parsed.error || serverMsg;
          } catch(e){}
          resolve({
            ok:false,
            status:xhr.status,
            error:{ name:'StorageApiError', message:`שגיאת שרת (${xhr.status}): ${serverMsg || 'העלאת הקובץ נכשלה'}` }
          });
        };
        xhr.onerror = function(){
          resolve({ ok:false, status:0, error:{ name:'StorageNetworkError', message:'כשל תקשורת בזמן העלאת ההסכם' } });
        };
        xhr.ontimeout = function(){
          resolve({ ok:false, status:0, error:{ name:'StorageTimeout', message:'העלאת ההסכם ארכה זמן רב מדי ונעצרה' } });
        };
        try {
          xhr.send(file);
        } catch(e){
          resolve({ ok:false, status:0, error:{ name:e.name || 'StorageUploadError', message:e.message || 'שגיאה בשליחת הקובץ' } });
        }
      });
    }

    async function agreementUpload(bucket, path, file, opts){
      opts = opts || {};
      if (!String(path || '').startsWith('agreements/')){
        return originalUpload(bucket, path, file, opts);
      }

      const sizeMB = (file && file.size ? file.size : 0) / (1024 * 1024);
      const timeoutMs = Math.max(45000, Math.ceil(sizeMB * 30000));
      let token = await getFreshAccessToken(false);
      if (!token){
        token = await getFreshAccessToken(true);
      }
      if (!token){
        return { data:null, error:{ name:'AuthSessionMissing', message:'ההתחברות פגה. יש להתחבר מחדש למערכת' } };
      }

      let firstResult = await xhrUpload(directStorageUrl(bucket, path), bucket, path, file, opts, token, timeoutMs);
      if (firstResult.ok){
        if (opts.onProgress) opts.onProgress(100);
        return { data:{ path }, error:null };
      }

      if (firstResult.status === 401){
        const refreshedToken = await getFreshAccessToken(true);
        if (refreshedToken) token = refreshedToken;
      }

      try {
        if (opts.onProgress) opts.onProgress(0);
        const sdkResult = await window.supabaseClient.storage
          .from(bucket)
          .upload(path, file, {
            upsert: !!opts.upsert,
            contentType: opts.contentType || file.type || 'application/octet-stream'
          });
        if (!sdkResult.error){
          if (opts.onProgress) opts.onProgress(100);
          return { data: sdkResult.data || { path }, error:null };
        }
        console.error('[agreement-upload] direct path failed, SDK fallback failed', {
          directError: firstResult.error,
          sdkError: sdkResult.error,
          bucket,
          path,
          fileSize: file && file.size
        });
        return { data:null, error:sdkResult.error };
      } catch(e){
        console.error('[agreement-upload] fallback threw', e, firstResult.error);
        return { data:null, error:{ name:e.name || 'StorageUploadError', message:e.message || (firstResult.error && firstResult.error.message) || 'העלאת ההסכם נכשלה' } };
      }
    }

    agreementUpload.__bsdAgreementRecovery = true;
    window.bsdUploadFile = agreementUpload;
  }

  setTimeout(install, 0);
})();

// 17.09.2026: מודול לקוחות VIP נטען רק במסכי קונים ועסקים.
(function loadVipCrmIntegration(){
  try {
    const page = (location.pathname.split('/').pop() || '').toLowerCase();
    if (page !== 'leads.html' && page !== 'businesses.html') return;
    const script = document.createElement('script');
    script.src = 'js/vip-crm-integration.js?v=20260917-5';
    script.defer = true;
    script.dataset.bsdVipModule = '1';
    document.head.appendChild(script);
  } catch(e) {
    console.warn('[BSD VIP] integration loader skipped', e);
  }
})();

// 17.09.2026: קיצור דרך קבוע לניהול לקוחות VIP בתוך תפריט "כלים".
// התפריט navToolsWrap כבר מוסתר ע"י auth.js לכל מי שאינו admin/manager,
// לכן הקישור נחשף רק למנהלים בלי לשנות הרשאות קיימות.
(function installVipAdminMenuLink(){
  function install(){
    try {
      const toolsWrap = document.getElementById('navToolsWrap');
      if (!toolsWrap || toolsWrap.querySelector('[data-vip-admin-link]')) return false;
      const menu = toolsWrap.querySelector('.bsd-forms-menu');
      if (!menu) return false;
      const link = document.createElement('a');
      const currentScreen = (location.pathname.split('/').pop() || 'app.html') + location.search;
      link.href = 'vip-admin.html?return=' + encodeURIComponent(currentScreen);
      link.dataset.vipAdminLink = '1';
      link.textContent = '⭐ ניהול לקוחות VIP';
      link.style.cssText = 'display:block;color:#f1d98d;text-decoration:none;padding:11px 16px;font-size:.85rem;font-weight:800;border-top:1px solid rgba(255,255,255,.08);';
      menu.insertBefore(link, menu.firstChild);
      return true;
    } catch(e){
      console.warn('[BSD VIP] menu shortcut skipped', e);
      return false;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();

// 17.09.2026: תיקוני מלל ותצוגה ממוקדים למודול VIP בלבד.
(function loadVipUiFixes(){
  try {
    const page = (location.pathname.split('/').pop() || '').toLowerCase();
    if (page !== 'leads.html' && page !== 'businesses.html') return;
    const script = document.createElement('script');
    script.src = 'js/vip-ui-fixes.js?v=20260917-2';
    script.defer = true;
    script.dataset.bsdVipUiFixes = '1';
    document.head.appendChild(script);
  } catch(e) {
    console.warn('[BSD VIP] UI refinements skipped', e);
  }
})();
