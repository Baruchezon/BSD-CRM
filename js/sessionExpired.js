// BSD CRM - התחברות שפגה בזמן עבודה (07.10.2026, אושר ע"י ברוך)
// ----------------------------------------------------------------------------
// רקע: ב-06.10 רענון ההתחברות בטלפון נכשל (400), supabase-js מחק את ה-session,
// ושמירת משימה נשלחה בלי משתמש (401) שלוש פעמים - והמסך לא הראה כלום.
// כאן מנגנון אחד משותף:
//   1. בדיקת session לפני כתיבה, וזיהוי "התחברות פגה" אחרי שגיאה
//      (401 / PGRST301-303 / JWT expired / invalid JWT / refresh token / «לא מחובר»).
//   2. רענון שקט אחד (refreshSession) וניסיון חוזר אחד.
//   3. אם עדיין פג: הודעה עליונה לא חוסמת «ההתחברות פגה, התחבר מחדש» עם קישור
//      למסך הכניסה (בלשונית חדשה). החלון נשאר פתוח והטקסט במקומו.
//   4. טיוטה ב-localStorage (לפי מסך+רשומה+משתמש) שמשוחזרת לאותם שדות, ונמחקת
//      אחרי שמירה מוצלחת.
//   5. כניסה מחדש בלשונית אחרת - הלשונית הזו מזהה את ה-session החדש ושמירה חוזרת
//      עובדת בלי רענון דף.
// לא משנה התנתקות (bsdLogout/bsdFullLogout), לא את הניתוק אחרי 30 דק', ולא נתונים.
// ----------------------------------------------------------------------------
(function(){
  'use strict';
  var MESSAGE = 'ההתחברות פגה, התחבר מחדש';
  var DRAFT_PREFIX = 'bsd-draft:v1:';
  var DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var LOGIN_URL = 'login.html';

  function lower(v){ return v === undefined || v === null ? '' : String(v).toLowerCase(); }

  // ---------------------------------------------------------------- detection
  // Accepts a supabase result ({data,error,status}), an error object (PostgrestError,
  // AuthError, FunctionsHttpError with .context Response), a fetch Response, or an Error.
  function isAuthExpiredError(x, depth){
    depth = depth || 0;
    if (!x || depth > 3) return false;
    if (typeof x === 'string') return isAuthExpiredError({ message: x }, depth + 1);
    if (typeof x !== 'object') return false;
    if (x.bsdAuthExpired || x.authExpired) return true;
    var status = Number(x.status !== undefined ? x.status : x.statusCode);
    if (status === 401) return true;
    if (x.context && typeof x.context === 'object' && Number(x.context.status) === 401) return true;
    if (x.error && typeof x.error === 'object' && x.error !== x && isAuthExpiredError(x.error, depth + 1)) return true;
    var code = lower(x.code !== undefined && x.code !== null ? x.code : x.error_code);
    if (/^pgrst30[123]$/.test(code)) return true;                 // PostgREST JWT invalid / anon disabled / expired
    if (/^unauthorized_/.test(code)) return true;                  // edge gateway: UNAUTHORIZED_INVALID_JWT_FORMAT ...
    if (['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','bad_jwt','no_authorization'].indexOf(code) >= 0) return true;
    var name = String(x.name || '');
    if (name === 'AuthSessionMissingError' || name === 'AuthInvalidTokenResponseError') return true;
    var msg = [x.message, x.msg, x.error_description, typeof x.error === 'string' ? x.error : ''].map(lower).join(' ');
    return /jwt expired|invalid jwt|jwt (is )?malformed|jwt could not be decoded|invalid refresh token|refresh token not found|auth session missing|session (has )?expired|session not found|not authenticated|לא מחובר|ההתחברות פגה/.test(msg);
  }

  function client(){ return window.supabaseClient; }
  function deadline(promise, ms){
    var timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise(function(_, reject){ timer = setTimeout(function(){ reject(new Error('timeout')); }, ms); })
    ]).then(function(v){ clearTimeout(timer); return v; }, function(e){ clearTimeout(timer); throw e; });
  }
  function isNetworkError(e){
    if (!e) return false;
    return String(e.name || '') === 'AuthRetryableFetchError' || /failed to fetch|network|timeout|load failed/i.test(String(e.message || ''));
  }

  async function currentToken(){
    var c = client();
    if (!c || !c.auth || typeof c.auth.getSession !== 'function') return { state: 'unknown', token: null };
    try {
      var res = await deadline(c.auth.getSession(), 6000);
      var s = res && res.data && res.data.session;
      if (s && s.access_token) return { state: 'ok', token: s.access_token };
      if (res && res.error && isNetworkError(res.error)) return { state: 'unknown', token: null };
      return { state: 'none', token: null };
    } catch (e) { return { state: 'unknown', token: null }; }
  }
  // 'ok' | 'none' | 'unknown' (network trouble - never reported as "expired")
  async function sessionState(){ return (await currentToken()).state; }

  // One silent refresh. Also succeeds when another tab already logged in again
  // (the new session is in localStorage and getSession() picks it up). A failed
  // refresh that leaves the same rejected token in place does not count.
  async function tryRefresh(){
    var c = client();
    if (!c || !c.auth) return false;
    var before = (await currentToken()).token;
    try {
      if (typeof c.auth.refreshSession === 'function'){
        var r = await deadline(c.auth.refreshSession(), 8000);
        if (r && r.data && r.data.session && r.data.session.access_token) return true;
      }
    } catch (_) {}
    var after = await currentToken();
    return after.state === 'ok' && after.token !== before;
  }

  async function looksExpired(result){
    if (!result || !result.error) return false;
    if (isAuthExpiredError(result)) return true;
    return (await sessionState()) === 'none';
  }

  async function attempt(op){
    try {
      var r = await op();
      return r && typeof r === 'object' ? r : { data: r, error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  function expiredError(cause){
    var e = new Error(MESSAGE);
    e.name = 'BsdAuthExpired';
    e.bsdAuthExpired = true;
    e.status = 401;
    if (cause) e.cause = cause;
    return e;
  }

  // run(op, opts): op() must return a supabase-style result ({data, error, status}).
  // Returns the op's result, or {data:null, error:<Error MESSAGE>, status:401, authExpired:true}
  // after: preflight session check -> op -> (expired?) one refresh -> one retry -> banner.
  async function run(op, opts){
    opts = opts || {};
    var pre = await sessionState();
    if (pre === 'none' && !(await tryRefresh())) return expired(null, opts);
    var r = await attempt(op);
    if (!(await looksExpired(r))) return r;
    if (await tryRefresh()){
      r = await attempt(op);
      if (!(await looksExpired(r))) return r;
    }
    return expired(r, opts);
  }
  function expired(r, opts){
    var cause = r && r.error;
    try { if (typeof opts.onExpired === 'function') opts.onExpired(cause); } catch (e) { console.warn('[BSDSession] onExpired', e); }
    if (!opts.silent) showExpired(opts);
    console.warn('[BSDSession] session expired', cause || '(no session before the request)');
    return { data: null, error: expiredError(cause), status: 401, authExpired: true };
  }

  // supabase.functions.invoke with the same protection. Throws nothing; returns {data, error}.
  function invoke(name, options, opts){
    return run(function(){ return client().functions.invoke(name, options); }, opts);
  }

  // ---------------------------------------------------------------- banner
  var watching = false, regainTimer = null;
  function bannerEl(){
    var el = document.getElementById('bsdSessionBanner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'bsdSessionBanner';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    el.dir = 'rtl';
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483000;' +
      'width:max-content;max-width:calc(100vw - 24px);box-sizing:border-box;padding:12px 16px 12px 44px;border-radius:12px;' +
      'font-family:Heebo,Rubik,Arial,sans-serif;font-size:16px;line-height:1.5;box-shadow:0 10px 30px rgba(0,0,0,.35);text-align:right;';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }
  function paint(el, kind, html){
    var colors = kind === 'ok' ? ['#1e6b3a', '#fff'] : kind === 'info' ? ['#0e1b34', '#fff'] : ['#b00020', '#fff'];
    el.style.background = colors[0];
    el.style.color = colors[1];
    el.dataset.kind = kind;
    el.innerHTML = html + '<button type="button" aria-label="סגירת ההודעה" style="position:absolute;top:8px;left:10px;background:none;border:none;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;">×</button>';
    el.lastChild.addEventListener('click', hideBanner);
    el.style.display = 'block';
  }
  function showExpired(opts){
    opts = opts || {};
    var el = bannerEl();
    var sub = opts.detail || 'הטקסט שהקלדת נשמר ולא יאבד. אחרי הכניסה לחץ שוב על «שמירה».';
    paint(el, 'expired',
      '<div style="font-weight:800;">⚠️ ההתחברות פגה, <a href="' + LOGIN_URL + '" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline;font-weight:800;">התחבר מחדש</a></div>' +
      '<div style="font-size:14px;opacity:.95;margin-top:2px;">' + escapeHtml(sub) + '</div>');
    clearTimeout(regainTimer);
    watchForRegain();
  }
  function showNotice(text, kind, ms){
    var el = bannerEl();
    paint(el, kind || 'info', '<div style="font-weight:700;">' + escapeHtml(text) + '</div>');
    clearTimeout(regainTimer);
    if (ms) regainTimer = setTimeout(hideBanner, ms);
  }
  function hideBanner(){
    var el = document.getElementById('bsdSessionBanner');
    if (el) el.style.display = 'none';
  }
  function bannerKind(){
    var el = document.getElementById('bsdSessionBanner');
    return el && el.style.display !== 'none' ? el.dataset.kind : null;
  }
  function onRegained(){
    if (bannerKind() !== 'expired') return;
    showNotice('✓ התחברת מחדש. אפשר ללחוץ שוב על «שמירה».', 'ok', 8000);
  }
  async function checkRegained(){
    if (bannerKind() !== 'expired') return;
    if ((await sessionState()) === 'ok') onRegained();
  }
  function watchForRegain(){
    if (watching) return;
    watching = true;
    try {
      var c = client();
      if (c && c.auth && typeof c.auth.onAuthStateChange === 'function'){
        // Another tab's login reaches this tab through supabase-js' BroadcastChannel.
        c.auth.onAuthStateChange(function(event, session){
          if (session && session.access_token && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) setTimeout(onRegained, 0);
        });
      }
    } catch (_) {}
    window.addEventListener('storage', function(e){
      if (e && e.key && /^sb-.*-auth-token$/.test(e.key) && e.newValue) setTimeout(checkRegained, 0);
    });
    window.addEventListener('focus', function(){ setTimeout(checkRegained, 0); });
    document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible') setTimeout(checkRegained, 0); });
  }

  function escapeHtml(s){
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
  }

  // ---------------------------------------------------------------- drafts
  function storage(){ try { return window.localStorage; } catch (_) { return null; } }
  function saveDraft(key, fields, userId, meta){
    var ls = storage(); if (!ls || !key || !fields) return false;
    var hasText = Object.keys(fields).some(function(k){ return fields[k] !== null && fields[k] !== undefined && String(fields[k]).trim() !== ''; });
    if (!hasText) return false;
    try {
      ls.setItem(DRAFT_PREFIX + key, JSON.stringify({ savedAt: Date.now(), userId: userId || null, fields: fields, meta: meta || null }));
      return true;
    } catch (_) { return false; }
  }
  function readDraft(key, userId){
    var ls = storage(); if (!ls || !key) return null;
    var d = null;
    try { d = JSON.parse(ls.getItem(DRAFT_PREFIX + key) || 'null'); } catch (_) { d = null; }
    if (!d || !d.fields) return null;
    if (Date.now() - Number(d.savedAt || 0) > DRAFT_TTL_MS){ clearDraft(key); return null; }
    if (d.userId && userId && d.userId !== userId) return null; // never show one user's draft to another
    return d;
  }
  function clearDraft(key){ var ls = storage(); if (ls && key) try { ls.removeItem(DRAFT_PREFIX + key); } catch (_) {} }
  function listDrafts(prefix, userId){
    var ls = storage(); if (!ls) return [];
    var out = [];
    for (var i = 0; i < ls.length; i++){
      var k = ls.key(i);
      if (!k || k.indexOf(DRAFT_PREFIX + prefix) !== 0) continue;
      var key = k.slice(DRAFT_PREFIX.length);
      var d = readDraft(key, userId);
      if (d) out.push({ key: key, draft: d });
    }
    return out;
  }
  function collectFields(ids){
    var out = {};
    (ids || []).forEach(function(id){ var el = document.getElementById(id); if (el && 'value' in el) out[id] = el.value; });
    return out;
  }
  function applyFields(fields){
    var n = 0;
    Object.keys(fields || {}).forEach(function(id){
      var el = document.getElementById(id);
      if (!el || !('value' in el) || fields[id] === null || fields[id] === undefined) return;
      el.value = fields[id];
      n++;
    });
    return n;
  }

  window.BSDSession = {
    MESSAGE: MESSAGE,
    isAuthExpiredError: function(x){ return isAuthExpiredError(x, 0); },
    sessionState: sessionState,
    tryRefresh: tryRefresh,
    run: run,
    invoke: invoke,
    expiredError: expiredError,
    showExpired: showExpired,
    showNotice: showNotice,
    hideBanner: hideBanner,
    saveDraft: saveDraft,
    readDraft: readDraft,
    clearDraft: clearDraft,
    listDrafts: listDrafts,
    collectFields: collectFields,
    applyFields: applyFields
  };
  window.bsdIsAuthExpiredError = window.BSDSession.isAuthExpiredError;
})();
