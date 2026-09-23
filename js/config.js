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

// A small profile cache removes the only mandatory server round-trip that used
// to run again on every page transition.  The database remains the authority:
// RLS still protects every read/write and the cached profile is refreshed in
// the background.  A short stale grace period lets an already authenticated
// user reach the CRM during a temporary mobile-network failure instead of
// replacing the whole screen with an error page.
window.BSDSessionCache = (() => {
  const KEY = 'bsd-crm-profile-v2';
  const MAX_STALE_MS = 36 * 60 * 60 * 1000;
  function read(session){
    if (!session || !session.user) return null;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!saved || saved.userId !== session.user.id || !saved.profile) return null;
      if (Date.now() - Number(saved.savedAt || 0) > MAX_STALE_MS) return null;
      if (saved.profile.status === 'blocked') return null;
      return JSON.parse(JSON.stringify(saved.profile));
    } catch (_) { return null; }
  }
  function write(session, profile){
    if (!session || !session.user || !profile) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ userId:session.user.id, savedAt:Date.now(), profile }));
    } catch (_) {}
  }
  function clear(){ try { localStorage.removeItem(KEY); } catch (_) {} }
  return { read, write, clear };
})();

window.bsdDeadline = async function bsdDeadline(promise, timeoutMs, label){
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error((label || 'הפעולה') + ' לא הושלמה בזמן')), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
};

// Private Storage files are opened through one resilient path everywhere in
// the CRM.  It refreshes an expired session, retries once, and finally falls
// back to an authenticated blob download.  Android uses the current tab when
// a new tab is blocked, which fixes the common "nothing happens" PDF symptom.
window.bsdOpenPrivateFile = async function bsdOpenPrivateFile(options){
  const bucket = options && options.bucket;
  const path = options && options.path;
  const downloadName = options && options.downloadName;
  const label = (options && options.label) || 'הקובץ';
  if (!bucket || !path) throw new Error('חסר נתיב לקובץ');

  const isAndroid = /Android/i.test(navigator.userAgent || '');
  let target = null;
  if (!isAndroid){
    target = window.open('about:blank', '_blank');
    if (target){
      try {
        target.document.title = 'BSD CRM';
        target.document.body.innerHTML = '<div dir="rtl" style="font-family:Arial,sans-serif;padding:30px;text-align:center;color:#0e1b34">מכין את הקובץ...</div>';
      } catch (_) {}
    }
  }
  const notify = message => {
    if (typeof window.toast === 'function') window.toast(message);
  };

  async function signedUrl(){
    const download = downloadName ? { download: downloadName } : undefined;
    const request = window.supabaseClient.storage.from(bucket).createSignedUrl(path, 30 * 60, download);
    const result = await window.bsdDeadline(request, 10000, 'יצירת קישור מאובטח');
    if (result.error || !result.data || !result.data.signedUrl) throw result.error || new Error('לא התקבל קישור לקובץ');
    return result.data.signedUrl;
  }

  async function refreshSession(){
    try { await window.bsdDeadline(window.supabaseClient.auth.refreshSession(), 8000, 'רענון ההתחברות'); }
    catch (_) {}
  }

  let url = null, lastError = null, objectUrl = null;
  for (let attempt = 0; attempt < 2 && !url; attempt++){
    try { url = await signedUrl(); }
    catch (error) {
      lastError = error;
      if (attempt === 0) await refreshSession();
    }
  }

  if (!url){
    try {
      const result = await window.bsdDeadline(window.supabaseClient.storage.from(bucket).download(path), 30000, 'הורדת הקובץ');
      if (result.error || !result.data) throw result.error || new Error('הקובץ לא התקבל');
      objectUrl = URL.createObjectURL(result.data);
      url = objectUrl;
    } catch (error) { lastError = error; }
  }

  if (!url){
    if (target) try { target.close(); } catch (_) {}
    notify('שגיאה בפתיחת ' + label + ': ' + ((lastError && lastError.message) || 'שגיאת תקשורת'));
    return false;
  }

  if (target && !target.closed){
    try { target.location.replace(url); }
    catch (_) { window.location.assign(url); }
  } else {
    window.location.assign(url);
  }
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);
  return true;
};

// Daily, authenticated-session cache shared by the business, buyer and lead screens.
// IndexedDB avoids evicting one large list to make room for the other.
window.BSDDataCache = (() => {
  const DB_NAME = 'bsd-crm-daily-v1';
  const scopes = ['app-page', 'businesses-page', 'leads-page', 'matches-page', 'rows:businesses', 'rows:leads'];
  let context = null, memory = new Map(), pending = new Map(), revisions = new Map(), dbPromise;
  let persistence = Promise.resolve();
  const day = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Jerusalem', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const clone = value => JSON.parse(JSON.stringify(value));
  function database(){
    if (!dbPromise) dbPromise = new Promise(resolve => {
      let settled = false;
      const finish = value => { if (settled) { if (value) value.close(); return; } settled = true; clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => finish(null), 1000);
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('cache');
        request.onsuccess = () => finish(request.result);
        request.onerror = request.onblocked = () => finish(null);
      } catch (_) { finish(null); }
    });
    return dbPromise;
  }
  async function disk(op, key, value){
    const db = await database();
    if (!db){
      try {
        const k = DB_NAME + ':' + key;
        if (op === 'get') return JSON.parse(sessionStorage.getItem(k) || 'null');
        if (op === 'put') sessionStorage.setItem(k, JSON.stringify(value));
        else sessionStorage.removeItem(k);
      } catch (_) {}
      return null;
    }
    return new Promise(resolve => {
      let tx, settled = false;
      const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => { finish(null); try { tx?.abort(); } catch (_) {} }, 1000);
      try {
        tx = db.transaction('cache', op === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('cache');
        const req = op === 'get' ? store.get(key) : op === 'put' ? store.put(value, key) : store.delete(key);
        let result = null;
        req.onsuccess = () => { result = req.result ?? null; };
        tx.oncomplete = () => finish(result);
        tx.onerror = tx.onabort = () => finish(null);
      } catch (_) { finish(null); }
    });
  }
  function generation(){ try { return localStorage.getItem(DB_NAME + ':generation') || '0'; } catch (_) { return '0'; } }
  function valid(userId){ return context && context.userId === userId && context.day === day() && context.generation === generation(); }
  async function activate(session, profile){
    const userId = session.user.id;
    // Namespace only: JWT decoding here is not an authentication or authorization check.
    let sessionId = session.user.last_sign_in_at || 'session';
    try { sessionId = JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id || sessionId; } catch (_) {}
    const permissions = JSON.stringify(Object.fromEntries(Object.entries(profile).filter(([k]) => k === 'role' || k === 'status' || k.startsWith('can_')).sort()));
    const next = { userId, day:day(), generation:generation(), sessionId, permissions };
    next.key = JSON.stringify(next);
    if (context?.key === next.key) return;
    context = next; memory = new Map(); pending = new Map();
    await persistence;
    await Promise.all(scopes.map(async scope => {
      const entry = await disk('get', scope);
      if (context === next && entry?.key === next.key) memory.set(scope, entry.value);
    }));
  }
  function get(scope, userId){ return valid(userId) && memory.has(scope) ? clone(memory.get(scope)) : null; }
  function set(scope, userId, value){
    if (!valid(userId)) return false;
    const copy = clone(value), key = context.key;
    memory.set(scope, copy);
    persistence = persistence.then(() => disk('put', scope, { key, value:copy }));
    return true;
  }
  function remove(scope, userId){
    if (!context || context.userId !== userId) return;
    memory.delete(scope);
    persistence = persistence.then(() => disk('delete', scope));
  }
  function reset(){
    try { localStorage.setItem(DB_NAME + ':generation', Date.now() + ':' + Math.random()); } catch (_) {}
    context = null; memory.clear(); pending.clear();
    for (const scope of scopes) persistence = persistence.then(() => disk('delete', scope));
  }
  async function readWithDeadline(query, timeoutMs=65000){
    let timer;
    try {
      return await Promise.race([
        Promise.resolve(query),
        new Promise(resolve => { timer = setTimeout(() => resolve({ data:null, error:{message:'השרת לא השיב בזמן. אפשר לנסות שוב.'} }), timeoutMs); })
      ]);
    } catch (error) { return { data:null, error:{message:error.message || 'שגיאת תקשורת'} }; }
    finally { clearTimeout(timer); }
  }
  async function rows(table, userId, options={}){
    if (!['businesses','leads'].includes(table)) throw new Error('Unsupported daily dataset');
    if (context && !valid(userId)) {
      const { data } = await window.supabaseClient.auth.getSession();
      if (!data.session || data.session.user.id !== userId) return { data:null, error:{message:'נדרשת כניסה מחדש'} };
      await activate(data.session, JSON.parse(context.permissions));
    }
    const cached = get('rows:' + table, userId);
    // Page snapshots are only a fast first paint. A caller can explicitly
    // revalidate against Supabase so an empty or incomplete daily cache can
    // never become the final answer for the rest of the day.
    if (cached && !options.forceRefresh) return { data:cached, error:null };
    if (pending.has(table)) return clone(await pending.get(table));
    const active = context, revision = revisions.get(table) || 0;
    const request = (async () => {
      // Paginate: a once-per-day cache must not silently retain only PostgREST's first 1000 rows.
      const all = [];
      for (let start = 0; ; start += 1000){
        // Production mobile logs showed valid authenticated list reads taking
        // up to 48 seconds. Do not abandon a successful request after 15
        // seconds and turn real records into an empty table.
        const result = await readWithDeadline(window.supabaseClient.from(table).select('*').order('id').range(start, start + 999));
        if (result.error) return result;
        all.push(...(result.data || []));
        if ((result.data || []).length < 1000) break;
      }
      all.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
      if (context === active && (revisions.get(table) || 0) === revision) set('rows:' + table, userId, all);
      // Rendering must not wait for the optional disk cache to finish writing.
      return { data:all, error:null };
    })();
    pending.set(table, request);
    try { return clone(await request); } finally { if (pending.get(table) === request) pending.delete(table); }
  }
  async function changed(table, id, deleted){
    if (!context) return;
    const active = context, userId = context.userId;
    revisions.set(table, (revisions.get(table) || 0) + 1);
    remove('app-page', userId); remove('businesses-page', userId); remove('leads-page', userId); remove('matches-page', userId);
    // Read back just the affected row. Verification reads always go to the server.
    if (['businesses','leads'].includes(table)){
      const cached = get('rows:' + table, userId);
      if (id && cached){
        const result = deleted ? {data:null} : await window.supabaseClient.from(table).select('*').eq('id', id).maybeSingle();
        if (context !== active) return;
        if (!result.error){
          const next = cached.filter(row => row.id !== id);
          if (result.data) next.unshift(result.data);
          set('rows:' + table, userId, next);
        } else remove('rows:' + table, userId);
      } else remove('rows:' + table, userId);
    } else if (table === 'rpc'){
      remove('rows:businesses', userId); remove('rows:leads', userId);
    }
    await persistence;
  }
  function observeWrites(client){
    if (client.__bsdDailyObserved) return;
    client.__bsdDailyObserved = true;
    const originalFrom = client.from.bind(client);
    const watched = new Set(['businesses','leads','matches','tasks','profiles','activity_log','match_activity_log','record_notes','business_file_meta','business_sale_files','business_access_grants','brokers','buyer_rating_levels']);
    client.from = table => {
      const state = { mutation:false, id:null, deleted:false };
      function wrap(builder){ return new Proxy(builder, { get(target, prop){
        if (prop === 'then') return (resolve, reject) => target.then(async result => {
          if (state.mutation && !result.error){
            const data = Array.isArray(result.data) ? (result.data.length === 1 ? result.data[0] : null) : result.data;
            await changed(table, state.id || data?.id, state.deleted);
          }
          return result;
        }).then(resolve, reject);
        const member = target[prop];
        if (typeof member !== 'function') return member;
        return (...args) => {
          if (['insert','upsert','update','delete'].includes(prop)){ state.mutation = true; state.deleted = prop === 'delete'; }
          if (prop === 'eq' && args[0] === 'id') state.id = args[1];
          const result = member.apply(target,args);
          return result && typeof result === 'object' ? wrap(result) : result;
        };
      }}); }
      const builder = originalFrom(table);
      return watched.has(table) ? wrap(builder) : builder;
    };
    const rpc = client.rpc.bind(client);
    client.rpc = (name, ...args) => {
      const request = rpc(name, ...args);
      if (!/^(save_|update_|delete_|restore_|archive_|assign_|convert_)/.test(name)) return request;
      return new Proxy(request, { get(target, prop){
        if (prop === 'then') return (resolve,reject) => target.then(async result => { if (!result.error) await changed('rpc'); return result; }).then(resolve,reject);
        return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
      }});
    };
  }
  return { activate, get, set, remove, reset, rows, observeWrites, flush:() => persistence };
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
    script.src = 'js/vip-crm-integration.js?v=20260917-6';
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
