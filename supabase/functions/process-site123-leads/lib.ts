// לוגיקה טהורה (בלי רשת/DB) של קליטת לידי SITE123 - מופרדת כדי שאפשר לבדוק
// אותה ב-unit tests בלי חיבור אמיתי ל-Gmail/Supabase. index.ts מייבא מכאן.
//
// עדכון 23.08.2026: SITE123 שינו את תבנית הטופס בפועל (אומת מול מיילים
// חיים מ-2026 באותו יום) - השדה הבודד "מטרת הפנייה:" הוחלף ב"קבוצת תיבות
// סימון:", רשימת צ'קבוקסים המופרדת בפסיקים שיכולה להכיל כמה בחירות
// בו-זמנית (למשל גם "עסק למכירה" וגם "רישום לקורס" באותה פנייה). גם
// תוויות השדות "עיר" וה"הודעה" השתנו. מיילים היסטוריים ישנים (עד סביבות
// 19-22.08.2026, ראה tests/lib_test.ts) עדיין משתמשים בתבנית הישנה - שתי
// התבניות נתמכות ומאוחדות לאותו מבנה checkboxes[] כדי שהמשך הקוד (סיווג,
// שמירה) יהיה זהה בלי קשר לאיזו תבנית התקבלה בפועל.

export interface ParsedLead {
  fullName: string;
  city: string;
  phone: string;
  email: string;
  message: string;
  checkboxes: string[];        // כל תיבות הסימון שנבחרו - לעולם לא נבחרת רק אחת בשקט
  recognizedTemplate: boolean; // false = לא זוהה אף אחת משתי התבניות המוכרות
}

export function stripPipes(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
}

export function digitsOnly(s: string | null | undefined): string {
  return (s || '').replace(/\D/g, '');
}

export function last9Digits(phone: string | null | undefined): string {
  const d = digitsOnly(phone);
  return d.length >= 9 ? d.slice(-9) : d;
}

export function extractBetween(text: string, startLabel: string, endLabels: string[]): string {
  const startIdx = text.indexOf(startLabel);
  if (startIdx === -1) return '';
  const from = startIdx + startLabel.length;
  let endIdx = text.length;
  for (const lbl of endLabels) {
    const i = text.indexOf(lbl, from);
    if (i !== -1 && i < endIdx) endIdx = i;
  }
  return stripPipes(text.slice(from, endIdx)).replace(/^[,:\s]+/, '').trim();
}

export function parseSite123Body(rawText: string): ParsedLead {
  const text = rawText || '';
  const nameLabel = 'שם ושם משפחה:';
  const phoneLabel = 'טלפון:';
  const emailLabel = 'כתובת הדואר האלקטרוני שלך:';
  const endMarkers = ['הצג הודעה', 'BSD-Business Brokers ISRAEL ©'];

  // תבנית חדשה (מ-23.08.2026 בערך ואילך)
  const cityLabelNew = 'כתובת , עיר :';
  const msgLabelNew = 'הודעה (נשמח לפרטי הפנייה):';
  const checkboxLabel = 'קבוצת תיבות סימון:';

  // תבנית ישנה (עד סביבות 19-22.08.2026)
  const cityLabelOld = 'כתובת מגורים, עיר:';
  const msgLabelOld = 'הודעה (מומלץ לרשום כמה מילים):';
  const purposeLabelOld = 'מטרת הפנייה:';
  const dateLabelOld = 'שדה תאריך:';

  const hasNewTemplate = text.includes(checkboxLabel);
  const hasOldTemplate = !hasNewTemplate && text.includes(purposeLabelOld);
  const recognizedTemplate = text.includes(nameLabel) && (hasNewTemplate || hasOldTemplate);

  if (hasOldTemplate) {
    const fullName = extractBetween(text, nameLabel, [cityLabelOld, phoneLabel]);
    const city = extractBetween(text, cityLabelOld, [phoneLabel, emailLabel]);
    const phone = extractBetween(text, phoneLabel, [emailLabel, purposeLabelOld]);
    const email = extractBetween(text, emailLabel, [purposeLabelOld]);
    const purposeRaw = extractBetween(text, purposeLabelOld, [msgLabelOld, ...endMarkers]);
    const checkboxes = purposeRaw.split(',').map(s => s.trim()).filter(Boolean);
    const message = extractBetween(text, msgLabelOld, [dateLabelOld, ...endMarkers]);
    return { fullName, city, phone, email, message, checkboxes, recognizedTemplate };
  }

  // תבנית חדשה (גם כברירת מחדל אם שתי התבניות לא זוהו - ננסה בכל זאת לחלץ מה שאפשר)
  const fullName = extractBetween(text, nameLabel, [cityLabelNew, phoneLabel]);
  const city = extractBetween(text, cityLabelNew, [phoneLabel, emailLabel]);
  const phone = extractBetween(text, phoneLabel, [emailLabel, msgLabelNew]);
  const email = extractBetween(text, emailLabel, [msgLabelNew, checkboxLabel]);
  const message = extractBetween(text, msgLabelNew, [checkboxLabel, ...endMarkers]);
  const checkboxesRaw = extractBetween(text, checkboxLabel, endMarkers);
  const checkboxes = checkboxesRaw.split(',').map(s => s.trim()).filter(Boolean);
  return { fullName, city, phone, email, message, checkboxes, recognizedTemplate };
}

export interface Classification {
  type: 'buyer' | 'seller' | 'partner'; // שדה טכני בלבד ל-DB (enum לא מאפשר ערך אחר) - לעולם לא סופי/authoritative
  classification: 'seller' | 'buyer' | 'partner' | 'training' | 'unclassified';
  needsReview: boolean;
}

// אזכור מפורש של קורס/הכשרה/לימוד - בתיבות הסימון או בהודעה החופשית - גובר
// תמיד על כל סיווג אחר. כשהסיווג לא ברור בכלל, מסומן 'unclassified' + needsReview,
// ולעולם לא "מנחשים" קונה בשקט - ה-type הטכני עדיין 'buyer' כי ה-enum ב-DB
// מחייב ערך, אבל זה ורק שדה טכני; guessLabel/notes בקוד הקורא (index.ts)
// חייבים לומר "דורש בדיקה" במפורש ולא "מחפש לקנות עסק".
export function classifyPurpose(checkboxes: string[], message: string): Classification {
  const combined = `${(checkboxes || []).join(' ')} ${message || ''}`;
  const isCourse = ['קורס', 'הכשרה', 'לימוד'].some(k => combined.includes(k));
  if (isCourse) return { type: 'buyer', classification: 'training', needsReview: false };

  const isSeller = (checkboxes || []).some(c => c.includes('עסק למכירה') || c.includes('למכור עסק'));
  if (isSeller) return { type: 'seller', classification: 'seller', needsReview: false };

  const isBuyer = (checkboxes || []).some(c => c.includes('לקנות עסק'));
  if (isBuyer) return { type: 'buyer', classification: 'buyer', needsReview: false };

  const isPartner = combined.includes('משקיע') || combined.includes('השקע') || combined.includes('שותפ');
  if (isPartner) return { type: 'partner', classification: 'partner', needsReview: false };

  return { type: 'buyer', classification: 'unclassified', needsReview: true };
}

// דמה בדיקת כפילות: מקבל ליד נכנס + רשימת מועמדים (כבר סוננה גסות מה-DB
// לפי or() על טלפון/מייל) ומחזיר את המועמד שבאמת תואם, אם יש.
export interface DupCandidate {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
  updated_at?: string | null;
}

export function findDuplicate(incomingPhone: string, incomingEmail: string, candidates: DupCandidate[]): DupCandidate | null {
  const last9 = last9Digits(incomingPhone);
  const emailNorm = incomingEmail ? incomingEmail.trim().toLowerCase() : '';
  const verified = candidates.filter(c => {
    const phoneMatch = !!last9 && (last9Digits(c.phone) === last9 || last9Digits(c.phone2) === last9);
    const emailMatch = !!emailNorm && (c.email || '').trim().toLowerCase() === emailNorm;
    return phoneMatch || emailMatch;
  });
  if (verified.length === 0) return null;
  verified.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  return verified[0];
}

export function isSite123LeadEmail(fromAddr: string, subject: string): boolean {
  const SITE123_SENDER = 'info@site123.com';
  const SUBJECT_MARK = 'קיבלת הודעה חדשה מהאתר';
  return (fromAddr || '').toLowerCase().trim() === SITE123_SENDER && (subject || '').includes(SUBJECT_MARK);
}

// שמות שאסור בשום מקרה שייצגו את "שם הליד" - אם החילוץ בטעות תפס אותם (למשל
// מטקסט כללי במייל, לא משדה השם עצמו), עדיף "שם לא זוהה" על פני שם שגוי.
const FORBIDDEN_NAMES = ['ברוך איזון', 'ברוך עזון', 'baruch ezon', 'bsd', 'bsd-business brokers israel', 'bsd business brokers israel'];

export function isForbiddenName(name: string): boolean {
  const n = (name || '').trim().toLowerCase();
  if (!n) return false;
  return FORBIDDEN_NAMES.some(f => n === f || n.includes(f));
}

export function resolveDisplayName(extractedName: string): string {
  const n = (extractedName || '').trim();
  if (!n || isForbiddenName(n)) return 'שם לא זוהה';
  return n;
}
