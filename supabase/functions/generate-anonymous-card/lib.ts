// BSD CRM - generate-anonymous-card: pure helpers (no I/O), split out on
// 06.10.2026 so they can be unit-tested (tests/two_box_edge_test.ts).
// Region map is mirrored 1:1 in businesses.html between the same markers.

// ---------- שלב 1: בניית הקלט ל-AI (06.10.2026, בקשת ברוך) ----------
// הכפתור עובד על מה שכתוב כרגע על המסך, לא על מה ששמור במסד. הדפדפן שולח
// body.form. סדר עדיפות לטקסט המקור (עודכן 06.10.2026 15:22, אושר ע"י ברוך):
//   1. "כל המידע על העסק" (short_description) - התיבה המלאה
//   2. התקציר העסקי הפנימי הישן (אם התיבה המלאה ריקה)
//   3. הטקסט שכבר בתיבת התקציר האנונימי (מוצא אחרון)
// הערות (notes) לא נשלחות בכוונה - יש בהן לרוב מידע אישי על לידים/בירורים.
// לעולם לא נשלחים ל-AI: עיר, כתובת, רווח תפעולי/נקי, שם העסק/הבעלים/טלפון.
// מחיר מבוקש נשלח רק אם "הצג מחיר" מסומן, וסיבת מכירה רק אם סומנה.
// בלי body.form (קריאה ישנה) - הכל נלקח מהערכים השמורים במסד, באותו סדר.
function filled(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== '';
}
function str(v: unknown): string {
  return filled(v) ? String(v).trim() : '';
}
function fmtMoney(v: unknown): string {
  const raw = str(v);
  if (!raw) return '';
  const n = Number(raw.replace(/[,\s₪]/g, ''));
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-US')} ₪` : raw;
}

// ---------- אזור רחב לפי עיר (06.10.2026, אושר ע"י ברוך) ----------
// כשהשדה "אזור" ריק - גוזרים אזור רחב מהעיר בצד השרת. העיר עצמה לעולם לא
// נשלחת ל-AI; רק האזור הרחב. עיר שלא ברשימה = לא מציינים מיקום בכלל.
// הרשימה משוכפלת אחד-לאחד ב-businesses.html (בין אותם סמנים) - בדיקה ב-tests
// מוודאת ששתי הגרסאות זהות.
export const REGION_MAP: Record<string, string[]> = /*REGION_MAP_START*/{"אזור המרכז":["תל אביב","יפו","רמת גן","גבעתיים","בני ברק","חולון","בת ים","ראשון לציון","פתח תקווה","אור יהודה","יהוד","קריית אונו","גבעת שמואל","סביון","גני תקווה","ראש העין","אלעד","שוהם","מודיעין","לוד","רמלה","באר יעקב","כפר קאסם","גבעת השלושה","כפר חב\"ד"],"אזור השרון":["נתניה","הרצליה","רעננה","כפר סבא","הוד השרון","רמת השרון","אבן יהודה","כפר יונה","טייבה","טירה","קדימה","צורן","תל מונד","פרדסיה","כוכב יאיר","צור יגאל","קלנסווה","חדרה","אור עקיבא","פרדס חנה","כרכור","גליל ים","בית יצחק","עמק חפר"],"אזור השפלה":["רחובות","נס ציונה","יבנה","גדרה","גן יבנה","מזכרת בתיה","קריית עקרון","קריית מלאכי","באר טוביה","כפר אביב"],"אזור ירושלים":["ירושלים","בית שמש","מבשרת ציון","מעלה אדומים","גבעת זאב","אבו גוש","צור הדסה","ביתר עילית","מוצא"],"אזור הצפון":["חיפה","קריית אתא","קריית ביאליק","קריית מוצקין","קריית ים","טירת כרמל","נשר","יקנעם","יוקנעם","עכו","נהריה","כרמיאל","נצרת","נוף הגליל","נצרת עילית","עפולה","טבריה","צפת","קריית שמונה","בית שאן","מגדל העמק","שפרעם","טמרה","סכנין","סח'נין","אום אל פחם","זכרון יעקב","עתלית","קצרין","מעלות תרשיחא","קריית טבעון","רמת ישי","עראבה","דלית אל כרמל"],"אזור הדרום":["באר שבע","אשדוד","אשקלון","אילת","דימונה","ערד","שדרות","נתיבות","אופקים","קריית גת","רהט","ירוחם","מצפה רמון","להבים","עומר","מיתר"]}/*REGION_MAP_END*/;

export function normalizePlace(v: unknown): string {
  return String(v ?? '')
    .replace(/["'״׳`]/g, '')
    .replace(/[-–—_,.()]/g, ' ')
    .replace(/קרית/g, 'קריית')
    .replace(/תקוה/g, 'תקווה')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveRegionFromCity(city: unknown): string {
  const c = normalizePlace(city);
  if (c.length < 2) return '';
  for (const [region, cities] of Object.entries(REGION_MAP)) {
    for (const raw of cities) {
      const k = normalizePlace(raw);
      if (c === k || c.startsWith(k + ' ')) return region;
    }
  }
  return '';
}

// האזור שמותר לפרסם לעסק: שדה "אזור" אם מולא, אחרת אזור רחב לפי העיר.
export function effectiveRegion(region: unknown, city: unknown): string {
  const r = typeof region === 'string' ? region.trim() : '';
  return r || deriveRegionFromCity(city);
}

export type AnonInput = {
  sourceLabel: string | null;
  sourceText: string;
  field: string;
  category: string;
  region: string;
  facts: string[];
};

export function buildAnonInput(biz: Record<string, unknown>, form: unknown): AnonInput {
  const f = (form && typeof form === 'object') ? form as Record<string, unknown> : null;
  // ערך מהטופס אם מולא, אחרת מהמסד
  const pick = (key: string, dbKey = key): string => (f && filled(f[key])) ? str(f[key]) : str(biz[dbKey]);
  const pickBool = (key: string, dbKey: string): boolean => (f && typeof f[key] === 'boolean') ? f[key] as boolean : !!biz[dbKey];

  // שלוש תיבות הטקסט: אם התיבה קיימת על המסך (הטופס שלח מחרוזת, גם ריקה) - מה
  // שעל המסך קובע, וריקה = עוברים למקור הבא. רק תיבה שלא קיימת בטופס (null) -
  // נלקחת מהערך השמור במסד.
  const box = (key: string, dbKey: string): string => (f && typeof f[key] === 'string') ? str(f[key]) : str(biz[dbKey]);
  const anonText = box('anon_text', 'anon_summary');
  const internalText = box('internal_summary', 'internal_business_summary');
  const descText = box('description', 'short_description');

  // 06.10.2026 (אושר ע"י ברוך): התקציר האנונימי נכתב מתוך "כל המידע על העסק"
  // (short_description) קודם. רק אם הוא ריק - התקציר הפנימי הישן, ורק בסוף -
  // הטקסט שכבר נמצא בתיבה האנונימית.
  let sourceLabel: string | null = null, sourceText = '';
  if (descText) { sourceLabel = 'כל המידע על העסק (פנימי - חייב לעבור אנונימיזציה)'; sourceText = descText; }
  else if (internalText) { sourceLabel = 'התקציר העסקי הפנימי המלא (פנימי - חייב לעבור אנונימיזציה)'; sourceText = internalText; }
  else if (anonText) { sourceLabel = 'הטקסט שכתוב כרגע בתיבת התקציר האנונימי'; sourceText = anonText; }

  const showPrice = pickBool('show_price', 'anon_card_show_price');
  const showReason = pickBool('show_reason', 'anon_card_show_reason');

  const facts: string[] = [];
  const revenue = fmtMoney(pick('annual_revenue'));
  if (revenue) facts.push(`מחזור שנתי: ${revenue}`);
  const years = pick('years_active');
  if (years) facts.push(`שנות פעילות: ${years}`);
  const employees = pick('employees_count');
  if (employees) facts.push(`מספר עובדים: ${employees}`);
  if (showPrice) {
    const price = fmtMoney(pick('asking_price'));
    if (price) facts.push(`מחיר מבוקש: ${price}`);
  }
  if (showReason) {
    const reason = pick('sale_reason');
    if (reason) facts.push(`סיבת מכירה (לנסח בעדינות): ${reason}`);
  }

  // אזור: מהטופס/מהמסד; אם ריק - אזור רחב לפי העיר (city_for_region מהטופס או
  // העיר השמורה). העיר עצמה לא נכנסת ל-AnonInput ולא לפרומפט.
  const cityForRegion = (f && filled(f.city_for_region)) ? str(f.city_for_region) : str(biz.city);
  const region = effectiveRegion(pick('region'), cityForRegion);

  return { sourceLabel, sourceText, field: pick('field'), category: pick('category'), region, facts };
}

export function buildAnonPrompts(input: AnonInput): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `אתה כותב תוכן שיווקי עבור משרד תיווך עסקים (BSD Business Brokers Israel). המשימה: לכתוב תקציר אנונימי של עסק למכירה, שיתפרסם באתר ויישלח לקונים פוטנציאליים - בלי שאפשר יהיה לזהות את העסק.

מבנה התקציר (anon_summary), טקסט רגיל בעברית, פסקאות מופרדות בשורה ריקה:
1. פתיחה קצרה (1-2 משפטים) שמציגה את ההזדמנות.
2. תיאור העסק: מה הוא מציע, איך הוא נראה, הפעילות, סוג הלקוחות (באופן כללי), המתחם/השטח, הציוד והצוות - ככל שהמידע קיים.
3. נתונים מרכזיים: 3-6 שורות קצרות שמתחילות ב-"•" - רק הנתונים החשובים ביותר שסופקו (מחזור, שנות פעילות, עובדים, שטח, ציוד/תכולה, שכירות ותנאי חוזה, ומחיר מבוקש רק אם הוא מופיע בבלוק הנתונים). בגוף הטקסט אל תעמיס מספרים - שם מתארים במילים.
4. סיכום: 1-2 משפטים שסוגרים את ההזדמנות.

כללים מחייבים, בלי יוצא מן הכלל:
1. סגנון: שיווקי, עדין, זורם ומכובד - לא מוגזם ולא בצורת טופס. אל תקצר יותר מדי: שמור על כל המידע המהותי מהמקור שמותר לפרסום. מותר להשאיר משפטים שהמשתמש כתב אם הם טובים ומותרים לפרסום.
2. רווחיות - אסור לחלוטין: אל תכתוב רווח, רווחיות, רווח נקי, רווח תפעולי, תשואה, שולי רווח או כל מספר שמתאר רווח - גם אם זה מופיע בטקסט המקור. מחזור - מותר.
3. מיקום: מותר רק האזור שמופיע בשורה "אזור" למטה, כפי שהוא. אסור עיר, יישוב, שכונה, רחוב, כתובת, שם קניון/מתחם, ציון דרך או "סמוך ל..." - גם אם מופיעים במקור. אם לא סופק אזור - אל תציין מיקום בכלל.
4. אסור שיופיע: שם העסק, שם הבעלים או כל אדם, שמות עובדים, לקוחות או ספקים, מותג ייחודי, טלפון, אימייל, אתר, קישור, רשת חברתית, ח.פ., או פרט ייחודי מדי שמזהה את העסק (למשל "היחיד מסוגו בעיר").
5. מחיר מבוקש: רק אם מופיע בבלוק הנתונים למטה. אם לא מופיע שם - אל תזכיר מחיר בכלל, גם אם הוא כתוב בטקסט המקור. סיבת מכירה - רק אם מופיעה בבלוק הנתונים.
6. אל תמציא שום נתון, מספר או יתרון שלא סופק. נתונים שמותרים לפרסום (מחזור, שכירות ותנאי חוזה - למשל אחוז מהמחזור, שטח, ציוד) נכתבים כפי שהם במקור - בלי לעגל, בלי להחליף בניסוח כללי ובלי להשמיט.
7. בלי סימוני Markdown (בלי **, בלי #).
8. anon_display_name: ביטוי גנרי קצר לפי תחום הפעילות בלבד - לא שם אמיתי.
9. בסוף, קרא שוב את מה שכתבת: אם נשאר חשש להפרת אחד הכללים, רשום אותו ב-ai_flagged_concerns והסר את הפרט מהטקסט.
10. אם אין מספיק מידע אמין - החזר anon_summary=null.

חובה להשתמש בכלי submit_anonymous_card כדי להחזיר את התשובה.`;

  const userPrompt = `נתונים מובנים מהכרטיס (מותרים לפרסום):
תחום: ${input.field || '(לא צוין)'}
קטגוריה: ${input.category || '(לא צוין)'}
אזור: ${input.region || '(לא צוין - אל תציין מיקום)'}
${input.facts.length ? input.facts.join('\n') : '(אין נתונים כמותיים נוספים)'}

טקסט המקור - ${input.sourceLabel}:
"""
${input.sourceText}
"""`;
  return { systemPrompt, userPrompt };
}

// ---------- שלב 2: רשת ביטחון מקומית, לא תלויה ב-AI (תמיד רצה) ----------
export function localSafetyScan(text: string, biz: Record<string, unknown>): string[] {
  const hits: string[] = [];
  if (!text) return hits;
  const lower = text.toLowerCase();

  // דפוסים כלליים: טלפון ישראלי, אימייל, URL
  if (/0\d{1,2}[-\s]?\d{7}/.test(text)) hits.push('נמצא דפוס שנראה כמספר טלפון');
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text)) hits.push('נמצא דפוס שנראה כאימייל');
  if (/(https?:\/\/|www\.)/i.test(text)) hits.push('נמצא דפוס שנראה כקישור/אתר');

  // התאמה ישירה לזיהויים אמיתיים של העסק (רק מזהים בני 3+ תווים, כדי לא ליפול על מילים כלליות)
  const identifiers: Array<[string, unknown]> = [
    ['שם העסק', biz.internal_name], ['שם אנונימי קיים', biz.anonymous_name],
    ['שם הבעלים', biz.owner_name], ['כתובת', biz.address], ['אתר', biz.website],
  ];
  identifiers.forEach(([label, val]) => {
    const v = typeof val === 'string' ? val.trim() : '';
    if (v.length >= 3 && lower.includes(v.toLowerCase())) hits.push(`"${v}" (${label}) מופיע בטקסט`);
  });

  // 06.10.2026: עיר העסק - מותר רק אזור. אם שם העיר הוא חלק מהאזור המותר
  // לעסק (שדה "אזור", או האזור הרחב שנגזר מהעיר - למשל עיר "ירושלים" ואזור
  // "אזור ירושלים") - לא מסמנים, כי האזור מותר.
  const city = typeof biz.city === 'string' ? biz.city.trim() : '';
  const region = effectiveRegion(biz.region, biz.city);
  if (city.length >= 2 && !(region && region.includes(city)) && hasHebrewWord(text, city)) {
    hits.push(`העיר "${city}" מופיעה בטקסט - יש להשאיר רק אזור (למשל "${region || 'אזור המרכז'}")`);
  }

  // כתובת / רחוב / שכונה
  if (/(^|[^\u0590-\u05FF])(ב|ו|וב)?(רחוב|רח['׳]|שד['׳]|שדרות)\s+[^\s\d,.]{2,}(\s+[^\s\d,.]{2,})?\s+\d{1,4}(?!\d)/.test(text)) {
    hits.push('נמצא דפוס שנראה כמו כתובת (רחוב ומספר) - יש להסיר');
  }
  if (/(^|[^\u0590-\u05FF])(ב|ו|וב)?שכונת\s+(?!מגורים)[\u0590-\u05FF]/.test(text)) {
    hits.push('נמצא שם שכונה ("שכונת ...") - יש להשאיר רק אזור');
  }
  if (/(^|[^\u0590-\u05FF])(ב|ו|וב|ה)?כתובת(?=$|[^\u0590-\u05FF])/.test(text)) {
    hits.push('נמצאה המילה "כתובת" - אסור לציין כתובת');
  }

  // רווח / רווחיות - לא מפרסמים בכלל (מחזור מותר)
  if (PROFIT_WORD_RE.test(text) || /\b(profit|ebitda)\b/i.test(text)) {
    hits.push('נמצא אזכור של רווח/רווחיות - לא מפרסמים רווחיות, יש להסיר (מחזור מותר)');
  }

  return hits;
}

// "רווח" ונגזרותיו (רווחי, רווחיות, רווחים, ריווחיות, ברווח...) - אבל לא "מרווח"
// (=מרווח, ספייס) ולא "רווחה".
export const PROFIT_WORD_RE = /(^|[^\u0590-\u05FF])(ו|ה|ב|ל|ש|כ|וה|וב|של|שה)?רי?ווח(ים|יות|ית|יים|י|יו)?(?=$|[^\u0590-\u05FF])/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// מילה בעברית כמילה שלמה, עם אותיות שימוש אפשריות לפניה (ב, ל, מ, ה, ו, ש, כ)
export function hasHebrewWord(text: string, word: string): boolean {
  const re = new RegExp(`(^|[^\\u0590-\\u05FFa-zA-Z0-9])[ובלמהשכ]{0,2}${escapeRe(word)}(?=$|[^\\u0590-\\u05FFa-zA-Z0-9])`, 'i');
  return re.test(text);
}
