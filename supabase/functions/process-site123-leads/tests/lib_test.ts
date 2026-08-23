// בדיקות אמיתיות ללוגיקת קליטת לידי SITE123.
// מריצים עם: deno test supabase/functions/process-site123-leads/tests/lib_test.ts
//
// כל דגימות המייל למטה הן טקסט אמיתי (תבנית ישנה + תבנית חדשה) שנשלף
// בפועל מתיבת ה-Gmail (baruch.ezon@gmail.com) של מיילי SITE123 האמיתיים -
// לא טקסט מומצא. עדכון 23.08.2026: SITE123 שינו את תבנית הטופס (ראה lib.ts) -
// הבדיקות עודכנו לתמוך בשתי התבניות במקביל.

import { assertEquals, assertStrictEquals } from 'https://deno.land/std@0.224.0/testing/asserts.ts';
import { parseSite123Body, classifyPurpose, findDuplicate, isSite123LeadEmail, last9Digits, resolveDisplayName, isForbiddenName } from '../lib.ts';

// ---------- דגימות אמיתיות - תבנית ישנה (עד סביבות 19-22.08.2026) ----------

const REAL_BUYER_EMAIL_OLD = `| |\n\n| |\n\n| |\n\n| |\n| |\n\n| BSD-Business Brokers ISRAEL |\n\n| שלום, קיבלת הודעה חדשה! שם ושם משפחה: שי צור כתובת מגורים, עיר: חיפה טלפון: 0525245601 כתובת הדואר האלקטרוני שלך: shaytzur@gmail.com מטרת הפנייה: לקנות עסק, הודעה (מומלץ לרשום כמה מילים): שכיר. מעונין לבדוק אפשרות רכישת עסק רווחי בבעלות פסיבית. שדה תאריך: 19/08/2026 |\n\n| |\n\n| |\n\n| |\n| הצג הודעה[](https://app.site123.com/versions/2/wizard/messages/contact/index.php?w\uFFFD5409&id\u0011553327) |\n\n| BSD-Business Brokers ISRAEL © 2026 |`;

const REAL_SELLER_EMAIL_OLD_EMPTY_DATE = `| BSD-Business Brokers ISRAEL |\n\n| שלום, קיבלת הודעה חדשה! שם ושם משפחה: תמי מינטוס כתובת מגורים, עיר: סביון טלפון: 0522514738 כתובת הדואר האלקטרוני שלך: tami@mintus.co.il מטרת הפנייה: למכור עסק, הודעה (מומלץ לרשום כמה מילים): מייצגת את אחי שמעוניין למכור את העסק שלו שדה תאריך: |\n\n| הצג הודעה[](https://app.site123.com/versions/2/wizard/messages/contact/index.php?w\uFFFD5409&id\u0011418081) |\n\n| BSD-Business Brokers ISRAEL © 2026 |`;

const REAL_COURSE_SIGNUP_OLD_EMPTY_MSG_AND_DATE = `| BSD-Business Brokers ISRAEL |\n\n| שלום, קיבלת הודעה חדשה! שם ושם משפחה: דניאל דעוס כתובת מגורים, עיר: הר המור 72 ראש העין טלפון: 0542641999 כתובת הדואר האלקטרוני שלך: danieldais45@gmail.com מטרת הפנייה: רישום לקורס, הודעה (מומלץ לרשום כמה מילים): שדה תאריך: |\n\n| הצג הודעה[](https://app.site123.com/versions/2/wizard/messages/contact/index.php?w\uFFFD5409&id\u0011480630) |\n\n| BSD-Business Brokers ISRAEL © 2026 |`;

const REAL_CONTENT_READY_NOTIFICATION = `| [](https://www.site123.com) |\n\n| היי, אנו שמחים להודיע לך שהתוכן שיצרת לנושא הבא: איך לבחור מתווך עסקים מקצועי בישראל, 20 קריטריונים, סימני אזהרה, ולמה לבחור BSD זמין כעת ומוכן לשימוש! אתה יכול להשתמש בקישור למטה כדי לראות את זה. |\n\n| צפה בתוכן[](https://app.site123.com/versions/2/wizard/dashboard.php?w\uFFFD5409) |\n\n| www.site123.com[](https://www.site123.com) | info@site123.com[](info@site123.com) SITE123 © 2026 South Sepulveda Boulevard 8939, 90045, Los Angeles, United States |`;

// ---------- דגימות אמיתיות - תבנית חדשה (מ-23.08.2026 בערך ואילך, אומת מול מיילים חיים) ----------

const REAL_SELLER_EMAIL_NEW = `BSD-Business Brokers ISRAEL\n\nשלום,\n\nקיבלת הודעה חדשה!\n\nשם ושם משפחה: דוד בושדיד\nכתובת , עיר : בית דגן\nטלפון: 053-4248089\nכתובת הדואר האלקטרוני שלך: z039524488@gmail.com\nהודעה (נשמח לפרטי הפנייה): נשמח לדבר\nקבוצת תיבות סימון: עסק למכירה,\n\n\n\n\n\nהצג הודעה\n[https://app.site123.com/versions/2/wizard/messages/contact/index.php?w=815409&id=10508976]\n\nBSD-Business Brokers ISRAEL © 2026`;

const REAL_MULTI_SELECT_WITH_COURSE_NEW = `BSD-Business Brokers ISRAEL\n\nשלום,\n\nקיבלת הודעה חדשה!\n\nשם ושם משפחה: חנן פילוסוף\nכתובת , עיר : רמת גן\nטלפון: 0539672478\nכתובת הדואר האלקטרוני שלך: hnanfor@gmail.com\nהודעה (נשמח לפרטי הפנייה): דיברתי עם ברוך מעונין לקבל פרטים\nקבוצת תיבות סימון: עסק למכירה, רישום לקורס, ייעוץ / שאלה,\n\n\n\n\n\nהצג הודעה\n[https://app.site123.com/versions/2/wizard/messages/contact/index.php?w=815409&id=10495436]\n\nBSD-Business Brokers ISRAEL © 2026`;

const REAL_ORDER_CONFIRMATION_NOT_A_LEAD = `SITE123\n\nשלום Baruch,\n\nהתשלום עבור הזמנה מספר 106936347 אושר.\n\nתודה שבחרת ב-SITE123!`;

// ---------- 1. ליד חדש של קונה (תבנית ישנה) ----------
Deno.test('parses a real buyer lead email correctly (old template)', () => {
  const p = parseSite123Body(REAL_BUYER_EMAIL_OLD);
  assertEquals(p.recognizedTemplate, true);
  assertEquals(p.fullName, 'שי צור');
  assertEquals(p.city, 'חיפה');
  assertEquals(p.phone, '0525245601');
  assertEquals(p.email, 'shaytzur@gmail.com');
  assertEquals(p.checkboxes, ['לקנות עסק']);
  assertEquals(p.message, 'שכיר. מעונין לבדוק אפשרות רכישת עסק רווחי בבעלות פסיבית.');

  const c = classifyPurpose(p.checkboxes, p.message);
  assertEquals(c.type, 'buyer');
  assertEquals(c.classification, 'buyer');
  assertEquals(c.needsReview, false);
});

// ---------- 2. ליד חדש של מוכר (תבנית ישנה, שדה תאריך ריק לא שובר את הפרסינג) ----------
Deno.test('parses a real seller lead email, tolerates empty trailing date field (old template)', () => {
  const p = parseSite123Body(REAL_SELLER_EMAIL_OLD_EMPTY_DATE);
  assertEquals(p.fullName, 'תמי מינטוס');
  assertEquals(p.city, 'סביון');
  assertEquals(p.phone, '0522514738');
  assertEquals(p.email, 'tami@mintus.co.il');
  assertEquals(p.checkboxes, ['למכור עסק']);
  assertEquals(p.message, 'מייצגת את אחי שמעוניין למכור את העסק שלו');

  const c = classifyPurpose(p.checkboxes, p.message);
  assertEquals(c.type, 'seller');
  assertEquals(c.classification, 'seller');
  assertEquals(c.needsReview, false);
});

// ---------- 3. פנייה לקורס (תבנית ישנה) - מסווגת כ"מתעניין בקורס", לא "דורש בדיקה" ולא "קונה" ----------
Deno.test('course signup (old template) classifies as training, never guessed as buyer', () => {
  const p = parseSite123Body(REAL_COURSE_SIGNUP_OLD_EMPTY_MSG_AND_DATE);
  assertEquals(p.fullName, 'דניאל דעוס');
  assertEquals(p.phone, '0542641999');
  assertEquals(p.email, 'danieldais45@gmail.com');
  assertEquals(p.checkboxes, ['רישום לקורס']);
  assertEquals(p.message, '');

  const c = classifyPurpose(p.checkboxes, p.message);
  assertEquals(c.classification, 'training');
  assertEquals(c.needsReview, false);
});

// ---------- 4. ליד עם טקסט חופשי (כולל תווים מיוחדים) לא נחתך/נשבר ----------
Deno.test('free-text message with punctuation is captured in full', () => {
  const p = parseSite123Body(REAL_BUYER_EMAIL_OLD);
  assertStrictEquals(p.message.includes('רכישת עסק רווחי בבעלות פסיבית'), true);
});

// ---------- 5/6. אדם קיים במערכת + שני מיילים מאותו אדם -> לא נוצר כרטיס כפול ----------
Deno.test('duplicate detection: exact phone match on an existing lead is found, no double record', () => {
  const candidates = [
    { id: 'lead-1', phone: '052-524-5601', phone2: null, email: 'old@example.com', updated_at: '2026-01-01T00:00:00Z' },
    { id: 'lead-2', phone: '0500000000', phone2: null, email: 'someoneelse@example.com', updated_at: '2026-01-02T00:00:00Z' }
  ];
  const dup = findDuplicate('0525245601', 'shaytzur@gmail.com', candidates);
  assertEquals(dup?.id, 'lead-1');
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

Deno.test('an order-confirmation email (new-template era) is correctly rejected even though sender matches', () => {
  const subject = 'שלום Baruch, ההזמנה שלך ב-SITE123 הושלמה!';
  assertEquals(isSite123LeadEmail('info@site123.com', subject), false);
});

Deno.test('support-ticket emails (different sender) are correctly rejected even with lead-like content', () => {
  assertEquals(isSite123LeadEmail('support-tickets@site123.com', 'קיבלת הודעה חדשה מהאתר שלך: משהו'), false);
});

Deno.test('a real lead email is correctly accepted', () => {
  assertEquals(isSite123LeadEmail('info@site123.com', 'קיבלת הודעה חדשה מהאתר שלך: BSD-Business Brokers ISRAEL - 6a85f8fa2edcf'), true);
});

// ---------- 8. תבנית חדשה (23.08.2026+): מוכר בודד ----------
Deno.test('parses a real seller lead email correctly (new checkbox-based template)', () => {
  const p = parseSite123Body(REAL_SELLER_EMAIL_NEW);
  assertEquals(p.recognizedTemplate, true);
  assertEquals(p.fullName, 'דוד בושדיד');
  assertEquals(p.city, 'בית דגן');
  assertEquals(p.phone, '053-4248089');
  assertEquals(p.email, 'z039524488@gmail.com');
  assertEquals(p.message, 'נשמח לדבר');
  assertEquals(p.checkboxes, ['עסק למכירה']);

  const c = classifyPurpose(p.checkboxes, p.message);
  assertEquals(c.classification, 'seller');
  assertEquals(c.needsReview, false);
});

// ---------- 9. תבנית חדשה: כמה תיבות סומנו בו-זמנית, כולל קורס - קורס גובר, שאר הבחירות נשמרות ----------
Deno.test('new template: multiple checkboxes selected at once (business-sale + course + question) - course wins classification, ALL checkboxes preserved verbatim', () => {
  const p = parseSite123Body(REAL_MULTI_SELECT_WITH_COURSE_NEW);
  assertEquals(p.fullName, 'חנן פילוסוף');
  assertEquals(p.city, 'רמת גן');
  assertEquals(p.checkboxes, ['עסק למכירה', 'רישום לקורס', 'ייעוץ / שאלה']);

  const c = classifyPurpose(p.checkboxes, p.message);
  assertEquals(c.classification, 'training'); // קורס גובר על "עסק למכירה" שגם סומן
  assertEquals(c.needsReview, false);
  // שתי הבחירות האחרות עדיין קיימות ב-checkboxes המקוריים - לא נמחקו/הוחלפו
  assertEquals(p.checkboxes.includes('עסק למכירה'), true);
  assertEquals(p.checkboxes.includes('ייעוץ / שאלה'), true);
});

// ---------- 10. תבנית חדשה: הודעת הזמנה/חשבונית לא נחשבת ליד, גם אם מגיעה מאותו שולח ----------
Deno.test('new-template-era billing email is not treated as a lead by isSite123LeadEmail (subject mismatch)', () => {
  assertEquals(isSite123LeadEmail('info@site123.com', 'שלום Baruch, ההזמנה שלך ב-SITE123 הושלמה!'), false);
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

// ---------- לא מזוהה בוודאות (לא קורס/מכירה/קנייה/שותפות) -> unclassified, לא ברירת מחדל "קונה" ----------
Deno.test('unrecognized checkbox content classifies as unclassified with needsReview, never silently guessed as buyer', () => {
  const c = classifyPurpose(['ייעוץ / שאלה'], 'שאלה כללית');
  assertEquals(c.classification, 'unclassified');
  assertEquals(c.needsReview, true);
  // type הטכני עדיין 'buyer' רק כי ה-DB enum מחייב ערך - זה לא "ניחוש", ולוגיקת
  // התצוגה (guessLabel ב-index.ts) חייבת להציג "דורש בדיקה" ולא "מחפש לקנות עסק"
  assertEquals(c.type, 'buyer');
});

// ---------- משקיע -> partner ----------
Deno.test('investor checkbox/message classifies as partner', () => {
  const c1 = classifyPurpose(['משקיע'], 'מעוניין להשקיע בעסק פעיל');
  assertEquals(c1.classification, 'partner');
  assertEquals(c1.needsReview, false);
  const c2 = classifyPurpose([], 'מחפש הזדמנות השקעה');
  assertEquals(c2.classification, 'partner');
});

// ---------- עזר: last9Digits מנרמל פורמטים שונים לאותה תוצאה ----------
Deno.test('last9Digits normalizes different Israeli phone formats to the same value', () => {
  const forms = ['0525245601', '052-524-5601', '+972525245601', '972-52-524-5601', '(052) 524-5601'];
  const normalized = forms.map(last9Digits);
  for (const n of normalized) assertEquals(n, '525245601');
});

// ============================================================================
// בדיקות שם התצוגה (19.08.2026, עודכנו 23.08.2026 לתמוך בשתי התבניות)
// ============================================================================

Deno.test('resolveDisplayName never returns the mailbox owner name, even if somehow extracted', () => {
  assertEquals(resolveDisplayName('ברוך איזון'), 'שם לא זוהה');
  assertEquals(resolveDisplayName('BSD'), 'שם לא זוהה');
  assertEquals(resolveDisplayName('BSD-Business Brokers Israel'), 'שם לא זוהה');
});

Deno.test('resolveDisplayName keeps a real customer name untouched, even when it shares a word with a forbidden name', () => {
  assertEquals(resolveDisplayName('ברוך כהן'), 'ברוך כהן');
  assertEquals(resolveDisplayName('יבגני אריה'), 'יבגני אריה');
});

Deno.test('resolveDisplayName: no name in the form at all -> "שם לא זוהה", never invented', () => {
  assertEquals(resolveDisplayName(''), 'שם לא זוהה');
  assertEquals(resolveDisplayName('   '), 'שם לא זוהה');
});

Deno.test('scenario (old template): technical sender is BSD/Baruch but the form itself names a different customer - the customer name wins', () => {
  const email = `שלום, קיבלת הודעה חדשה! שם ושם משפחה: משה לוי כתובת מגורים, עיר: אשדוד טלפון: 0521112222 כתובת הדואר האלקטרוני שלך: moshe@example.com מטרת הפנייה: לקנות עסק, הודעה (מומלץ לרשום כמה מילים): מחפש עסק בתחום המזון שדה תאריך: 19/08/2026`;
  const p = parseSite123Body(email);
  const display = resolveDisplayName(p.fullName);
  assertEquals(display, 'משה לוי');
  assertEquals(isForbiddenName(display), false);
});

Deno.test('scenario (old template): lead with no name field filled -> displays as שם לא זוהה, not blank and not the mailbox owner', () => {
  const email = `שלום, קיבלת הודעה חדשה! שם ושם משפחה: כתובת מגורים, עיר: ראשון לציון טלפון: 0538889999 כתובת הדואר האלקטרוני שלך: noname@example.com מטרת הפנייה: לקנות עסק, הודעה (מומלץ לרשום כמה מילים): מתעניין שדה תאריך:`;
  const p = parseSite123Body(email);
  assertEquals(p.fullName, '');
  const display = resolveDisplayName(p.fullName);
  assertEquals(display, 'שם לא זוהה');
});

Deno.test('scenario (old template): buyer lead end-to-end field extraction matches classification', () => {
  const email = `שם ושם משפחה: דנה כץ כתובת מגורים, עיר: רעננה טלפון: 0541234567 כתובת הדואר האלקטרוני שלך: dana@example.com מטרת הפנייה: לקנות עסק, הודעה (מומלץ לרשום כמה מילים): מחפשת עסק ברשתות שיווק שדה תאריך: 19/08/2026`;
  const p = parseSite123Body(email);
  const c = classifyPurpose(p.checkboxes, p.message);
  assertEquals(resolveDisplayName(p.fullName), 'דנה כץ');
  assertEquals(c.type, 'buyer');
});

Deno.test('scenario (old template): seller lead end-to-end field extraction matches classification', () => {
  const email = `שם ושם משפחה: אבי לוי כתובת מגורים, עיר: נתניה טלפון: 0549876543 כתובת הדואר האלקטרוני שלך: avi.seller@example.com מטרת הפנייה: למכור עסק, הודעה (מומלץ לרשום כמה מילים): מוכר מסעדה שדה תאריך: 19/08/2026`;
  const p = parseSite123Body(email);
  const c = classifyPurpose(p.checkboxes, p.message);
  assertEquals(resolveDisplayName(p.fullName), 'אבי לוי');
  assertEquals(c.type, 'seller');
});

Deno.test('scenario: duplicate lead by phone is correctly identified as a merge candidate, keeping the existing record\'s own name unchanged', () => {
  const existingCandidates = [
    { id: 'existing-1', full_name: 'לקוח קיים', phone: '054-1112222', phone2: null, email: 'old@example.com', updated_at: '2026-01-01T00:00:00Z' }
  ];
  const dup = findDuplicate('0541112222', 'newemail@example.com', existingCandidates);
  assertEquals(dup?.id, 'existing-1');
  assertEquals(dup?.full_name, 'לקוח קיים');
});
