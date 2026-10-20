// BSD CRM - generate-anonymous-card: pure helpers (no I/O), split out on
// 06.10.2026 so they can be unit-tested (tests/two_box_edge_test.ts).
// Region map is mirrored 1:1 in businesses.html between the same markers.

// ---------- שלב 1: בניית הקלט ל-AI ----------
// הכפתור עובד על מה שכתוב כרגע על המסך, לא על מה ששמור במסד. הדפדפן שולח
// body.form. 20.10.2026: נשלחים כל מקורות הכרטיס (כל המידע, תקציר פנימי,
// הערות, חקר מקדים, סיבת מכירה, שיחות, פגישות, כרטיס המוכר והטקסט האנונימי).
// קובץ ששמו מכיל «אנונימי» הוא הבסיס ונשלח ראשון (BASE_FILE_INSTRUCTION).
// מזהים (שם, טלפון, עיר, כתובת, ח.פ) מנוקים מהטקסט לפני ה-AI.
// כשדות מובנים לא נשלחים: עיר, כתובת, רווח תפעולי/נקי, שם העסק/הבעלים/טלפון.
// מחיר מבוקש נשלח רק אם "הצג מחיר" מסומן.
// בלי body.form (קריאה ישנה) - הטקסטים נלקחים מהערכים השמורים במסד.
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

export type AnonExtras = {
  // סיכומי שיחות טלפון (phone_calls של הליד-מוכר), סיכומי פגישות (match_meetings),
  // ושדות סיכום מכרטיס הליד של המוכר. הכל פנימי - עובר ניקוי מזהים לפני ה-AI.
  calls?: string[];
  meetings?: string[];
  leadTexts?: string[];
};

export type AnonInput = {
  sourceLabel: string | null;
  sourceText: string;
  field: string;
  category: string;
  region: string;
  facts: string[];
};

const MAX_SECTION = 14000;
function clip(s: string, n = MAX_SECTION): string {
  return s.length > n ? s.slice(0, n) + '\n[...קוצר לאורך]' : s;
}

// 20.10.2026 (ברוך): ניקוי מזהים *לפני* שליחה ל-AI - שכבת הגנה ראשונה. שם העסק,
// הבעלים, טלפונים, מיילים, אתרים, ח.פ, כתובת ועיר מוחלפים בסימון ניטרלי, כך
// שה-AI לא יכול להעתיק אותם גם אם הם כתובים בכל המידע/ההערות/החקר.
// מילים מזהות משם הבעלים: רק החלק הראשון (לפני + ( , / –), מילים בנות 3+ אותיות
// שאינן מילים כלליות - כדי שלא לסמן "חברה"/"ואח"/"משפחת" כמזהה.
const OWNER_STOP = new Set(['חברה', 'משקיעה', 'משקיע', 'ואח', 'ואחים', 'משפחת', 'משפחה', 'שותף', 'שותפים', 'בעלים', 'בע"מ', 'בעמ']);
export function ownerNameTokens(owner: unknown): string[] {
  const s = typeof owner === 'string' ? owner.trim() : '';
  if (!s) return [];
  const head = s.split(/[+(,/–—-]/)[0].trim();
  const out: string[] = [];
  if (head.length >= 3) out.push(head);
  head.split(/\s+/).map(w => w.replace(/["״'׳.]/g, '')).forEach(w => { if (w.length >= 3 && !OWNER_STOP.has(w)) out.push(w); });
  return out;
}

export function redactIdentifiers(text: string, biz: Record<string, unknown>): string {
  if (!text) return text;
  let t = text;
  t = t.replace(/https?:\/\/\S+/gi, '[קישור הוסר]').replace(/www\.\S+/gi, '[קישור הוסר]');
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[אימייל הוסר]');
  t = t.replace(/\b[a-z0-9][\w-]*(\.[\w-]+)*\.(com|co\.il|org\.il|org|net|il|io|biz|info)\b\S*/gi, '[קישור הוסר]');
  t = t.replace(/(\+?972[-\s]?|0)\d{1,2}[-\s]?\d{3}[-\s]?\d{4}/g, '[טלפון הוסר]');
  t = t.replace(/(?<!\d)5\d{8}(?!\d)/g, '[ח.פ הוסר]');
  const idn = str(biz.id_number);
  const exact: string[] = [];
  const name = str(biz.internal_name);
  if (name) {
    exact.push(name, name.replace(/\s*בע["״']?מ\s*$/, ''));
    const first = name.split(/\s+/)[0].replace(/["״'׳]/g, '');
    if (first.length >= 3) exact.push(first);
  }
  for (const k of ['owner_name', 'anonymous_name', 'address', 'website', 'owner_email', 'owner_phone']) {
    const v = str(biz[k]);
    if (v.length >= 3) exact.push(v);
  }
  ownerNameTokens(biz.owner_name).forEach(w => exact.push(w));
  if (idn.length >= 5) exact.push(idn);
  exact.sort((a, b) => b.length - a.length).forEach(v => {
    t = t.replace(new RegExp(escapeRe(v), 'gi'), '[מזהה הוסר]');
  });
  const city = str(biz.city);
  if (city.length >= 2) {
    t = t.replace(new RegExp(`(^|[^\\u0590-\\u05FF])([ובלמהשכ]{0,2})${escapeRe(city)}(?=$|[^\\u0590-\\u05FF])`, 'g'), '$1$2[יישוב הוסר]');
  }
  return t;
}

export function buildAnonInput(biz: Record<string, unknown>, form: unknown, extras: AnonExtras = {}): AnonInput {
  const f = (form && typeof form === 'object') ? form as Record<string, unknown> : null;
  const pick = (key: string, dbKey = key): string => (f && filled(f[key])) ? str(f[key]) : str(biz[dbKey]);
  const pickBool = (key: string, dbKey: string): boolean => (f && typeof f[key] === 'boolean') ? f[key] as boolean : !!biz[dbKey];
  // תיבה שקיימת במסך (מחרוזת, גם ריקה) - מה שבמסך קובע; לא במסך (null) - מהמסד.
  const box = (key: string, dbKey: string): string => (f && typeof f[key] === 'string') ? str(f[key]) : str(biz[dbKey]);

  // 20.10.2026 (ברוך, 21:18): קוראים את *כל* הכרטיס - לא רק מקור אחד.
  const sections: Array<[string, string]> = [
    ['כל המידע על העסק', box('description', 'short_description')],
    ['תקציר עסקי פנימי', box('internal_summary', 'internal_business_summary')],
    ['הערות פנימיות', box('notes', 'notes')],
    ['חקר מקדים (דנה) - פריטים המסומנים "לא מאומת" אסור לפרסם', box('pre_research', 'pre_research')],
    ['סיבת מכירה (רקע פנימי בלבד)', pick('sale_reason')],
    ...(extras.calls || []).filter(filled).map((c, i) => [`סיכום שיחה טלפונית ${i + 1}`, str(c)] as [string, string]),
    ...(extras.meetings || []).filter(filled).map((c, i) => [`סיכום פגישה ${i + 1}`, str(c)] as [string, string]),
    ...(extras.leadTexts || []).filter(filled).map((c, i) => [`מידע מכרטיס המוכר ${i + 1}`, str(c)] as [string, string]),
    ['טקסט קיים בתיבת התקציר האנונימי', box('anon_text', 'anon_summary')],
  ];
  const parts = sections.filter(([, v]) => filled(v)).map(([k, v]) => `=== ${k} ===\n${clip(redactIdentifiers(v, biz))}`);
  const sourceText = parts.join('\n\n');
  const sourceLabel = parts.length ? 'כל הכרטיס (פנימי - חייב לעבור אנונימיזציה מלאה)' : null;

  const showPrice = pickBool('show_price', 'anon_card_show_price');
  const showReason = pickBool('show_reason', 'anon_card_show_reason');
  const facts: string[] = [];
  const sub = pick('subcategory');
  if (sub) facts.push(`תת-קטגוריה: ${sub}`);
  const entity = pick('entity_type');
  if (entity) facts.push(`סוג ישות: ${entity}`);
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
  facts.push(showReason ? 'מותר לציין סיבת מכירה (בעדינות, בלי פרטים אישיים)' : 'אסור לציין סיבת מכירה');
  facts.push(showPrice ? 'מחיר: רק כפי שמופיע בשורה "מחיר מבוקש"' : 'אסור לציין מחיר מבוקש, שווי, הערכת שווי או שווי כניסת משקיע');

  const cityForRegion = (f && filled(f.city_for_region)) ? str(f.city_for_region) : str(biz.city);
  const region = effectiveRegion(pick('region'), cityForRegion);
  return { sourceLabel, sourceText, field: pick('field'), category: pick('category'), region, facts };
}

// 20.10.2026 21:24 (ברוך): אם בקבצי הכרטיס יש קובץ ששמו מכיל «אנונימי» - הוא הבסיס.
export const BASE_FILE_INSTRUCTION = `סדר עדיפות למקורות: מצורף קובץ תקציר אנונימי קיים מקבצי הכרטיס. הוא הבסיס של התקציר - שמור על כל התוכן, הנתונים והמסרים שלו (אל תקצר), ואז השלם, עדכן ושפר אותו בעזרת שאר חומרי הכרטיס, לפי המבנה והכללים. בכל סתירה - הנתון העדכני מהכרטיס גובר. חשוב: תוכן הקובץ כפוף לכל הכללים בדיוק כמו שאר החומר, גם אם הקובץ עצמו מפר אותם - הסר ממנו כל אזכור של רווח/רווחי/רווחיות, מחיר מבוקש, שווי או הערכת שווי (אלא אם הותרו בבלוק הנתונים), דירוגי ביקורות, שמות, מיקום מדויק ופרטים מזהים.`;

export function buildAnonPrompts(input: AnonInput): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `אתה קופירייטר בכיר של משרד תיווך עסקים יוקרתי (BSD Business Brokers Israel). המשימה: לכתוב תקציר שיווקי אנונימי (teaser) של עסק למכירה, שיתפרסם באתר ויישלח לסוכנים ולקונים - מרשים, מקצועי ומעורר עניין ("וואו"), שקורא יבין ממנו לעומק מה העסק, למה הוא הזדמנות ולמי הוא מתאים - ובשום אופן לא יוכל לזהות אותו.

קרא את כל חומרי הכרטיס שלמטה (כל המידע, תקציר פנימי, הערות, חקר, סיכומי שיחות ופגישות) ואסוף מכולם כל עובדה מותרת. אל תתעלם מאף מקור. בכל סתירה - העדף את מה שנאמר בשיחה/ע"י ברוך על פני אתר/חקר.

מבנה anon_summary (טקסט רגיל בעברית, כותרת כל פרק בשורה נפרדת, שורה ריקה בין פרקים, נקודות מתחילות ב-"• "):
[שורה ראשונה: כותרת שיווקית חזקה בשורה אחת]
על העסק
(2-4 משפטים זורמים: מה העסק עושה, המוצר/השירות, המודל העסקי, הוותק.)
יתרונות וחוזקות
(4-7 נקודות • - הנכסים והיתרונות התחרותיים הממשיים מהחומר.)
שוק וצמיחה
(צבר הזמנות, מגמת צמיחה, ביקוש, ערוצי שיווק ומכירה - רק מה שקיים בחומר.)
תפעול ונכסים
(מתחם/שטח, ציוד, צוות, שרשרת ייצור/שירות, מצב התחייבויות - ככל שקיים.)
מה מוצע לעסקה
(מה ניתן לרכוש - כל העסק/חלק/שותפות, מבנה כללי. בלי מחיר ושווי אלא אם הותר בבלוק הנתונים.)
הקונה האידיאלי
(1-3 משפטים: איזה סוג רוכש/משקיע יפיק מזה הכי הרבה - נגזר מהעובדות, לא דמיוני.)
לפרטים נוספים
(משפט סיום: פרטים מלאים, דוחות וביקור במקום - לאחר חתימה על הסכם סודיות מול BSD.)
אם אין שום מידע לפרק מסוים - השמט את הפרק (אל תמלא בהכללות ריקות).

כללים מחייבים, בלי יוצא מן הכלל:
1. סגנון: שיווקי, מכובד, בטוח ומקצועי, משפטים מלאים, בלי סופרלטיבים ריקים ובלי קלישאות. אל תקצר: כל עובדה מהותית ומותרת שמופיעה בחומר צריכה להיכנס.
2. אל תמציא שום נתון, מספר, יתרון, לקוח או הבטחה. כל מספר מותר נכתב בדיוק כמו במקור (בלי עיגול). מספר מסומן (?) - אל תשתמש בו.
3. רווחיות - אסור לחלוטין: רווח, רווחיות, תשואה, שולי רווח, וגם משיכות בעלים/משכורות בעלים או כל מספר שממנו אפשר לגזור רווח. מחזור וצבר הזמנות - מותרים.
4. מיקום: רק האזור שבשורה "אזור" למטה, כפי שהוא. אסור עיר/יישוב/מועצה/שכונה/רחוב/כתובת/ציון דרך/"ליד..."/"סמוך ל...". אם לא סופק אזור - אל תציין מיקום כלל (מותר "בישראל").
5. אסור: שם העסק או מותג, שמות אנשים (בעלים, בני משפחה, עובדים, משקיעים, סוכנים), שמות לקוחות/ספקים/מוסדות, טלפון, אימייל, אתר, רשת חברתית, ח.פ, מספרי תיקים, ציוני ביקורות ושמות אתרי ביקורות, שנת הקמה מדויקת, ופרט ייחודי מדי שמזהה (למשל "היחיד בארץ").
6. אסור לחלוטין: תיקים משפטיים, תביעות, חובות, דוחות שלא הוגשו, מחלוקות, בעיות - וכל פריט שמסומן בחומר "לא מאומת"/"לבדיקה"/"טענות האתר".
7. אסור: שאלות לפגישה, משימות פנימיות, מועדי פגישות, הערות צוות, ציטוטים אישיים או דעות של הבעלים על תהליך המכירה.
8. מבנה בעלות פנימי (אחוזים, משקיע, משפחה) - אסור לפרט; מותר רק לומר כללית "ניתן לרכוש את העסק כולו או חלק ממנו" אם זה מופיע בחומר.
9. מחיר / שווי / סיבת מכירה - לפי ההוראות בבלוק הנתונים בלבד.
10. סימונים בסוגריים מרובעים כמו [מזהה הוסר] - מידע שהוסר בכוונה; אל תנסה לשחזר אותו ואל תזכיר אותו.
11. בלי Markdown (בלי **, בלי #).
12. anon_display_name: כותרת קצרה וגנרית לפי התחום (3-8 מילים), למשל "מפעל לבנייה מתועשת עם צבר הזמנות גבוה" - לא שם אמיתי.
13. בסוף קרא שוב והסר כל הפרה. ai_flagged_concerns - רק חשש שעדיין נשאר בטקסט הסופי ודורש בדיקה אנושית; אל תרשום שם מה הסרת (בדרך כלל מערך ריק).
14. אם אין מספיק מידע אמין - החזר anon_summary=null.

חובה להשתמש בכלי submit_anonymous_card כדי להחזיר את התשובה.`;

  const userPrompt = `נתונים מובנים מהכרטיס:
תחום: ${input.field || '(לא צוין)'}
קטגוריה: ${input.category || '(לא צוין)'}
אזור: ${input.region || '(לא צוין - אל תציין מיקום)'}
${input.facts.join('\n')}

חומרי הכרטיס - ${input.sourceLabel}:
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
    ['ח.פ', biz.id_number], ['טלפון בעלים', biz.owner_phone], ['אימייל בעלים', biz.owner_email],
  ];
  // 20.10.2026: גם המילה הייחודית הראשונה בשם העסק (למשל "עופרים") ושמות הבעלים
  const nm = typeof biz.internal_name === 'string' ? biz.internal_name.trim().split(/\s+/)[0].replace(/["״'׳]/g, '') : '';
  if (nm.length >= 3) identifiers.push(['שם העסק (מילה)', nm]);
  ownerNameTokens(biz.owner_name).forEach(w => identifiers.push(['שם הבעלים (מילה)', w]));
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
