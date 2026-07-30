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
  return profile;
}

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

  function checkIdle(){
    const idleFor = Date.now() - lastActivity;
    if (idleFor >= IDLE_LIMIT_MS){
      if (countdownInterval) clearInterval(countdownInterval);
      const overlay = document.getElementById('idleWarningOverlay');
      if (overlay) overlay.remove();
      bsdLogout();
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
