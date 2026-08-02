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
  // icon) Supabase can occasionally still be restoring the session from
  // storage at this point, making getSession() briefly report "no session"
  // even though the user is actually logged in. Give it one short grace
  // check before giving up and bouncing to login — this is what caused the
  // login->app->login flicker some users saw only from the installed icon.
  if (!session) {
    await new Promise(resolve => setTimeout(resolve, 400));
    ({ data: { session } } = await window.supabaseClient.auth.getSession());
  }

  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  const { data: profile, error } = await window.supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (error || !profile || profile.status === 'blocked') {
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

async function isFingerprintAvailable(){
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

function scrollTableBy(btn, amount){
  const wrap = btn.closest('.table-scroll-wrap');
  const inner = wrap && wrap.querySelector('.table-scroll-inner');
  if (inner) inner.scrollBy({ left: amount, behavior: 'smooth' });
}

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
    const rect = btn.getBoundingClientRect();
    const menuWidth = menu.getBoundingClientRect().width || 210;
    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = left + 'px';
    menu.style.right = 'auto';
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
    document.getElementById('fpLogoutBtn').addEventListener('click', bsdLogout);
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
