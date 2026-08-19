// בדיקות אמיתיות ללוגיקת קליטת לידי SITE123.
// מריצים עם: deno test supabase/functions/process-site123-leads/tests/lib_test.ts
//
// כל דגימות המייל למטה הן טקסט אמיתי שנשלף בפועל מתיבת ה-Gmail
// (baruch.ezon@gmail.com) של מיילי SITE123 האמיתיים - לא טקסט מומצא.

import { assertEquals, assertStrictEquals } from 'https://deno.land/std@0.224.0/testing/asserts.ts';
import { parseSite123Body, classifyPurpose, findDuplicate, isSite123LeadEmail, last9Digits } from '../lib.ts';

// ---------- דגימות אמיתיות מהתיבה ----------

const REAL_BUYER_EMAIL = `| |

| |

| |

| |
| |

| BSD-Business Brokers ISRAEL |

| שלום, קיבלת הודעה חדשה! שם ושם משפחה: שי צור כתובת מגורים, עיר: חיפה טלפון: 0525245601 כתובת הדואר האלקטרוני שלך: shaytzur@gmail.com מטרת הפנייה: לקנות עסק, הודעה (מומלץ לרשום כמה מילים): שכיר. מעונין לבדוק אפשרות רכישת עסק רווחי בבעלות פסיבית. שדה תאריך: 19/08/2026 |

| |

| |

| |
| הצג הודעה[](https://app.site123.com/versions/2/wizard/messages/contact/index.php?w\uFFFD5409&id\u0011553327) |

| BSD-Business Brokers ISRAEL © 2026 |`;

const REAL_SELLER_EMAIL_WITH_EMPTY_DATE = `| BSD-Business Brokers ISRAEL |

| שלום, קיבלת הודעה חדשה! שם ושם משפחה: תמי מינטוס כתובת מגורים, עיר: סביון טלפון: 0522514738 כתובת הדואר האלקטרוני שלך: tami@mintus.co.il מטרת הפנייה: למכור עסק, הודעה (מומלץ לרשום כמה מילים): מייצגת את אחי שמעוניין למכור את העסק שלו שדה תאריך: |

| הצג הודעה[](https://app.site123.com/versions/2/wizard/messages/contact/index.php?w\uFFFD5409&id\u0011418081) |

| BSD-Business Brokers ISRAEL © 2026 |`;

const REAL_COURSE_SIGNUP_WITH_EMPTY_MSG_AND_DATE = `| BSD-Business Brokers ISRAEL |

| שלום, קיבלת הודעה חדשה! שם ושם משפחה: דניאל דעוס כתובת מגורים, עיר: הר המור 72 ראש העין טלפון: 0542641999 כתובת הדואר האלקטרוני שלך: danieldais45@gmail.com מטרת הפנייה: רישום לקורס, הודעה (מומלץ לרשום כמה מילים): שדה תאריך: |

| הצג הודעה[](https://app.site123.com/versions/2/wizard/messages/contact/index.php?w\uFFFD5409&id\u0011480630) |

| BSD-Business Brokers ISRAEL © 2026 |`;

const REAL_CONTENT_READY_NOTIFICATION = `| [](https://www.site123.com) |

| היי, אנו שמחים להודיע לך שהתוכן שיצרת לנושא הבא: איך לבחור מתווך עסקים מקצועי בישראל, 20 קריטריונים, סימני אזהרה, ולמה לבחור BSD זמין כעת ומוכן לשימוש! אתה יכול להשתמש בקישור למטה כדי לראות את זה. |

| צפה בתוכן[](https://app.site123.com/versions/2/wizard/dashboard.php?w\uFFFD5409) |

| www.site123.com[](https://www.site123.com) | info@site123.com[](info@site123.com) SITE123 © 2026 South Sepulveda Boulevard 8939, 90045, Los Angeles, United States |`;

// ---------- 1. ליד חדש של קונה ----------
Deno.test('parses a real buyer lead email correctly', () => {
  const p = parseSite123Body(REAL_BUYER_EMAIL);
  assertEquals(p.recognizedTemplate, true);
  assertEquals(p.fullName, 'שי צור');
  assertEquals(p.city, 'חיפה');
  assertEquals(p.phone, '0525245601');
  assertEquals(p.email, 'shaytzur@gmail.com');
  assertEquals(p.purpose, 'לקנות עסק');
  assertEquals(p.message, 'שכיר. מעונין לבדוק אפשרות רכישת עסק רווחי בבעלות פסיבית.');
  assertEquals(p.dateField, '19/08/2026');

  const c = classifyPurpose(p.purpose);
  assertEquals(c.type, 'buyer');
  assertEquals(c.needsReview, false);
});

// ---------- 2. ליד חדש של מוכר (וגם: שדה תאריך ריק לא שובר את הפרסינג) ----------
Deno.test('parses a real seller lead email, tolerates empty trailing date field', () => {
  const p = parseSite123Body(REAL_SELLER_EMAIL_WITH_EMPTY_DATE);
  assertEquals(p.fullName, 'תמי מינטוס');
  assertEquals(p.city, 'סביון');
  assertEquals(p.phone, '0522514738');
  assertEquals(p.email, 'tami@mintus.co.il');
  assertEquals(p.purpose, 'למכור עסק');
  assertEquals(p.message, 'מייצגת את אחי שמעוניין למכור את העסק שלו');
  assertEquals(p.dateField, '');

  const c = classifyPurpose(p.purpose);
  assertEquals(c.type, 'seller');
  assertEquals(c.needsReview, false);
});

// ---------- 3. ליד עם חלק מהפרטים חסרים (הודעה + תאריך ריקים) + מטרה לא מוכרת ----------
Deno.test('missing message/date fields do not crash parsing; unrecognized purpose -> needs_review, never guessed', () => {
  const p = parseSite123Body(REAL_COURSE_SIGNUP_WITH_EMPTY_MSG_AND_DATE);
  assertEquals(p.fullName, 'דניאל דעוס');
  assertEquals(p.phone, '0542641999');
  assertEquals(p.email, 'danieldais45@gmail.com');
  assertEquals(p.purpose, 'רישום לקורס');
  assertEquals(p.message, '');
  assertEquals(p.dateField, '');

  const c = classifyPurpose(p.purpose);
  // "רישום לקורס" אינו לקנות/למכור/משקיע - המערכת לא מנחשת, מסמנת לבדיקה ידנית
  assertEquals(c.needsReview, true);
  assertEquals(c.classification, 'unclassified');
});

// ---------- 4. ליד עם טקסט חופשי (כולל תווים מיוחדים) לא נחתך/נשבר ----------
Deno.test('free-text message with punctuation is captured in full', () => {
  const p = parseSite123Body(REAL_BUYER_EMAIL);
  assertStrictEquals(p.message.includes('רכישת עסק רווחי בבעלות פסיבית'), true);
});

// ---------- 5/6. אדם קיים במערכת + שני מיילים מאותו אדם -> לא נוצר כרטיס כפול ----------
Deno.test('duplicate detection: exact phone match on an existing lead is found, no double record', () => {
  const candidates = [
    { id: 'lead-1', phone: '052-524-5601', phone2: null, email: 'old@example.com', updated_at: '2026-01-01T00:00:00Z' },
    { id: 'lead-2', phone: '0500000000', phone2: null, email: 'someoneelse@example.com', updated_at: '2026-01-02T00:00:00Z' }
  ];
  const dup = findDuplicate('0525245601', 'shaytzur@gmail.com', candidates);
  assertEquals(dup?.id, 'lead-1'); // טלפון זהה (בפורמט שונה - עם מקפים) -> אותו אדם, לא כרטיס חדש
});

Deno.test('duplicate detection: matches by email even if phone format differs completely (+972 vs 05x)', () => {
  const candidates = [
    { id: 'lead-9', phone: '+972-52-524-5601', phone2: null, email: 'shaytzur@gmail.com', updated_at: '2026-01-01T00:00:00Z' }
  ];
  const dup = findDuplicate('0525245601', 'shaytzur@gmail.com', candidates);
  assertEquals(dup?.id, 'lead-9');
});

Deno.test('duplicate detection: no match when phone AND email are both genuinely different -> creates new lead, not merged', () => {
  const candidates = [
    { id: 'lead-3', phone: '0501111111', phone2: null, email: 'unrelated@example.com', updated_at: '2026-01-01T00:00:00Z' }
  ];
  const dup = findDuplicate('0525245601', 'shaytzur@gmail.com', candidates);
  assertEquals(dup, null);
});

Deno.test('duplicate detection: when several distinct leads genuinely match, picks the most recently updated one (never invents a merge choice)', () => {
  const candidates = [
    { id: 'old', phone: '0525245601', phone2: null, email: null, updated_at: '2020-01-01T00:00:00Z' },
    { id: 'new', phone: '0525245601', phone2: null, email: null, updated_at: '2026-08-01T00:00:00Z' }
  ];
  const dup = findDuplicate('0525245601', '', candidates);
  assertEquals(dup?.id, 'new');
});

// ---------- 7. מייל שאינו ליד - אסור שייכנס ----------
Deno.test('a non-lead SITE123 email (content-ready notification) is correctly rejected', () => {
  const fromAddr = 'info@site123.com';
  const subject = 'BSD-Business Brokers ISRAEL  - התוכן שלך מוכן';
  assertEquals(isSite123LeadEmail(fromAddr, subject), false);
});

Deno.test('support-ticket emails (different sender) are correctly rejected even with lead-like content', () => {
  assertEquals(isSite123LeadEmail('support-tickets@site123.com', 'קיבלת הודעה חדשה מהאתר שלך: משהו'), false);
});

Deno.test('a real lead email is correctly accepted', () => {
  assertEquals(isSite123LeadEmail('info@site123.com', 'קיבלת הודעה חדשה מהאתר שלך: BSD-Business Brokers ISRAEL - 6a85f8fa2edcf'), true);
});

// ---------- 8. שינוי קל במבנה המייל של SITE123 (רווחים/שורות שונות) ----------
Deno.test('tolerates minor structural differences: fields separated by newlines instead of spaces', () => {
  const variant = `שלום, קיבלת הודעה חדשה!
שם ושם משפחה: יוסי כהן
כתובת מגורים, עיר: תל אביב
טלפון: 0501234567
כתובת הדואר האלקטרוני שלך: yossi@example.com
מטרת הפנייה: לקנות עסק, הודעה (מומלץ לרשום כמה מילים): מחפש עסק בתחום המזון
שדה תאריך: 01/01/2026`;
  const p = parseSite123Body(variant);
  assertEquals(p.fullName, 'יוסי כהן');
  assertEquals(p.city, 'תל אביב');
  assertEquals(p.phone, '0501234567');
  assertEquals(p.email, 'yossi@example.com');
  assertEquals(p.purpose, 'לקנות עסק');
  assertEquals(p.message, 'מחפש עסק בתחום המזון');
});

// ---------- מבנה לא מוכר לגמרי - לא ממציאים נתונים, מסמנים לבדיקה ----------
Deno.test('completely unrecognized email structure: recognizedTemplate=false, no data invented', () => {
  const weird = 'הודעה כלשהי שלא קשורה לטופס יצירת קשר בכלל, בלי אף אחד מהתוויות המוכרות.';
  const p = parseSite123Body(weird);
  assertEquals(p.recognizedTemplate, false);
  assertEquals(p.fullName, '');
  assertEquals(p.phone, '');
  assertEquals(p.email, '');
});

// ---------- משקיע -> partner ----------
Deno.test('investor purpose classifies as partner type', () => {
  const c1 = classifyPurpose('משקיע מעוניין להשקיע בעסק פעיל');
  assertEquals(c1.type, 'partner');
  assertEquals(c1.needsReview, false);
  const c2 = classifyPurpose('מחפש הזדמנות השקעה');
  assertEquals(c2.type, 'partner');
});

// ---------- עזר: last9Digits מנרמל פורמטים שונים לאותה תוצאה ----------
Deno.test('last9Digits normalizes different Israeli phone formats to the same value', () => {
  const forms = ['0525245601', '052-524-5601', '+972525245601', '972-52-524-5601', '(052) 524-5601'];
  const normalized = forms.map(last9Digits);
  for (const n of normalized) assertEquals(n, '525245601');
});
