// ============================================================
// BSD CRM — מקור הרשאות מרכזי אחד (js/permissions.js)
// ------------------------------------------------------------
// כל דף שצריך להחליט "האם המשתמש הזה יכול X" קורא לפונקציה מכאן
// במקום לבדוק CURRENT_PROFILE.role ישירות. המטרה: שינוי לוגיקת
// הרשאות אחת = שינוי במקום אחד, לא בעשרות דפים.
//
// חשוב: הפונקציות כאן הן קו הגנה ראשון (UX — הסתרת כפתורים/שורות),
// לא קו ההגנה היחיד. ה-RLS בפוסטגרס (ראה migrations/2026-08-15_
// permissions_and_anonymous_access.sql) הוא קו ההגנה האמיתי ברמת
// השרת/בסיס הנתונים, ואוכף את אותם כללים גם אם קוד הלקוח נעקף
// לגמרי (למשל קריאת API ישירה).
//
// כל פונקציה מקבלת profile (אובייקט CURRENT_PROFILE) ולפי הצורך
// את הרשומה הרלוונטית (עסק/קונה/התאמה) כדי לדעת מי היוצר/המטפל.
// ============================================================

function bsdIsAdminOrManager(profile) {
  return !!profile && (profile.role === 'admin' || profile.role === 'manager');
}

function bsdOwnsRecord(profile, record) {
  if (!profile || !record) return false;
  return record.created_by === profile.id || record.handled_by === profile.id;
}

// ---- עסקים ----
function canViewBusinessFull(profile, business) {
  if (bsdIsAdminOrManager(profile)) return true;
  if (bsdOwnsRecord(profile, business)) return true;
  if (business && business._hasAccessGrant) return true; // מסומן ע"י שאילתת business_access_grants
  return false;
}

function canViewAnonymousBusinesses(profile) {
  return bsdIsAdminOrManager(profile) || !!(profile && profile.can_view_anonymous_businesses);
}

function canEditBusiness(profile, business) {
  return canViewBusinessFull(profile, business); // שחרור מידע = צפייה בלבד, לא עריכה
}

function canCreateBusiness(profile) {
  return bsdIsAdminOrManager(profile) || !!(profile && profile.can_create_businesses);
}

function canGenerateAnonymousCard(profile, business) {
  return canEditBusiness(profile, business);
}

function canReleaseBusinessAccess(profile, business) {
  return canEditBusiness(profile, business); // רק מטפל/יוצר/אדמין/מנהל יכולים לשחרר
}

// ---- קונים (leads) ----
function canViewBuyer(profile, buyer) {
  if (bsdIsAdminOrManager(profile)) return true;
  return bsdOwnsRecord(profile, buyer);
}

function canEditBuyer(profile, buyer) {
  return canViewBuyer(profile, buyer);
}

function canCreateBuyer(profile) {
  return bsdIsAdminOrManager(profile) || !!(profile && profile.can_create_buyers);
}

// ---- התאמות ----
function canViewMatch(profile, match, business, buyer) {
  if (bsdIsAdminOrManager(profile)) return true;
  if (business && canViewBusinessFull(profile, business)) return true;
  if (buyer && bsdOwnsRecord(profile, buyer)) return true;
  return false;
}

// ---- קבצים ----
function canViewBusinessFiles(profile, business) {
  return canViewBusinessFull(profile, business);
}
function canUploadBusinessFiles(profile, business) {
  return canViewBusinessFull(profile, business);
}
function canDownloadBusinessFiles(profile, business) {
  return canViewBusinessFull(profile, business);
}

// ---- כלים נוספים (ניתנים דלוק/כבוי פר-משתמש ע"י אדמין) ----
function canUseRecording(profile) {
  return bsdIsAdminOrManager(profile) || !!(profile && profile.can_record);
}
function canUseSurvey(profile) {
  return bsdIsAdminOrManager(profile) || !!(profile && profile.can_use_survey);
}
function canUseSalesFile(profile) {
  return bsdIsAdminOrManager(profile) || !!(profile && profile.can_upload_sale_files);
}

// ---- ניהול משתמשים/הרשאות (אדמין תמיד; מנהל רק אם הורשה במפורש) ----
function canManageUsers(profile) {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  return profile.role === 'manager' && !!profile.can_manage_users;
}

// ---- ברירות מחדל להרשאות לפי רמה, למסך יצירת/עריכת משתמש (סעיף 2) ----
// זהו רק ה-preset שמוצג ב-UI כשבוחרים רמה — לא מחליף את ה-DB defaults
// שנקבעו ב-migration. אדמין יכול לשנות כל דגל ידנית אחרי הבחירה.
const BSD_ROLE_DEFAULT_PERMISSIONS = {
  admin:   { can_view_anonymous_businesses: true, can_create_businesses: true, can_create_buyers: true, can_record: true, can_use_survey: true, can_use_sale_file: true, can_send_agreement: true, can_send_presentations: true },
  manager: { can_view_anonymous_businesses: true, can_create_businesses: true, can_create_buyers: true, can_record: true, can_use_survey: true, can_use_sale_file: true, can_send_agreement: true, can_send_presentations: true },
  agent_authorized: { can_view_anonymous_businesses: true, can_create_businesses: true, can_create_buyers: true, can_record: true, can_use_survey: false, can_use_sale_file: false, can_send_agreement: false, can_send_presentations: false },
  agent:   { can_view_anonymous_businesses: false, can_create_businesses: false, can_create_buyers: false, can_record: false, can_use_survey: false, can_use_sale_file: false, can_send_agreement: false, can_send_presentations: false }
};

function bsdApplyRoleDefaults(role) {
  return Object.assign({}, BSD_ROLE_DEFAULT_PERMISSIONS[role] || BSD_ROLE_DEFAULT_PERMISSIONS.agent);
}

function bsdLogActivity(actionType, entityType, entityId, details){
  if (!window.supabaseClient || !CURRENT_PROFILE) return;
  window.supabaseClient.from('audit_log').insert({
    table_name: entityType,
    record_id: entityId,
    action: actionType,
    actor_id: CURRENT_PROFILE.id,
    details: details || null
  }).then(({error}) => { if (error) console.error('audit_log insert failed', error); });
}
