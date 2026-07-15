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
  const { data: { session } } = await window.supabaseClient.auth.getSession();
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
