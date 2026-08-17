// BSD CRM - ניהול התחברות, ניתוק ובדיקת הרשאות

async function bsdLogin(email, password) {
  const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
  if (handleSupabaseError(error, "login")) return { ok: false, message: translateAuthError(error) };

  const userId = data.user.id;

  // בדיקת סטטוס פעיל/חסום לפני מתן גישה
  const { data: profile, error: profErr } = await window.supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (profErr || !profile) {
    await window.supabaseClient.auth.signOut();
    return { ok: false, message: "לא נמצא פרופיל משתמש תואם. פנה למנהל המערכת." };
  }

  if (profile.status === 'blocked') {
    await window.supabaseClient.auth.signOut();
    return { ok: false, message: "המשתמש חסום. פנה למנהל המערכת." };
  }

  // עדכון כניסה אחרונה ומספר כניסות
  await window.supabaseClient
    .from('profiles')
    .update({
      last_login_at: new Date().toISOString(),
      login_count: (profile.login_count || 0) + 1
    })
    .eq('id', userId);

  // רישום ביומן הפעילות
  await window.supabaseClient.from('activity_log').insert({
    user_id: userId,
    action_type: 'login',
    entity_type: 'profiles',
    entity_id: userId
  });

  return { ok: true, profile };
}

async function bsdLogout() {
  // The everyday "sign out" button: if this device has fingerprint
  // quick-unlock enabled, the whole point is that a fingerprint scan is
  // all that's needed to get back in - a real server-side sign-out here
  // would force email+password again next time, defeating that. So this
  // just leaves the login screen with the session still valid underneath,
  // exactly like the 30-min idle lock screen already does.
  if (isFingerprintRegistered()) {
    window.location.href = 'login.html';
    return;
  }
  await bsdFullLogout();
}

async function bsdFullLogout() {
  const user = (await window.supabaseClient.auth.getUser()).data.user;
  if (user) {
    await window.supabaseClient.from('activity_log').insert({
      user_id: user.id,
      action_type: 'logout',
      entity_type: 'profiles',
      entity_id: user.id
    });
  }
  await window.supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

// שומר על כל מסך פנימי - מפנה ל-login אם אין session פעיל, ומחזיר את הפרופיל
async function requireAuth() {
  let { data: { session } } = await window.supabaseClient.auth.getSession();

  // On a cold app-launch (e.g. opening from an installed home-screen/desktop
  // icon), or when a page has enough inline script that it competes with the
  // Supabase client for the event loop, getSession() can briefly report "no
  // session" even though the user is actually logged in (the client hasn't
  // finished rehydrating it from storage yet). Retry a few times with a
  // growing delay before giving up — a single 400ms grace check wasn't
  // always enough and caused an occasional false bounce to login.html
  // (which then auto-forwards straight back to app.html, looking like the
  // page "jumped and returned to the dashboard").
  for (const delay of [200, 400, 800]) {
    if (session) break;
    await new Promise(resolve => setTimeout(resolve, delay));
    ({ data: { session } } = await window.supabaseClient.auth.getSession());
  }

  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  let profile, error;
  for (const delay of [0, 500, 1000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    ({ data: profile, error } = await window.supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single());
    // הצלחה, או שגיאה אמיתית (אין פרופיל בכלל) - אין טעם לנסות שוב
    if (!error || (error.code && error.code !== 'PGRST116' && !/network|fetch/i.test(error.message || ''))) break;
  }

  if (error && error.code === 'PGRST116') {
    // השאילתה הצליחה להגיע לשרת אבל אין שורת פרופיל תואמת - זו באמת התנתקות
    await window.supabaseClient.auth.signOut();
    window.location.href = 'login.html';
    return null;
  }
  if (error || !profile) {
    // כשל בטעינת הפרופיל (לרוב תקלת רשת) - לא מתנתקים בכוח מהחשבון, כי ה-session
    // עצמו עדיין תקף; מציגים שגיאה ברורה במקום לזרוק בחזרה למסך כניסה בלי הסבר.
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f4ee;font-family:'Heebo','Rubik',sans-serif;direction:rtl;padding:20px;">
        <div style="background:#fff;border-radius:14px;padding:32px;max-width:420px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.15);">
          <div style="font-size:2.4rem;margin-bottom:10px;">⚠️</div>
          <div style="font-weight:700;color:#0e1b34;font-size:1.05rem;margin-bottom:10px;">בעיית תקשורת עם השרת</div>
          <div style="color:#6c7488;font-size:.9rem;margin-bottom:20px;line-height:1.5;">
            ההתחברות שלך תקינה, אך הדפדפן לא הצליח לטעון את פרטי המשתמש מהשרת (${error ? esc_(error.message) : 'שגיאה לא ידועה'}).<br>
            זה קורה בדרך כלל כשרשת/VPN/חומת אש חוסמים גישה ל-supabase.co.
          </div>
          <button onclick="location.reload()" style="background:#0e1b34;color:#fff;border:none;border-radius:8px;padding:12px 26px;font-family:inherit;font-size:.9rem;font-weight:700;cursor:pointer;">נסה שוב</button>
        </div>
      </div>`;
    return null;
  }
  if (profile.status === 'blocked') {
    await window.supabaseClient.auth.signOut();
    window.location.href = 'login.html';
    return null;
  }

  // Hide the "all submitted forms" item inside the 📋 טפסים dropdown for
  // anyone who isn't admin/manager — centralized here so every page that
  // calls requireAuth() gets this for free, instead of repeating the same
  // check in each page's own init script.
  const navFormsAll = document.getElementById('navFormsAllLink');
  if (navFormsAll && profile.role !== 'admin' && profile.role !== 'manager') {
    navFormsAll.style.display = 'none';
  }

  const navTools = document.getElementById('navToolsWrap');
  if (navTools && profile.role !== 'admin' && profile.role !== 'manager') {
    navTools.style.display = 'none';
  }

  return profile;
}

// ============================================================
// 📋 טפסים DROPDOWN — one consolidated button (in the header nav,
// and as the prominent action button on businesses.html/intake-forms.html)
// that opens a small menu with the available field-forms instead of
// separate scattered links. Shared here so the behavior is identical
// wherever the menu appears.
// ============================================================
// ============================================================
// FINGERPRINT / BIOMETRIC QUICK-UNLOCK (WebAuthn)
// ------------------------------------------------------------
// Supabase itself has no native WebAuthn/passkey support, so this
// is NOT a second real authentication factor verified by a server.
// It's a LOCAL device gate: it stores a platform-authenticator
// (fingerprint/face/PIN) credential ID in this browser's storage,
// and later requires a fresh biometric scan before letting the
// user continue with the session that's already persisted on this
// device. It turns "silently already logged in" (with no gate at
// all) or "forced to retype your password" into a real fingerprint
// check, without inventing a fake crypto login of its own.
// ============================================================
const FP_STORAGE_KEY = 'bsd_fp_credential_id';

function isFingerprintRegistered(){
  return !!localStorage.getItem(FP_STORAGE_KEY);
}

function esc_(s){
  if (s === undefined || s === null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function isAndroidMobile(){
  return /Android/i.test(navigator.userAgent);
}

async function isFingerprintAvailable(){
  // By request: fingerprint quick-unlock is offered on Android mobile only -
  // never on desktop (Windows Hello / Touch ID etc. would otherwise also
  // qualify as a "platform authenticator" and trigger the same prompts there).
  if (!isAndroidMobile()) return false;
  if (!window.PublicKeyCredential || !navigator.credentials) return false;
  try {
    // Some Android/Chrome configurations never resolve this call at all
    // (missing/misbehaving Play Services WebAuthn integration). Since this
    // runs silently right after a normal login, a hang here must never be
    // allowed to block getting into the app - race it against a timeout
    // and just treat "no answer" as "not available".
    const result = await Promise.race([
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
      new Promise(resolve => setTimeout(() => resolve(false), 2500))
    ]);
    return !!result;
  } catch(e){ return false; }
}

function randomChallenge(){
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return arr;
}

async function registerFingerprint(userLabel){
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: 'BSD CRM' },
      user: {
        id: randomChallenge(),
        name: userLabel || 'bsd-user',
        displayName: userLabel || 'BSD CRM'
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000
    }
  });
  if (!cred) throw new Error('לא ניתן היה ליצור אימות טביעת אצבע');
  const idB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(cred.rawId)));
  localStorage.setItem(FP_STORAGE_KEY, idB64);
  return true;
}

async function verifyFingerprint(){
  const idB64 = localStorage.getItem(FP_STORAGE_KEY);
  if (!idB64) return false;
  const rawId = Uint8Array.from(atob(idB64), c => c.charCodeAt(0));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [{ id: rawId, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000
    }
  });
  return !!assertion;
}

function forgetFingerprint(){
  localStorage.removeItem(FP_STORAGE_KEY);
}

// ============================================================
// CHANGE PASSWORD (self-service, any logged-in user)
// ============================================================
function openChangePassword(){
  const overlay = document.createElement('div');
  overlay.id = 'changePwdOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,27,52,.55);display:flex;align-items:center;justify-content:center;z-index:300;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:400px;width:100%;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:'Heebo','Rubik',sans-serif;direction:rtl;">
      <h3 style="margin:0 0 16px;color:#0e1b34;border-right:4px solid #c9a24b;padding-right:10px;">שינוי סיסמה</h3>
      <input type="password" id="changePwd1" placeholder="סיסמה חדשה" minlength="6" style="width:100%;padding:10px 12px;border:1px solid #d8d3c4;border-radius:8px;font-family:inherit;margin-bottom:10px;box-sizing:border-box;">
      <input type="password" id="changePwd2" placeholder="אימות סיסמה" minlength="6" style="width:100%;padding:10px 12px;border:1px solid #d8d3c4;border-radius:8px;font-family:inherit;margin-bottom:10px;box-sizing:border-box;">
      <div id="changePwdMsg" style="color:#b00020;font-size:.8rem;min-height:18px;margin-bottom:8px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button onclick="document.getElementById('changePwdOverlay').remove()" style="background:#fff;border:1px solid #d8d3c4;color:#0e1b34;padding:9px 18px;border-radius:8px;font-family:inherit;cursor:pointer;">ביטול</button>
        <button onclick="submitChangePassword()" style="background:#c9a24b;color:#1c2333;border:none;padding:9px 18px;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;">שמור סיסמה</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function submitChangePassword(){
  const p1 = document.getElementById('changePwd1').value;
  const p2 = document.getElementById('changePwd2').value;
  const msg = document.getElementById('changePwdMsg');
  if (p1.length < 6){ msg.textContent = 'הסיסמה חייבת להכיל לפחות 6 תווים'; return; }
  if (p1 !== p2){ msg.textContent = 'הסיסמאות אינן תואמות'; return; }
  const { error } = await window.supabaseClient.auth.updateUser({ password: p1 });
  if (error){ msg.textContent = 'שגיאה: ' + error.message; return; }
  document.getElementById('changePwdOverlay').remove();
  if (typeof toast === 'function') toast('הסיסמה עודכנה בהצלחה');
}

// ============================================================
// MY PROFILE (self-service personal details editor). Fully
// self-contained - fetches its own user/profile data rather than
// relying on any page-specific global variable, so it works
// identically from the Settings menu on every page. Username
// (email) is shown but never editable here.
// ============================================================
function escHtml(s){ if(s===undefined||s===null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function openMyProfile(){
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user){ return; }
  const { data: p, error } = await window.supabaseClient.from('profiles').select('*').eq('id', user.id).single();
  if (error || !p){ alert('שגיאה בטעינת הפרטים האישיים'); return; }

  const overlay = document.createElement('div');
  overlay.id = 'myProfileOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,27,52,.55);display:flex;align-items:center;justify-content:center;z-index:300;padding:20px;overflow:auto;';
  const field = (id, label, val) => `<div style="margin-top:10px;"><label style="display:block;font-size:.8rem;color:#666;margin-bottom:4px;">${label}</label><input id="${id}" value="${escHtml(val)}" style="width:100%;padding:10px 12px;border:1px solid #d8d3c4;border-radius:8px;font-family:inherit;box-sizing:border-box;"></div>`;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:460px;width:100%;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,.4);max-height:90vh;overflow-y:auto;font-family:'Heebo','Rubik',sans-serif;direction:rtl;">
      <h3 style="margin:0 0 16px;color:#0e1b34;border-right:4px solid #c9a24b;padding-right:10px;">פרטים אישיים</h3>
      <label style="display:block;font-size:.8rem;color:#666;margin-bottom:4px;">שם משתמש (אימייל) - לא ניתן לשינוי</label>
      <input type="text" value="${escHtml(user.email)}" disabled style="width:100%;padding:10px 12px;border:1px solid #e5e1d5;border-radius:8px;font-family:inherit;background:#f5f3ec;color:#999;box-sizing:border-box;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${field('myFirstName','שם פרטי', p.first_name)}
        ${field('myLastName','שם משפחה', p.last_name)}
      </div>
      ${field('myPhone','טלפון', p.phone)}
      ${field('myCity','עיר', p.city)}
      ${field('myCompany','חברה/משרד', p.company)}
      ${field('myJobTitle','תפקיד בחברה', p.job_title)}
      ${field('mySpecialization','תחום התמחות', p.specialization)}
      ${field('myLicense','מספר רישיון', p.license_number)}
      <div id="myProfileMsg" style="color:#b00020;font-size:.8rem;min-height:18px;margin-top:10px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
        <button onclick="document.getElementById('myProfileOverlay').remove()" style="background:#fff;border:1px solid #d8d3c4;color:#0e1b34;padding:9px 18px;border-radius:8px;font-family:inherit;cursor:pointer;">ביטול</button>
        <button onclick="submitMyProfile('${user.id}')" style="background:#c9a24b;color:#1c2333;border:none;padding:9px 18px;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;">שמירה</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function submitMyProfile(userId){
  const msg = document.getElementById('myProfileMsg');
  const payload = {
    first_name: document.getElementById('myFirstName').value.trim(),
    last_name: document.getElementById('myLastName').value.trim(),
    phone: document.getElementById('myPhone').value.trim(),
    city: document.getElementById('myCity').value.trim(),
    company: document.getElementById('myCompany').value.trim(),
    job_title: document.getElementById('myJobTitle').value.trim(),
    specialization: document.getElementById('mySpecialization').value.trim(),
    license_number: document.getElementById('myLicense').value.trim()
  };
  const { error } = await window.supabaseClient.from('profiles').update(payload).eq('id', userId);
  if (error){ msg.textContent = 'שגיאה בשמירה: ' + error.message; return; }
  document.getElementById('myProfileOverlay').remove();
  if (typeof toast === 'function') toast('הפרטים נשמרו בהצלחה');
  // headerUserInfo may show the old name until next page load - refresh it if present
  const headerEl = document.getElementById('headerUserInfo');
  if (headerEl && typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE){
    Object.assign(CURRENT_PROFILE, payload);
    headerEl.textContent = ((CURRENT_PROFILE.full_name && CURRENT_PROFILE.full_name.trim()) ? CURRENT_PROFILE.full_name : CURRENT_PROFILE.email) + ' · ' + new Date().toLocaleDateString('he-IL');
  }
}

// ============================================================
// UNREAD MESSAGES NAV BADGE — self-contained (fetches its own
// user), so it can be called identically from every page's init
// right after requireAuth() resolves.
// ============================================================
async function refreshNavMsgBadge(){
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) return;
  const { data } = await window.supabaseClient.from('messages').select('id').eq('recipient_id', user.id).is('read_at', null);
  const badge = document.getElementById('navMsgBadge');
  const count = data ? data.length : 0;
  if (badge){
    badge.style.display = count > 0 ? 'inline-block' : 'none';
    badge.textContent = count;
  }
}

// ============================================================
// STALE PAGE SELF-HEALING
// ------------------------------------------------------------
// The ?v= query params only cache-bust css/js - the HTML pages
// themselves were still served from cache, so deployed fixes
// could sit invisible for a long time (this bit us repeatedly).
// version.json is fetched with cache:'no-store' so it is always
// fresh; if it doesn't match the version baked into this page,
// we force one hard reload. The sessionStorage guard makes it
// impossible to get stuck in a reload loop if something is off.
// ============================================================
window.BSD_BUILD = '202608161900';

(async function checkStalePage(){
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version || version === window.BSD_BUILD) {
      sessionStorage.removeItem('bsdReloadedFor');
      return;
    }
    if (sessionStorage.getItem('bsdReloadedFor') === version) return; // already tried
    sessionStorage.setItem('bsdReloadedFor', version);
    location.reload(true);
  } catch(e) { /* offline or blocked - carry on with what we have */ }
})();

// ============================================================
// אנימציית לחיצה עדינה - לכל כפתור בכל מקום באפליקציה. מופעלת על
// אירוע 'click' עצמו (שקורה רק אחרי שהלחיצה כבר נרשמה בהצלחה),
// ולא על CSS :active/:hover עם transform - כדי לא לחזור על הבאג
// הקודם שבו אלמנט שזז תחת העכבר גרם ללחיצות "ליפול" בדסקטופ.
document.addEventListener('click', function(e){
  const el = e.target.closest(
    'button, .btn, .nav > a, .nav > div > button, .row-menu-btn, ' +
    '.lead-tab, .lead-type-tab, .choice-btns button, a.badge, ' +
    '[onclick]:not(a[href]):not(tr):not(td)'
  );
  if (!el) return;
  el.classList.remove('bsd-btn-pop');
  void el.offsetWidth; // מאלץ reflow כדי שהאנימציה תופעל מחדש גם בלחיצות רצופות
  el.classList.add('bsd-btn-pop');
});

function scrollTableBy(btn, amount){
  const wrap = btn.closest('.table-scroll-wrap');
  const inner = wrap && wrap.querySelector('.table-scroll-inner');
  if (inner) inner.scrollBy({ left: amount, behavior: 'smooth' });
}

// ============================================================
// NAV BAR TAP-SCROLL ARROWS (mobile) — see css comment on
// .nav-scroll-btn for why: dragging to reveal cut-off nav buttons
// (like כלים/הגדרות) is unreliable with a finger on many Android
// browsers, since a tap that drifts even a couple px gets read as
// a scroll and the click never fires. These give a small, static,
// always-tappable ‹ › pair per nav row instead.
function setupNavScrollArrows(){
  document.querySelectorAll('.nav-rows > .nav').forEach(nav => {
    if (nav.dataset.scrollArrowsInit) return;
    nav.dataset.scrollArrowsInit = '1';

    const wrap = document.createElement('div');
    wrap.className = 'nav-row-wrap';
    nav.parentNode.insertBefore(wrap, nav);
    wrap.appendChild(nav);

    const left = document.createElement('button');
    left.type = 'button';
    left.className = 'nav-scroll-btn nav-scroll-left';
    left.textContent = '‹';
    left.setAttribute('aria-label', 'גלול בתפריט');
    left.hidden = true;

    const right = document.createElement('button');
    right.type = 'button';
    right.className = 'nav-scroll-btn nav-scroll-right';
    right.textContent = '›';
    right.setAttribute('aria-label', 'גלול בתפריט');
    right.hidden = true;

    left.addEventListener('click', function(e){ e.stopPropagation(); nav.scrollBy({ left: -110, behavior: 'smooth' }); });
    right.addEventListener('click', function(e){ e.stopPropagation(); nav.scrollBy({ left: 110, behavior: 'smooth' }); });

    wrap.appendChild(left);
    wrap.appendChild(right);

    function update(){
      const max = nav.scrollWidth - nav.clientWidth;
      if (max <= 4){ left.hidden = true; right.hidden = true; return; }
      // scrollLeft's sign/zero-point for RTL varies by browser, so
      // just check both physical extremes rather than assuming a sign.
      const atStart = Math.abs(nav.scrollLeft) <= 4;
      const atEnd = Math.abs(Math.abs(nav.scrollLeft) - max) <= 4;
      left.hidden = atEnd;
      right.hidden = atStart;
      if (!atStart && !atEnd){ left.hidden = false; right.hidden = false; }
    }
    nav.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    setTimeout(update, 50);
    update();
  });
}
document.addEventListener('DOMContentLoaded', setupNavScrollArrows);
// Some pages toggle mainWrap display after auth resolves, which can
// change nav content width later — re-check shortly after load too.
window.addEventListener('load', function(){ setTimeout(setupNavScrollArrows, 400); });

function toggleFormsMenu(e){
  if (e) e.stopPropagation();
  const btn = e && e.currentTarget ? e.currentTarget : null;
  const menu = btn ? btn.parentElement.querySelector('.bsd-forms-menu') : document.querySelector('.bsd-forms-menu');
  if (!menu) return;
  const willOpen = menu.style.display !== 'block';
  document.querySelectorAll('.bsd-forms-menu').forEach(m => m.style.display = 'none');
  if (!willOpen) return;

  // Position with `fixed` (computed from the button's own on-screen rect)
  // instead of relying on `absolute` + an ancestor being a normal (non-
  // scrolling) container. On mobile the header's .nav bar scrolls
  // horizontally (overflow-x:auto), which silently clips any absolutely
  // positioned child that pokes out below it — the menu was opening, just
  // invisibly. `fixed` positioning escapes that clipping entirely.
  if (btn){
    // Measure with display:block (but invisible) first — a menu that's still
    // display:none reports a 0 height, which broke the vertical flip check below.
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const rect = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const menuWidth = menuRect.width || 210;
    const menuHeight = menuRect.height || 0;

    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;

    // Flip above the button when there isn't room below (near the bottom of
    // the screen / a row near the end of a scrolled list) but there IS room
    // above — otherwise the menu got cut off by the bottom of the viewport.
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    const spaceAbove = rect.top - 4;
    let top;
    if (menuHeight > spaceBelow && spaceAbove > spaceBelow){
      top = Math.max(8, rect.top - menuHeight - 4);
    } else {
      top = rect.bottom + 4;
      // Even opening downward, don't let it run off the bottom of the screen.
      if (top + menuHeight > window.innerHeight - 8){
        top = Math.max(8, window.innerHeight - menuHeight - 8);
      }
    }

    menu.style.position = 'fixed';
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    menu.style.right = 'auto';
    menu.style.maxHeight = (window.innerHeight - 16) + 'px';
    menu.style.overflowY = 'auto';
    menu.style.visibility = 'visible';
    return;
  }
  menu.style.display = 'block';
}
document.addEventListener('click', function(){
  document.querySelectorAll('.bsd-forms-menu').forEach(m => m.style.display = 'none');
});

function translateAuthError(error) {
  if (!error) return '';
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('invalid login credentials')) return 'אימייל או סיסמה שגויים.';
  if (msg.includes('email not confirmed')) return 'המשתמש טרם אושר. פנה למנהל המערכת.';
  return 'שגיאת התחברות: ' + error.message;
}

// ============================================================
// AUTO-LOGOUT ON INACTIVITY (security) — after 30 minutes with
// no mouse/keyboard/touch/scroll activity, the user is signed
// out automatically so an open session doesn't sit unattended.
// A 60-second warning with a live countdown gives a last chance
// to stay logged in before it actually happens. Only runs on
// pages that have the logged-in header (login.html/set-password.html
// don't, so nothing runs there).
// ============================================================
(function setupInactivityAutoLogout(){
  if (!document.getElementById('headerUserInfo')) return;

  const IDLE_LIMIT_MS = 30 * 60 * 1000;   // 30 minutes total
  const WARNING_MS = 60 * 1000;           // show warning in the last 60 seconds
  let lastActivity = Date.now();
  let warningShown = false;
  let countdownInterval = null;

  function buildWarningModal(){
    const overlay = document.createElement('div');
    overlay.id = 'idleWarningOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,27,52,.6);display:flex;align-items:center;justify-content:center;z-index:9999;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:28px 32px;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:'Heebo','Rubik',sans-serif;direction:rtl;">
        <div style="font-size:2rem;margin-bottom:8px;">⏳</div>
        <div style="font-weight:700;color:#0e1b34;font-size:1.05rem;margin-bottom:8px;">בשל חוסר פעילות תנותק בקרוב</div>
        <div style="color:#6c7488;font-size:.9rem;margin-bottom:18px;">תנותק אוטומטית בעוד <span id="idleCountdown" style="font-weight:700;color:#b3402c;">60</span> שניות מטעמי אבטחה</div>
        <button id="idleStayBtn" class="btn btn-primary" style="background:#0e1b34;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-family:inherit;font-size:.9rem;font-weight:700;cursor:pointer;">אני עדיין כאן — הישאר מחובר</button>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('idleStayBtn').addEventListener('click', dismissWarning);
    return overlay;
  }

  function dismissWarning(){
    const overlay = document.getElementById('idleWarningOverlay');
    if (overlay) overlay.remove();
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    warningShown = false;
    lastActivity = Date.now();
  }

  function showWarning(){
    warningShown = true;
    const overlay = document.getElementById('idleWarningOverlay') || buildWarningModal();
    let remaining = Math.round((IDLE_LIMIT_MS - (Date.now() - lastActivity)) / 1000);
    const label = overlay.querySelector('#idleCountdown');
    if (label) label.textContent = Math.max(0, remaining);
    countdownInterval = setInterval(() => {
      remaining -= 1;
      const el = document.getElementById('idleCountdown');
      if (el) el.textContent = Math.max(0, remaining);
      if (remaining <= 0){ clearInterval(countdownInterval); countdownInterval = null; }
    }, 1000);
  }

  function showLockScreen(){
    if (document.getElementById('fpLockOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'fpLockOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:#0e1b34;display:flex;align-items:center;justify-content:center;z-index:10000;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:34px 30px;max-width:340px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:'Heebo','Rubik',sans-serif;direction:rtl;">
        <div style="font-size:2.6rem;margin-bottom:10px;">🔒</div>
        <div style="font-weight:700;color:#0e1b34;font-size:1.05rem;margin-bottom:6px;">המסך ננעל מטעמי אבטחה</div>
        <div style="color:#6c7488;font-size:.85rem;margin-bottom:22px;">אמת עם טביעת אצבע כדי להמשיך</div>
        <button id="fpUnlockBtn" style="background:#0e1b34;color:#fff;border:none;border-radius:8px;padding:12px 26px;font-family:inherit;font-size:.9rem;font-weight:700;cursor:pointer;width:100%;margin-bottom:10px;">🔓 אמת עם טביעת אצבע</button>
        <button id="fpLogoutBtn" style="background:none;border:none;color:#999;font-size:.8rem;cursor:pointer;text-decoration:underline;">התנתק לגמרי</button>
        <div id="fpLockError" style="color:#b00020;font-size:.78rem;margin-top:10px;"></div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('fpUnlockBtn').addEventListener('click', async function(){
      const errEl = document.getElementById('fpLockError');
      errEl.textContent = '';
      try {
        const ok = await verifyFingerprint();
        if (ok){ overlay.remove(); lastActivity = Date.now(); }
        else { errEl.textContent = 'האימות נכשל, נסה שוב'; }
      } catch(e){
        errEl.textContent = 'האימות בוטל או נכשל';
      }
    });
    document.getElementById('fpLogoutBtn').addEventListener('click', bsdFullLogout);
  }

  function checkIdle(){
    const idleFor = Date.now() - lastActivity;
    if (idleFor >= IDLE_LIMIT_MS){
      if (countdownInterval) clearInterval(countdownInterval);
      const overlay = document.getElementById('idleWarningOverlay');
      if (overlay) overlay.remove();
      if (isFingerprintRegistered()){
        showLockScreen();
      } else {
        bsdLogout();
      }
      return;
    }
    if (!warningShown && idleFor >= (IDLE_LIMIT_MS - WARNING_MS)){
      showWarning();
    }
  }

  function markActivity(){
    // While the warning is showing, movement alone shouldn't silently dismiss it —
    // require the explicit "still here" click so an idle mouse resting near the
    // keyboard doesn't create a false sense of continued presence.
    if (warningShown) return;
    lastActivity = Date.now();
  }

  ['mousemove','mousedown','keydown','scroll','touchstart'].forEach(evt=>{
    document.addEventListener(evt, markActivity, { passive:true });
  });

  setInterval(checkIdle, 1000);
})();

// ============================================================
// bsdSetButtonLoading — כפתור פעולה (שמור/שלח/מחק) שמראה מצב
// טעינה ברור (ספינר + טקסט) במקום פשוט "להשתתק" עד שהשרת מסיים.
// שימוש: bsdSetButtonLoading(btnEl, true, 'שומר...') לפני הקריאה
// האסינכרונית, ו-bsdSetButtonLoading(btnEl, false) אחריה (בהצלחה
// או בכשל - שני המסלולים צריכים לשחזר את הכפתור).
// שומר את הטקסט/HTML המקורי על האלמנט כדי לשחזר בדיוק כמו שהיה.
// ============================================================
window.bsdSetButtonLoading = function(btn, isLoading, loadingText){
  if (!btn) return;
  if (isLoading){
    if (btn.dataset.bsdOrigHtml === undefined) btn.dataset.bsdOrigHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = `<span class="btn-spinner"></span>${loadingText ? esc(loadingText) : ''}`;
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    if (btn.dataset.bsdOrigHtml !== undefined){
      btn.innerHTML = btn.dataset.bsdOrigHtml;
      delete btn.dataset.bsdOrigHtml;
    }
  }
};
// esc() כבר מוגדר בכל דף שמשתמש בכפתורים (למניעת הזרקת HTML מטקסט הטעינה);
// fallback זהיר למקרה שנקרא מדף שעדיין לא הגדיר את זה בשלב הזה בטעינה.
if (typeof window.esc !== 'function'){
  window.esc = function(s){ if (s===undefined||s===null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); };
}

// ============================================================================
// bsdUploadFile - מנגנון העלאת קבצים אחד, משותף, יציב, לכל המערכת.
// ----------------------------------------------------------------------------
// רקע (16.08.2026): נמצא ש-storage.upload() של supabase-js שולח את הקובץ
// כ-fetch() יחיד ללא retry אמיתי, ללא progress, וללא timeout מותאם לגודל -
// ובדיקה בפועל באנדרואיד (session תקין, חיבור לשרת מאושר עם תשובות אמיתיות
// מה-API) הראתה כשל TypeError "Failed to fetch" עקבי דווקא בקבצים גדולים
// יותר (PDF 1.4MB נכשל, תמונה קטנה יותר לאחר דחיסה הצליחה) - כלומר בעיית
// אמינות של חיבור לא יציב תחת עומס/משך זמן ארוך יותר, לא בעיית קוד/הרשאות.
// XMLHttpRequest נבחר בכוונה במקום fetch(): הוא נתמך ויציב עשור+ להעלאות
// קבצים גדולים, לא תלוי בסמנטיקת streaming/duplex החדשה של fetch, ומאפשר
// מעקב התקדמות אמיתי (xhr.upload.onprogress) שגם עוזר להשאיר את הדפדפן
// "ער" בזמן ההעלאה.
//
// שימוש:
//   const { data, error } = await bsdUploadFile(bucket, path, file, {
//     onProgress: pct => statusEl.textContent = `מעלה... ${pct}%`,
//     contentType: file.type || undefined
//   });
//   if (error) { /* error.message, error.name */ }
// ============================================================================
async function bsdUploadFile(bucket, path, file, opts){
  opts = opts || {};
  const maxAttempts = 3;
  // timeout מתואם לגודל הקובץ - מינימום 30 שניות, ועוד כ-20 שניות לכל MB,
  // כדי לא לחתוך העלאה גדולה שעדיין מתקדמת בקצב רשת סלולרי/WiFi איטי.
  const sizeMB = (file.size || 0) / (1024 * 1024);
  const timeoutMs = Math.max(30000, 20000 * sizeMB);

  const { data: sessionData } = await window.supabaseClient.auth.getSession();
  const accessToken = sessionData && sessionData.session && sessionData.session.access_token;
  if (!accessToken) return { data: null, error: { name: 'AuthSessionMissing', message: 'אין session פעיל - יש להתחבר מחדש' } };

  const uploadUrl = `${window.BSD_CONFIG.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;

  function attemptOnce(){
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl, true);
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
          resolve({ ok: true });
        } else {
          let serverMsg = xhr.responseText;
          try { serverMsg = JSON.parse(xhr.responseText).message || serverMsg; } catch(e){}
          resolve({ ok: false, retryable: false, error: { name: 'StorageApiError', message: `שגיאת שרת (${xhr.status}): ${serverMsg}` } });
        }
      };
      xhr.onerror = function(){
        resolve({ ok: false, retryable: true, error: { name: 'StorageUnknownError', message: 'Failed to fetch (network error)' } });
      };
      xhr.ontimeout = function(){
        resolve({ ok: false, retryable: true, error: { name: 'StorageTimeout', message: `העלאה ארכה יותר מ-${Math.round(timeoutMs/1000)} שניות ונעצרה` } });
      };
      xhr.send(file);
    });
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++){
    const result = await attemptOnce();
    if (result.ok) return { data: { path }, error: null };
    lastError = result.error;
    if (!result.retryable || attempt === maxAttempts) break;
    if (opts.onProgress) opts.onProgress(0);
    await new Promise(r => setTimeout(r, 1500 * attempt)); // backoff: 1.5s, 3s
  }
  return { data: null, error: lastError };
}
