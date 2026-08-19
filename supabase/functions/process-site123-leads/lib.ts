// לוגיקה טהורה (בלי רשת/DB) של קליטת לידי SITE123 - מופרדת כדי שאפשר לבדוק
// אותה ב-unit tests בלי חיבור אמיתי ל-Gmail/Supabase. index.ts מייבא מכאן.

export interface ParsedLead {
  fullName: string;
  city: string;
  phone: string;
  email: string;
  purpose: string;
  message: string;
  dateField: string;
  recognizedTemplate: boolean; // false = לא זוהה מבנה הטופס הרגיל
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
  const cityLabel = 'כתובת מגורים, עיר:';
  const phoneLabel = 'טלפון:';
  const emailLabel = 'כתובת הדואר האלקטרוני שלך:';
  const purposeLabel = 'מטרת הפנייה:';
  const msgLabel = 'הודעה';
  const dateLabel = 'שדה תאריך:';
  const endMarkers = ['הצג הודעה', 'BSD-Business Brokers ISRAEL ©'];

  const recognizedTemplate = text.includes(nameLabel);

  const fullName = extractBetween(text, nameLabel, [cityLabel, phoneLabel]);
  const city = extractBetween(text, cityLabel, [phoneLabel, emailLabel]);
  const phone = extractBetween(text, phoneLabel, [emailLabel, purposeLabel]);
  const email = extractBetween(text, emailLabel, [purposeLabel]);
  const purposeRaw = extractBetween(text, purposeLabel, [msgLabel + ' (', ...endMarkers]);
  const purpose = purposeRaw.replace(/,\s*$/, '').trim();
  const fullMsgLabel = 'הודעה (מומלץ לרשום כמה מילים):';
  const message = extractBetween(text, fullMsgLabel, [dateLabel, ...endMarkers]);
  const dateField = extractBetween(text, dateLabel, endMarkers);

  return { fullName, city, phone, email, purpose, message, dateField, recognizedTemplate };
}

export function classifyPurpose(purpose: string): { type: 'buyer' | 'seller' | 'partner'; classification: string; needsReview: boolean } {
  const p = (purpose || '').trim();
  if (p.includes('למכור עסק')) return { type: 'seller', classification: 'seller', needsReview: false };
  if (p.includes('לקנות עסק')) return { type: 'buyer', classification: 'buyer', needsReview: false };
  if (p.includes('משקיע') || p.includes('השקע')) return { type: 'partner', classification: 'partner', needsReview: false };
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
// זו רשת ביטחון נוספת - חילוץ השם תמיד קורא מהשדה "שם ושם משפחה:" בטופס
// עצמו, לא מכותרת השולח/הנמען, אז זה לא אמור להתרחש - אבל אם כן, לא לתת לזה
// לעבור בשקט.
const FORBIDDEN_NAMES = ['ברוך איזון', 'ברוך עזון', 'baruch ezon', 'bsd', 'bsd-business brokers israel', 'bsd business brokers israel'];

export function isForbiddenName(name: string): boolean {
  const n = (name || '').trim().toLowerCase();
  if (!n) return false;
  return FORBIDDEN_NAMES.some(f => n === f || n.includes(f));
}

// שם התצוגה הסופי של הליד: לעולם לא שם בעל התיבה/העסק, ולעולם לא מומצא -
// אם אין שם ברור בטופס, "שם לא זוהה" בלבד (לא ממציאים).
export function resolveDisplayName(extractedName: string): string {
  const n = (extractedName || '').trim();
  if (!n || isForbiddenName(n)) return 'שם לא זוהה';
  return n;
}
