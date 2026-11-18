// BSD CRM - אתחול חיבור ל-Supabase
// טוען את ספריית supabase-js מ-CDN ויוצר לקוח יחיד לשימוש בכל האפליקציה.

// 18.11.2026: הגדרות ההתחברות נכתבות במפורש (אלה גם ברירות המחדל של supabase-js).
// לא משנים storageKey - שינוי שלו היה מנתק את כל המשתמשים.
window.supabaseClient = window.supabase.createClient(
  window.BSD_CONFIG.SUPABASE_URL,
  window.BSD_CONFIG.SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

// עוזר גלובלי לבדיקת שגיאות Supabase בצורה אחידה
function handleSupabaseError(error, contextMsg) {
  if (error) {
    console.error(contextMsg || "Supabase error:", error);
    return true;
  }
  return false;
}
