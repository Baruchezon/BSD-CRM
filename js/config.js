// BSD CRM - הגדרות חיבור ל-Supabase
// קובץ זה בטוח לחשיפה בדפדפן - אין בו סודות.
// אסור אף פעם להכניס לכאן service_role key או סיסמת בסיס נתונים.

window.BSD_CONFIG = {
  SUPABASE_URL: "https://zcdlegcvfirwzitfxjcs.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_baq54BVGwvtjB8c7ZiegCQ_tAXevwfN",
  STORAGE_BUCKET: "business-files",
  ORG_NAME: "BSD Business Brokers Israel"
};

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

      // אם השרת החזיר 401, מרעננים token לפני מסלול הגיבוי.
      if (firstResult.status === 401){
        const refreshedToken = await getFreshAccessToken(true);
        if (refreshedToken) token = refreshedToken;
      }

      // fallback דרך supabase-js. הוא משתמש בכתובת הפרויקט הרגילה ומנהל
      // את מנגנון האימות בעצמו, ולכן הוא עוקף כשל נקודתי של ה-host הישיר.
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
