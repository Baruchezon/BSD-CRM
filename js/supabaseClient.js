// BSD CRM - אתחול חיבור ל-Supabase
// טוען את ספריית supabase-js מ-CDN ויוצר לקוח יחיד לשימוש בכל האפליקציה.

window.supabaseClient = window.supabase.createClient(
  window.BSD_CONFIG.SUPABASE_URL,
  window.BSD_CONFIG.SUPABASE_PUBLISHABLE_KEY
);

// עוזר גלובלי לבדיקת שגיאות Supabase בצורה אחידה
function handleSupabaseError(error, contextMsg) {
  if (error) {
    console.error(contextMsg || "Supabase error:", error);
    return true;
  }
  return false;
}
