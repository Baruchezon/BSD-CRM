// מנוע «התאמות AI חכמות» (v6, 05.10.2026, בקשת ברוך).
// קובץ JS טהור בלי תלות ב-Deno/דפדפן: הפונקציה index.ts מייבאת אותו, והבדיקות מריצות אותו ב-node.
// לא נשלחים נתונים לשום שירות חיצוני ולא נדרש מפתח בתשלום - הניתוח כולו מקומי:
//   * לומד את כל העסקים הפעילים (שדות, מספרים, תיאור, תקציר אנונימי, סיכום פנימי, הערות)
//   * לומד את כל הקונים הפעילים (מה ביקשו, הערות, אזור, תקציב - גם כשהתקציב כתוב רק בהערות)
//   * מציע רק צירופים שאינם כבר בטבלת ההתאמות, ורק מ-50% ומעלה
//   * לכל הצעה: משפט סיכום, "למה זה מתאים", "מה לא מתאים / לשים לב", ו"איך הגענו לאחוז" - בעברית פשוטה.

export const ENGINE_VERSION = 6;
export const MIN_SCORE = 50;

// ---------------------------------------------------------------------------
// נרמול טקסט עברי
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, '')            // ניקוד וטעמים
    .replace(/[ךםןףץ]/g, c => FINALS[c])
    .replace(/["'״׳`]/g, '')
    .replace(/([\u05d0-\u05ea])\1+/g, '$1');      // מאפייה -> מאפיה (רק אותיות עבריות, לא ספרות)
}
export function tokens(s) {
  return norm(s).replace(/[^\u05d0-\u05eaa-z0-9]+/g, ' ').split(' ').filter(Boolean);
}
const PREFIXES = ['', 'ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ', 'וה', 'וב', 'ול', 'ומ', 'שה', 'שב', 'לה', 'מה', 'בה', 'כש', 'וש'];
// האם המילה (token) היא צורה של מילת המפתח: עם תחילית (ו/ה/ב/ל/מ/ש) ועם סיומת קצרה (ים/ות/יה...)
function tokenIs(token, kw) {
  for (const p of PREFIXES) {
    if (p && !token.startsWith(p)) continue;
    const rest = token.slice(p.length);
    if (!rest.startsWith(kw)) continue;
    const extra = rest.length - kw.length;
    if (kw.length <= 2 ? extra === 0 : extra <= 3) return true;
  }
  return false;
}
// מחפש ביטוי (מילה אחת או כמה) בתוך רשימת מילים. מחזיר את מיקומי ההתחלה.
function findPhrase(toks, phrase) {
  const kws = tokens(phrase);
  const hits = [];
  if (!kws.length) return hits;
  for (let i = 0; i + kws.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < kws.length; j++) { if (!tokenIs(toks[i + j], kws[j])) { ok = false; break; } }
    if (ok) hits.push(i);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// תחומים. group = משפחה רחבה (התאמה חלקית בין תחומים שונים באותה משפחה).
export const SECTORS = [
  { id: 'restaurant', label: 'מסעדה / מזון מהיר', group: 'food', kw: ['מסעדה', 'מסעדנות', 'שווארמה', 'שוורמה', 'שאורמה', 'פלאפל', 'המבורגר', 'פיצה', 'פיצריה', 'סושי', 'חומוס', 'גריל', 'מזון מהיר', 'טורטיה', 'מקסיקני', 'מקסקני', 'מקסקנית', 'מקסיקנית', 'איטלקית', 'אוכל מוכן', 'קייטרינג', 'זכיינות'] },
  { id: 'cafe', label: 'בית קפה', group: 'food', kw: ['בית קפה', 'בתי קפה', 'קפה', 'קונדיטוריה'] },
  { id: 'bakery', label: 'מאפייה', group: 'food', kw: ['מאפיה', 'מאפה', 'מאפים', 'לחם', 'חלות', 'עוגות'] },
  { id: 'pub', label: 'פאב / בר', group: 'food', kw: ['פאב', 'בר', 'ביסטרו', 'מועדון לילה'] },
  { id: 'grocery', label: 'סופרמרקט / מכולת', group: 'retail_food', kw: ['סופרמרקט', 'סופר מרקט', 'סופמרקט', 'סופר', 'מינימרקט', 'מכולת', 'מרכול', 'קמעונאות מזון', 'קמאונאות מזון', 'טוטו', 'לוטו', 'קיוסק', 'פיצוציה', 'מרקט'] },
  { id: 'produce', label: 'פירות וירקות', group: 'retail_food', kw: ['ירקות', 'פירות', 'ירקן', 'ירקניה'] },
  { id: 'fashion', label: 'אופנה / ביגוד', group: 'retail', kw: ['ביגוד', 'הלבשה', 'אופנה', 'בוטיק', 'בגדים', 'נעליים'] },
  { id: 'retail', label: 'חנות / מסחר קמעונאי', group: 'retail', kw: ['חנות', 'חנויות', 'קמעונאות', 'צעצועים', 'מתנות', 'אקססוריז'] },
  { id: 'building_supply', label: 'חומרי בניין / חשמל', group: 'trade', kw: ['חומרי בנין', 'חומרי בניה', 'צורכי חשמל', 'צרכי חשמל', 'אינסטלציה', 'כלי עבודה'] },
  { id: 'import', label: 'ייבוא / סיטונאות / הפצה', group: 'trade', kw: ['יבוא', 'ייבוא', 'יבואן', 'סיטונאות', 'סיטונאי', 'הפצה', 'מפיץ', 'שיווק והפצה'] },
  { id: 'ecommerce', label: 'מסחר אונליין', group: 'online', kw: ['מסחר אלקטרוני', 'איקומרס', 'ecommerce', 'commerce', 'ebay', 'איביי', 'אמזון', 'amazon', 'shopify', 'שופיפיי', 'חנות אינטרנטית', 'חנויות אינטרנטיות', 'חנות אונליין', 'חנות וירטואלית', 'מכירות אונליין', 'מכירה אונליין'] },
  { id: 'factory', label: 'מפעל / ייצור', group: 'industry', kw: ['מפעל', 'מפעלים', 'יצור', 'ייצור', 'יצרן', 'תעשיה', 'תעשייתי', 'נגריה', 'מסגריה', 'הרמה', 'אלומיניום'] },
  { id: 'transport', label: 'הסעות / תחבורה', group: 'transport', kw: ['הסעות', 'היסעים', 'אוטובוסים', 'אוטובוס', 'מיניבוסים', 'מיניבוס', 'תחבורה', 'מוניות', 'מונית', 'הובלות', 'שליחויות', 'לוגיסטיקה'] },
  { id: 'maintenance', label: 'אחזקת מבנים / ניהול ועדי בתים', group: 'services', kw: ['אחזקת מבנים', 'אחזקות', 'אחזקה', 'ניהול מבנים', 'ועדי בתים', 'ועד בית', 'ניהול נכסים', 'ניהול בנינים'] },
  { id: 'construction', label: 'בנייה / קבלנות', group: 'services', kw: ['קבלן', 'קבלנות', 'חברת בניה', 'ג1', 'ג2', 'סיווג קבלני', 'שיפוצים'] },
  { id: 'kids', label: 'ילדים / פנאי / משחקייה', group: 'leisure', kw: ['משחקיה', 'משחקיות', 'מישחקיות', 'ילדים', 'נוער', 'צהרון', 'חוגים', 'נינגה', 'טיפוס', 'ימי הולדת', 'מרכז אתגרי', 'אתגרים'] },
  { id: 'sport', label: 'ספורט / אופניים', group: 'leisure', kw: ['ספורט', 'אופניים', 'אופנים', 'רכיבה', 'כושר', 'סטודיו'] },
  { id: 'beauty', label: 'יופי / אסתטיקה', group: 'health', kw: ['אסתטיקה', 'קוסמטיקה', 'מספרה', 'יופי', 'ציפורניים', 'הזעת יתר', 'רפואה אסתטית'] },
  { id: 'hotel', label: 'מלון / אירוח', group: 'hospitality', kw: ['מלון', 'מלונות', 'צימר', 'צימרים', 'אירוח', 'אכסניה', 'הוסטל'] },
  { id: 'events', label: 'אירועים / הפקות', group: 'hospitality', kw: ['אולם אירועים', 'גן אירועים', 'הפקות אירועים', 'הפקת אירועים'] },
  { id: 'laundry', label: 'מכבסה', group: 'services', kw: ['מכבסה', 'מכבסות', 'ניקוי יבש'] },
  { id: 'judaica', label: 'יודאיקה', group: 'industry', kw: ['יודאיקה', 'שופרות', 'שופר'] },
  { id: 'tv_tech', label: 'טכנולוגיה / אלקטרוניקה', group: 'trade', kw: ['טלויזיה', 'טלוויזיה', 'מתקני טלויזיה', 'אלקטרוניקה', 'מחשבים', 'סלולר', 'הייטק', 'תוכנה'] },
];
const SECTOR_BY_ID = Object.fromEntries(SECTORS.map(s => [s.id, s]));
const PHYSICAL = new Set(['restaurant', 'cafe', 'bakery', 'pub', 'grocery', 'produce', 'kids', 'sport', 'beauty', 'hotel', 'events', 'laundry', 'maintenance', 'transport', 'construction', 'retail', 'fashion', 'building_supply']);
const GROUP_LABEL = { food: 'מזון ומסעדנות', retail_food: 'קמעונאות מזון', retail: 'מסחר קמעונאי', trade: 'מסחר וסיטונאות', online: 'אונליין', industry: 'תעשייה וייצור', transport: 'תחבורה והסעות', services: 'שירותים', leisure: 'פנאי וילדים', health: 'בריאות ויופי', hospitality: 'אירוח ואירועים' };
// משפחות קרובות זו לזו (התאמה חלקית קטנה)
const NEAR_GROUPS = [['food', 'retail_food'], ['retail', 'retail_food'], ['retail', 'trade'], ['trade', 'industry'], ['trade', 'online'], ['hospitality', 'food']];
// מילים שמזוהות כמפתח רק כשהן לבד (מילים קצרות/כלליות שמופיעות בהרבה הקשרים)
const WEAK_KW = new Set(['לוגיסטיקה', 'יצור', 'ייצור', 'קמעונאות', 'מאפים', 'עוגות', 'בר', 'סופר', 'קפה', 'חנות', 'חנויות', 'מרקט', 'ילדים', 'נוער', 'אחזקה', 'אחזקות', 'פלטפורמה', 'דיגיטל', 'דיגיטלי', 'אינטרנט', 'הרמה', 'אירועים', 'זכיינות', 'מתנות', 'לחם', 'טיפוס', 'סטודיו', 'כושר', 'אירוח', 'מונית', 'אוטובוס'].map(norm));

// מוצא תחומים בטקסט. מחזיר מפה sectorId -> { pos:[...], kw }
function sectorHits(toks) {
  const out = new Map();
  for (const s of SECTORS) {
    for (const kw of s.kw) {
      const pos = findPhrase(toks, kw);
      if (!pos.length) continue;
      const cur = out.get(s.id) || { pos: [], kw, strong: false };
      cur.pos.push(...pos);
      if (!WEAK_KW.has(norm(kw))) { cur.strong = true; cur.kw = kw; }
      out.set(s.id, cur);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// גיאוגרפיה
const REGIONS = {
  north: { label: 'צפון', cities: ['כרמיאל', 'נהריה', 'עכו', 'צפת', 'טבריה', 'עפולה', 'נצרת', 'נוף הגליל', 'קרית שמונה', 'מעלות', 'טמרה', 'סכנין', 'שפרעם', 'מגדל העמק', 'יקנעם', 'בית שאן', 'קצרין', 'גליל', 'עמיעד', 'ראש פינה', 'דליית אל כרמל', 'דיר אל אסד', 'גלבוע', 'עמק יזרעאל'] },
  haifa: { label: 'חיפה והקריות', cities: ['חיפה', 'קרית אתא', 'קרית ביאליק', 'קרית מוצקין', 'קרית ים', 'נשר', 'טירת כרמל', 'זכרון יעקב', 'חדרה', 'עתלית', 'דור', 'פרדס חנה', 'כרכור', 'בנימינה', 'אור עקיבא', 'קיסריה'] },
  sharon: { label: 'שרון', cities: ['נתניה', 'כפר יונה', 'כפר סבא', 'רעננה', 'הוד השרון', 'הרצליה', 'רמת השרון', 'טייבה', 'טירה', 'קלנסווה', 'אבן יהודה', 'כוכב יאיר', 'צור יגאל', 'צורן', 'קדימה', 'תל מונד', 'גליל ים', 'שרון', 'גני תקווה'] },
  center: { label: 'מרכז / גוש דן', cities: ['תל אביב', 'יפו', 'רמת גן', 'גבעתיים', 'בני ברק', 'פתח תקווה', 'פתח תקוה', 'חולון', 'בת ים', 'קרית אונו', 'אור יהודה', 'יהוד', 'גבעת שמואל', 'ראש העין', 'אלעד', 'כפר קאסם', 'סביון', 'גוש דן', 'מרכז', 'מרכז הארץ', 'פלורנטין', 'גני תקוה', 'גלגוליה', 'שוהם'] },
  shfela: { label: 'שפלה', cities: ['ראשון לציון', 'ראשלצ', 'ראשל', 'רחובות', 'נס ציונה', 'יבנה', 'רמלה', 'לוד', 'מודיעין', 'באר יעקב', 'גדרה', 'מזכרת בתיה', 'קרית עקרון', 'גן יבנה', 'בני דרור', 'שפלה', 'מכבים', 'רעות', 'מבשרת', 'בית שמש'] },
  jerusalem: { label: 'ירושלים והסביבה', cities: ['ירושלים', 'מבשרת ציון', 'בית שמש', 'מעלה אדומים', 'אפרת', 'efrat', 'גבעת זאב', 'ביתר עילית', 'מודיעין עילית', 'גילה'] },
  south: { label: 'דרום', cities: ['באר שבע', 'אשדוד', 'אשקלון', 'קרית גת', 'קרית מלאכי', 'שדרות', 'נתיבות', 'אופקים', 'דימונה', 'ערד', 'אילת', 'רהט', 'להבים', 'עומר', 'מיתר', 'דרום', 'נגב'] },
};
const NEAR_REGIONS = [['center', 'sharon'], ['center', 'shfela'], ['shfela', 'jerusalem'], ['shfela', 'south'], ['sharon', 'haifa'], ['haifa', 'north']];
const ABROAD = ['ארגנטינה', 'צרפת', 'פלורידה', 'מיאמי', 'ארהב', 'ארצות הברית', 'אמריקה', 'לונדון', 'אנגליה', 'קנדה', 'ונצואלה', 'חול', 'usa', 'france'];
const CITY_WORDS = new Set(Object.values(REGIONS).flatMap(r => r.cities.flatMap(c => tokens(c))));
function regionOf(text) {
  const t = ' ' + tokens(text).join(' ') + ' ';
  if (!t.trim()) return null;
  // עיר מדויקת קודם (תל אביב לפני "מרכז")
  let best = null;
  for (const [rid, r] of Object.entries(REGIONS)) {
    for (const c of r.cities) {
      const nc = ' ' + tokens(c).join(' ') + ' ';
      if (t.includes(nc) || t.includes(' ב' + nc.trim() + ' ') || t.includes(' ה' + nc.trim() + ' ')) {
        if (!best || nc.length > best.len) best = { region: rid, city: c, len: nc.length };
      }
    }
  }
  return best;
}
function isAbroad(text) {
  const t = tokens(text);
  return ABROAD.some(a => findPhrase(t, a).length > 0);
}
const CITY_ALIASES = { 'ראשלצ': 'ראשון לציונ', 'ראשל': 'ראשון לציונ', 'רשלצ': 'ראשון לציונ', 'תא': 'תל אביב', 'פת': 'פתח תקוה', 'efrat': 'אפרת', 'ים': 'בת ים' };
function canonCity(s) { const t = tokens(s).join(' '); return CITY_ALIASES[t] || t; }
function sameCity(a, b) {
  const x = canonCity(a), y = canonCity(b);
  return !!x && !!y && (x === y || (' ' + x + ' ').includes(' ' + y + ' ') || (' ' + y + ' ').includes(' ' + x + ' '));
}
function regionsNear(a, b) { return NEAR_REGIONS.some(([x, y]) => (x === a && y === b) || (x === b && y === a)); }

// ---------------------------------------------------------------------------
// כסף: "תקציב בין 500-700 אלף", "עד 1 מיליון", "100,000 עד 150,000", "1.5 מיליון ש"ח"
export function parseMoneyMentions(text) {
  const t = norm(text).replace(/,(?=\d{3})/g, '');
  const out = [];
  const re = /(\d+(?:\.\d+)?)(?:\s*(?:[-–]|עד)\s*(\d+(?:\.\d+)?))?\s*(מיליונ|מליונ|מיליון|מליון|מלי|אלפ|אלף|k|m)?/g;
  let m;
  while ((m = re.exec(t))) {
    const unit = m[3] || '';
    const mult = /^(מיליונ|מליונ|מיליון|מליון|מלי|m)/.test(unit) ? 1e6 : /^(אלפ|אלף|k)/.test(unit) ? 1e3 : 1;
    const lo = parseFloat(m[1]) * mult;
    const hi = m[2] ? parseFloat(m[2]) * mult : lo;
    if (hi >= 50000 && hi <= 200e6) out.push({ lo, hi, at: m.index, raw: m[0].trim() });
  }
  return out;
}
// תקציב קונה מהטקסט: רק מספר שמופיע ליד מילה כמו תקציב/עד/השקעה/הון
export function budgetFromText(text) {
  const t = norm(text).replace(/,(?=\d{3})/g, '');
  const mentions = parseMoneyMentions(text);
  let best = null;
  for (const mm of mentions) {
    const before = t.slice(Math.max(0, mm.at - 40), mm.at);
    if (/(תקציב|עד|השקעה|להשקיע|הון|יכולת|מחפש השקעה|בין)/.test(before)) {
      // אם ממש לפני כתוב "מכר ב..." זה לא תקציב
      if (/מכר|מחזור|רווח|שכירות/.test(before.slice(-15))) continue;
      if (!best || mm.hi > best.hi) best = mm;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
const INTEREST = ['מתעניין', 'מתענין', 'מתעניינת', 'התעניין', 'התענין', 'התעניינה', 'מעוניין', 'מעונין', 'מעוניינת', 'מחפש', 'מחפשת', 'מחפשים', 'רוצה', 'רוצים', 'בקשר ל', 'בנוגע ל', 'לגבי', 'לרכוש', 'רכישה', 'רכישת', 'לקנות', 'להתרחב', 'עניין'];
const BACKGROUND = ['בעל', 'בעלת', 'בעלים', 'עוסק', 'עוסקת', 'עובד', 'עובדת', 'היה לו', 'היה לה', 'בעבר', 'יש לו', 'יש לה', 'מנהל', 'מנהלת', 'שכיר', 'שכירה', 'מומחה', 'שותף ב', 'הגיע מ', 'מכר את'];
const NEG_AFTER_MENTION = /^(?:\S+\s+){0,11}?(?:ו?לא\s+(?:מעוני|מעונ|מתאימ|רלונטי|רלוונטי|מתענינ|רוצה|רצה|התחבר|אהב)|פחות\s+מתאימ|ירד\s+מ|פסל)/;
const PRESENTED_BEFORE = ['הצעתי', 'שלחתי', 'הצגתי', 'נשלח', 'נשלחה', 'ניתנ לו', 'קיבל'];
const OPEN_FIELD = ['לא נעול', 'לא נעולה', 'פתוח לכל', 'פתוחה לכל', 'כל תחום', 'לא תחום ספציפי', 'לא מגיעה עם תחום', 'לא מגיע עם תחום', 'פתוחה לתחומים', 'פתוח לתחומים', 'אני פתוחה', 'אני פתוח', 'כל עסק רווחי'];
const GENERIC_NAME_WORDS = new Set(tokens('בתחומ בתחום מסחר המסחר תעשיות יזמות מוצרי ומוצרי בית מלון למכירה מספרה מספרת חנות פינת עסק חברה חברת בעמ בע מ ltd מסעדה מסעדת חנות סניף רשת קבוצת קבוצה מרכז שירותי שירותים ניהול ייבוא יבוא שיווק מפעל ישראל הקו החדש בית של את עם תל אביב ירושלים חיפה דמו').concat(SECTORS.flatMap(s => s.kw.flatMap(k => tokens(k)))));

function snippet(text, start, len = 90) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= len) return s;
  const from = Math.max(0, Math.min(start, s.length - len));
  return (from > 0 ? '…' : '') + s.slice(from, from + len).trim() + (from + len < s.length ? '…' : '');
}
// מוצא היכן בטקסט הגולמי מופיעה מילת מפתח (לציטוט קריא)
function quoteAround(raw, kw) {
  const s = String(raw || '').replace(/\s+/g, ' ');
  const n = norm(s);
  const k = norm(kw);
  const i = n.indexOf(k);
  if (i < 0) return '';
  return snippet(s, i - 35, 95);
}
function fmtMoney(n) {
  if (n == null || isNaN(n)) return '';
  if (n >= 1e6) return (Math.round(n / 1e5) / 10).toLocaleString('he-IL') + ' מיליון ₪';
  if (n >= 1e3) return Math.round(n / 1e3).toLocaleString('he-IL') + ' אלף ₪';
  return Math.round(n).toLocaleString('he-IL') + ' ₪';
}
const TO_FINAL = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
const displayWord = w => w.length > 1 && TO_FINAL[w.slice(-1)] ? w.slice(0, -1) + TO_FINAL[w.slice(-1)] : w;
const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'הקונה';

// ---------------------------------------------------------------------------
// פרופיל עסק
export function profileBusiness(b, extraNotes = []) {
  const primaryRaw = [b.field, b.category, b.subcategory, b.anon_display_name, b.short_description, b.anon_summary].filter(Boolean).join(' . ');
  const secondaryRaw = [b.internal_business_summary, b.notes, ...extraNotes].filter(Boolean).join(' . ');
  const structRaw = [b.field, b.category, b.subcategory].filter(Boolean).join(' ');
  const pt = tokens(primaryRaw), st = tokens(secondaryRaw);
  const hitsStruct = sectorHits(tokens(structRaw));
  const hitsPrimary = sectorHits(pt);
  const sectors = new Map();
  for (const [id, h] of hitsStruct) sectors.set(id, { weight: 1, source: 'field', kw: h.kw });
  // מהתיאור: רק 2 התחומים הבולטים (תיאור ארוך מזכיר הרבה דברים בדרך אגב)
  const ranked = [...hitsPrimary.entries()].filter(([id, h]) => !sectors.has(id) && (h.strong || h.pos.length > 1))
    .sort((a, b) => (b[1].strong - a[1].strong) || (b[1].pos.length - a[1].pos.length));
  for (const [id, h] of ranked.slice(0, sectors.size ? 1 : 2)) sectors.set(id, { weight: 0.9, source: 'description', kw: h.kw });
  if (!sectors.size) {
    for (const [id, h] of sectorHits(st)) if (h.strong) sectors.set(id, { weight: 0.7, source: 'notes', kw: h.kw });
  }
  const allRaw = primaryRaw + ' . ' + secondaryRaw;
  const allT = tokens(allRaw);
  // אונליין: רק כשהמכירה באינטרנט היא העסק עצמו (לא "נוכחות דיגיטלית" של חנות פיזית)
  const ecomHit = sectorHits(allT).get('ecommerce');
  const physical = [...sectors.keys()].some(id => PHYSICAL.has(id));
  const online = !!ecomHit && (!physical || hitsStruct.has('ecommerce')) || findPhrase(allT, 'ללא תלות במיקום').length > 0;
  const hybridOnline = !online && !!ecomHit;
  if (online && !sectors.has('ecommerce')) sectors.set('ecommerce', { weight: 0.9, source: 'description', kw: ecomHit ? ecomHit.kw : 'אונליין' });
  const relocatable = !online && (sectors.has('factory') || sectors.has('judaica') || ['ניתן להעביר', 'אפשר להעביר', 'ניתן להעתיק', 'להעתיק את', 'ניתן לניוד'].some(k => findPhrase(allT, k).length));
  const semiMobile = !online && !relocatable && sectors.has('import');
  const locText = [b.city, b.region, b.address].filter(Boolean).join(' ');
  const reg = regionOf(locText);
  // שם מזהה (למשל "ריקו", "לחמא", "דרכי המלך") - לזיהוי קונה שכתוב בהערות שהתעניין בעסק הזה
  const nameTokens = [...new Set(tokens(b.internal_name))].filter(w => w.length >= 4 && !GENERIC_NAME_WORDS.has(w) && !CITY_WORDS.has(w) && !/\d/.test(w));
  return {
    id: b.id, raw: b, sectors, online, hybridOnline, relocatable, semiMobile,
    city: (b.city || '').trim(), region: reg?.region || null,
    price: Number(b.asking_price) > 0 ? Number(b.asking_price) : null,
    revenue: Number(b.annual_revenue) > 0 ? Number(b.annual_revenue) : null,
    profit: Number(b.net_profit) > 0 ? Number(b.net_profit) : (Number(b.operating_profit) > 0 ? Number(b.operating_profit) : null),
    years: Number(b.years_active) > 0 ? Number(b.years_active) : null,
    number: b.business_number || '',
    nameTokens,
    kwSet: new Set(pt.concat(st).filter(w => w.length > 2)),
    label: sectorLabel(sectors, b),
  };
}
function sectorLabel(sectors, b) {
  const f = [b.field, b.category].map(x => (x || '').trim()).filter(Boolean)[0];
  if (f) return f;
  const first = [...sectors.keys()][0];
  return first ? SECTOR_BY_ID[first].label : 'תחום לא צוין';
}

// ---------------------------------------------------------------------------
// פרופיל קונה
export function profileBuyer(l, extraNotes = []) {
  const structRaw = [l.requested_field, l.requested_categories].map(x => (x || '').trim()).filter(Boolean).join(' / ');
  const notesRaw = [l.notes, l.intake_customer_wants, l.intake_important_details, l.intake_conversation_summary, l.meeting_summary, ...extraNotes].filter(Boolean).join(' . ');
  const nt = tokens(notesRaw);
  const wanted = new Map();      // sectorId -> {weight, source, kw, quote}
  const background = new Map();  // תחומים שהקונה עוסק/עסק בהם (ניסיון)
  const excluded = new Map();    // "לא מזון", "לא מסעדות"
  const pastRejected = new Map(); // "התעניין בסופרמרקט ב... לא מתאים לו" - הצעה קודמת שנדחתה
  const structHits = sectorHits(tokens(structRaw));
  const bp_structHas = id => structHits.has(id);
  for (const [id, h] of structHits) wanted.set(id, { weight: 1, source: 'field', kw: h.kw, quote: structRaw });

  // חלונות: אחרי מילת עניין = מה שהוא רוצה; אחרי "בעל/עוסק/בעבר" = רקע
  const interestPos = [], backgroundPos = [];
  for (const w of INTEREST) for (const p of findPhrase(nt, w)) interestPos.push(p + tokens(w).length);
  for (const w of BACKGROUND) for (const p of findPhrase(nt, w)) backgroundPos.push(p + tokens(w).length);
  const near = (arr, pos, span) => arr.some(a => pos >= a && pos - a <= span);
  for (const [id, h] of sectorHits(nt)) {
    for (const pos of h.pos) {
      const negated = pos > 0 && ['לא', 'בלי', 'ללא'].includes(nt[pos - 1]) || pos > 1 && ['לא', 'בלי', 'ללא'].includes(nt[pos - 2]) && !['רק'].includes(nt[pos - 1]);
      if (negated) { excluded.set(id, { kw: h.kw, quote: quoteAround(notesRaw, 'לא ' + nt[pos]) || quoteAround(notesRaw, h.kw) }); continue; }
      const tail = nt.slice(pos + 1, pos + 13).join(' ') + ' ';
      if (NEG_AFTER_MENTION.test(tail)) {
        const prev = pastRejected.get(id);
        pastRejected.set(id, { kw: h.kw, quote: quoteAround(notesRaw, nt[pos]) || quoteAround(notesRaw, h.kw), near: ((prev && prev.near) || '') + ' ' + nt.slice(pos + 1, pos + 6).join(' ') });
        if (!bp_structHas(id)) continue;
      }
      const inInterest = near(interestPos, pos, 8);
      const inBackground = near(backgroundPos, pos, 5);
      if (inInterest && !(inBackground && backgroundPos.some(b => b > Math.max(...interestPos.filter(a => a <= pos))))) {
        if (!wanted.has(id) || wanted.get(id).weight < 0.9) wanted.set(id, { weight: h.strong ? 0.9 : 0.5, weak: !h.strong, source: 'notes', kw: h.kw, quote: quoteAround(notesRaw, h.kw) });
      } else if (inBackground) {
        background.set(id, { kw: h.kw, quote: quoteAround(notesRaw, h.kw) });
      } else if (!interestPos.length && h.strong && !wanted.has(id)) {
        wanted.set(id, { weight: 0.6, source: 'notes', kw: h.kw, quote: quoteAround(notesRaw, h.kw) });
      }
    }
  }
  for (const id of excluded.keys()) wanted.delete(id);
  // מילה כללית (למשל "חנות" ב"חנות חומרי בניין") לא נחשבת כשיש תחום מפורש
  if ([...wanted.values()].some(w => !w.weak)) for (const [id, w] of [...wanted]) if (w.weak) wanted.delete(id);
  const open = OPEN_FIELD.some(k => findPhrase(nt, k).length > 0);

  // תקציב: שדה מובנה, הון עצמי, או מהטקסט
  let budget = null;
  if (Number(l.budget) > 0) budget = { lo: Number(l.budget), hi: Number(l.budget), source: 'field' };
  else if (Number(l.equity) > 0) budget = { lo: Number(l.equity), hi: Number(l.equity), source: 'equity' };
  else {
    const bt = budgetFromText(notesRaw);
    if (bt) budget = { lo: bt.lo, hi: bt.hi, source: 'notes', quote: quoteAround(notesRaw, bt.raw.split(/\s/)[0]) };
  }

  // מיקום: אזור מבוקש > "רק ב..." בהערות > עיר מגורים
  const areaRaw = (l.requested_area || '').trim();
  const cityRaw = (l.city || '').trim();
  const looksLikeAddress = s => /\d/.test(s) && !regionOf(s);
  const areaReg = areaRaw && !looksLikeAddress(areaRaw) ? regionOf(areaRaw) : null;
  const cityReg = cityRaw && !looksLikeAddress(cityRaw) ? regionOf(cityRaw) : null;
  let strictArea = null;
  const strictM = norm(notesRaw).match(/(?:רק|אך ורק|בלבד)\s+(?:ב|באזור\s+)?([\u05d0-\u05ea]+(?:\s+[\u05d0-\u05ea]+)?)|([\u05d0-\u05ea]+(?:\s+[\u05d0-\u05ea]+)?)\s+בלבד/);
  if (strictM) { const r = regionOf(strictM[1] || strictM[2] || ''); if (r) strictArea = r; }
  const abroad = isAbroad(cityRaw) || (!cityReg && isAbroad(notesRaw.slice(0, 200)));
  const notAreas = [];
  for (const m of norm(notesRaw).matchAll(/לא\s+([\u05d0-\u05ea]+(?:\s+[\u05d0-\u05ea]+)?)/g)) {
    const cand = [m[1], m[1].replace(/^ב/, ''), m[1].split(' ')[0], m[1].split(' ')[0].replace(/^ב/, '')];
    for (const c of cand) { const r = regionOf(c); if (r && sameCity(r.city, c)) { notAreas.push(r.city); break; } }
  }

  const female = /(מחפשת|מעונינת|מעוניינת|מתענינת|מתעניינת|התענינה|התעניינה|התקשרה|נמצאת|פנתה|שמי \S+ ואני|היא\s)/.test(norm(notesRaw)) && !/(מחפש\s|מעונינ\s|מתענינ\s|התקשר\s|הוא\s)/.test(norm(notesRaw).slice(0, 120));
  return {
    id: l.id, raw: l, wanted, background, excluded, pastRejected, open, budget, female,
    area: areaReg, strictArea, cityReg, city: cityRaw, abroad, notAreas,
    notesRaw, structRaw,
    kwSet: new Set(tokens(structRaw + ' ' + notesRaw).filter(w => w.length > 2)),
    hasInfo: wanted.size > 0 || open || !!structRaw,
    passive: findPhrase(nt, 'פסיבי').length > 0 || findPhrase(nt, 'פסיבית').length > 0,
    noFood: excluded.has('restaurant') || [...excluded.keys()].some(id => SECTOR_BY_ID[id]?.group === 'food'),
  };
}

// ---------------------------------------------------------------------------
const STOP = new Set(tokens('של עם את גם לא כן זה זו אני הוא היא יש אין על אל כל או אם רק כי מה עסק קונה מחפש מחפשת רוצה רוצים מתעניין מתענין מעונין מעוניין ניתן לו לה שלחתי מצגת מידע נשלחה שנה שנים עוד מאוד אחרי לפני כמו בין כיום היום התקשר התקשרה שיחה דיברתי טלפון פעיל פעילה רווחי רווחית עסקים הודעה פניה ישירה מאתר bsd מטרת לקנות תקציר אנונימי מעונינת בתחום תחום חברה חברת'));

// ציון צירוף אחד. מחזיר null כשאין בסיס.
export function scorePair(bp, zp, ctx = {}) {
  const why = [], caveats = [], how = [];
  const bname = firstName(bp.raw.full_name);
  const zname = String(zp.raw.internal_name || zp.raw.anon_display_name || 'העסק').replace(/\s+/g, ' ').trim();
  let sectorPts = 0, sectorWhy = '';

  // --- 0. אזכור ישיר של העסק בהערות הקונה ---
  let mention = null;
  const nt = tokens(bp.notesRaw);
  if (zp.number && norm(bp.notesRaw).includes(norm(zp.number))) mention = { word: zp.number, pos: -1 };
  if (!mention) for (const w of zp.nameTokens) { const p = findPhrase(nt, w); if (p.length) { mention = { word: w, pos: p[0] }; break; } }
  // אזכור לפי הקשר: "מתעניין בסופרמרקט טוטו לוטו בראשל"צ" = תחום העסק + העיר של העסק באותו משפט
  if (!mention && zp.city) {
    for (const [sid, sh] of zp.sectors) {
      for (const kw of SECTOR_BY_ID[sid].kw) {
        if (WEAK_KW.has(norm(kw))) continue;
        for (const p of findPhrase(nt, kw)) {
          const win = nt.slice(p + 1, p + 6);
          const hit = win.find(w => [w, w.replace(/^ב/, ''), w.replace(/^ה/, '')].some(v => v.length > 1 && sameCity(v, zp.city)))
            || (win.length > 1 && [0, 1, 2, 3].some(i => win[i] && win[i + 1] && sameCity((win[i] + ' ' + win[i + 1]).replace(/^ב/, ''), zp.city)) ? zp.city : null);
          if (hit) { mention = { word: nt[p], pos: p, context: true, sector: SECTOR_BY_ID[sid].label }; break; }
        }
        if (mention) break;
      }
      if (mention) break;
    }
  }
  if (mention) {
    const after = mention.pos >= 0 ? nt.slice(mention.pos, mention.pos + 9).join(' ') : '';
    if (NEG_AFTER_MENTION.test(after.split(' ').slice(1).join(' ') + ' ')) {
      return { rejected: true, reason: (bp.female ? fem : (x => x))(`בהערות של ${bname} כתוב שהוא כבר שמע על "${zname}" ולא התאים לו: «${quoteAround(bp.notesRaw, mention.word)}»`) };
    }
  }

  // --- 1. תחום (עד 45) ---
  let bestSector = null;
  for (const [sid, w] of bp.wanted) {
    if (zp.sectors.has(sid)) {
      const pts = Math.round(45 * Math.min(w.weight, zp.sectors.get(sid).weight));
      if (!bestSector || pts > bestSector.pts) bestSector = { pts, sid, w, kind: 'same' };
    }
  }
  if (!bestSector) {
    for (const [sid, w] of bp.wanted) for (const zsid of zp.sectors.keys()) {
      const g1 = SECTOR_BY_ID[sid].group, g2 = SECTOR_BY_ID[zsid].group;
      const kind = g1 === g2 ? 'group' : NEAR_GROUPS.some(([a, b]) => (a === g1 && b === g2) || (a === g2 && b === g1)) ? 'near' : null;
      if (!kind) continue;
      const pts = Math.round((kind === 'group' ? 26 : 12) * w.weight);
      if (!bestSector || pts > bestSector.pts) bestSector = { pts, sid, zsid, w, kind };
    }
  }
  // תחום שהקונה כתב במפורש שהוא לא רוצה
  for (const zsid of zp.sectors.keys()) {
    const ex = bp.excluded.get(zsid) || [...bp.excluded.entries()].find(([eid]) => SECTOR_BY_ID[eid].group === SECTOR_BY_ID[zsid].group && SECTOR_BY_ID[zsid].group === 'food')?.[1];
    if (ex) return { rejected: true, reason: `${bname} ביקש במפורש לא תחום כזה: «${ex.quote}»` };
  }
  const srcWord = w => w.source === 'field' ? 'בשדה "תחום מבוקש" בכרטיס שלו' : 'בהערות עליו';
  if (bestSector && bestSector.kind === 'same') {
    sectorPts = bestSector.pts;
    const sl = SECTOR_BY_ID[bestSector.sid].label;
    sectorWhy = `${bname} מחפש ${sl}, ו"${zname}" זה בדיוק עסק כזה.`;
    why.push(`תחום: ${sectorWhy}`);
    how.push({ label: 'התאמת תחום', pts: sectorPts, max: 45, text: `${srcWord(bestSector.w)} כתוב «${snippet(bestSector.w.quote, 0, 90)}», והעסק מוגדר כ"${zp.label}".` });
  } else if (bestSector) {
    sectorPts = bestSector.pts;
    const g = GROUP_LABEL[SECTOR_BY_ID[bestSector.sid].group];
    const wantLabel = SECTOR_BY_ID[bestSector.sid].label, isLabel = SECTOR_BY_ID[bestSector.zsid].label;
    sectorWhy = bestSector.kind === 'group' ? `${bname} מחפש ${wantLabel}; "${zname}" זה ${isLabel} - לא אותו דבר בדיוק, אבל מאותה משפחה (${g}).` : `${bname} מחפש ${wantLabel}; "${zname}" זה ${isLabel} - תחום שכן, לא זהה.`;
    why.push(`תחום: ${sectorWhy}`);
    caveats.push(`התחום לא זהה בדיוק למה שביקש (${wantLabel} מול ${isLabel}).`);
    how.push({ label: 'התאמת תחום', pts: sectorPts, max: 45, text: `${srcWord(bestSector.w)} כתוב «${snippet(bestSector.w.quote, 0, 90)}». תחום קרוב, לכן ניקוד חלקי.` });
  } else if (bp.open || !bp.wanted.size) {
    sectorPts = bp.open ? 18 : 0;
    if (bp.open) {
      why.push(`תחום: ${bname} כתב שהוא פתוח לתחומים שונים, כך שהתחום לא פוסל.`);
      how.push({ label: 'התאמת תחום', pts: sectorPts, max: 45, text: 'הקונה פתוח לכל תחום - ניקוד בינוני (לא ודאות שהתחום מעניין אותו).' });
    } else {
      how.push({ label: 'התאמת תחום', pts: 0, max: 45, text: 'לא כתוב באיזה תחום הקונה מחפש.' });
    }
  } else {
    // הקונה מחפש תחום אחר לגמרי
    return null;
  }
  if (mention) {
    const before = mention.pos >= 0 ? nt.slice(Math.max(0, mention.pos - 6), mention.pos).join(' ') : '';
    if (PRESENTED_BEFORE.some(w => before.includes(norm(w)))) caveats.push(`לפי ההערות, כבר סיפרו ל${bname} על העסק הזה - כדאי לבדוק מה הייתה התגובה לפני שמציגים שוב.`);
    sectorPts = Math.max(sectorPts, 30);
    if (mention.context) {
      why.unshift(`בהערות על ${bname} כתוב שהוא מתעניין ב${mention.sector} ב${zp.city} - וזה בדיוק העסק הזה: «${quoteAround(bp.notesRaw, mention.word)}». עדיין לא נפתחה התאמה במערכת.`);
      how.push({ label: 'אזכור בהערות', pts: 20, max: 20, text: `בהערות מופיעים גם סוג העסק וגם העיר שלו (${zp.city}).` });
    } else {
      why.unshift(`${bname} כבר הזכיר את העסק הזה בעצמו: בהערות כתוב «${quoteAround(bp.notesRaw, mention.word)}» - אבל עדיין לא נפתחה התאמה במערכת.`);
      how.push({ label: 'אזכור ישיר', pts: 20, max: 20, text: `השם/המספר של העסק ("${mention.word}") מופיע בהערות על הקונה.` });
    }
  }
  const bgSame = [...bp.background.keys()].find(id => zp.sectors.has(id));
  let expPts = 0;
  if (bgSame) { expPts = 5; why.push(`ניסיון: ${bname} כבר עוסק/עסק בתחום הזה (${SECTOR_BY_ID[bgSame].label}) - יתרון בהפעלת העסק.`); how.push({ label: 'ניסיון בתחום', pts: 5, max: 5, text: `בהערות: «${bp.background.get(bgSame).quote}».` }); }

  // --- 2. תקציב מול מחיר (עד 20, או הורדה) ---
  let budgetPts = 0;
  if (bp.budget && zp.price) {
    const hi = bp.budget.hi, lo = bp.budget.lo;
    const budgetTxt = lo !== hi ? `${fmtMoney(lo)}-${fmtMoney(hi)}` : fmtMoney(hi);
    const src = bp.budget.source === 'notes' ? ` (מהערות: «${bp.budget.quote}»)` : bp.budget.source === 'equity' ? ' (הון עצמי)' : '';
    const r = zp.price / hi;
    if (r <= 1) {
      budgetPts = zp.price < lo * 0.25 ? 10 : 20;
      why.push(`כסף: המחיר המבוקש ${fmtMoney(zp.price)} בתוך התקציב של ${bname} (${budgetTxt}).`);
      if (budgetPts === 10) caveats.push(`העסק קטן בהרבה מהתקציב שלו (${fmtMoney(zp.price)} מול ${budgetTxt}) - ייתכן שהוא מחפש משהו גדול יותר.`);
      how.push({ label: 'תקציב מול מחיר', pts: budgetPts, max: 20, text: `תקציב ${budgetTxt}${src}, מחיר ${fmtMoney(zp.price)}.` });
    } else if (r <= 1.3) {
      budgetPts = 12;
      why.push(`כסף: המחיר ${fmtMoney(zp.price)} מעט מעל התקציב (${budgetTxt}) - פער של עד 30%, בדרך כלל אפשר לגשר.`);
      caveats.push(`המחיר גבוה ב-${Math.round((r - 1) * 100)}% מהתקציב שלו.`);
      how.push({ label: 'תקציב מול מחיר', pts: 12, max: 20, text: `תקציב ${budgetTxt}${src}, מחיר ${fmtMoney(zp.price)} - מעט מעל.` });
    } else if (r <= 2) {
      budgetPts = 0;
      caveats.push(`המחיר ${fmtMoney(zp.price)} גבוה משמעותית מהתקציב (${budgetTxt}) - רק אם יש לו מימון/שותף.`);
      how.push({ label: 'תקציב מול מחיר', pts: 0, max: 20, text: `תקציב ${budgetTxt}${src}, מחיר ${fmtMoney(zp.price)} - כמעט פי 2.` });
    } else {
      budgetPts = -30;
      caveats.push(`המחיר ${fmtMoney(zp.price)} רחוק מאוד מהתקציב שלו (${budgetTxt}).`);
      how.push({ label: 'תקציב מול מחיר', pts: -30, max: 20, text: `תקציב ${budgetTxt}${src}, מחיר ${fmtMoney(zp.price)} - יותר מפי 2, הורדנו ניקוד.` });
    }
  } else {
    if (!bp.budget) caveats.push(`לא ידוע התקציב של ${bname} - כדאי לברר לפני שמציגים.`);
    if (!zp.price) caveats.push('לעסק לא רשום מחיר מבוקש.');
    how.push({ label: 'תקציב מול מחיר', pts: 0, max: 20, text: !bp.budget && !zp.price ? 'אין תקציב לקונה ואין מחיר לעסק - לא ניתן להשוות.' : !bp.budget ? 'אין תקציב ידוע לקונה.' : 'אין מחיר מבוקש לעסק.' });
  }

  // --- 3. מיקום (עד 20, או הורדה) ---
  let geoPts = 0;
  const zcity = zp.city || 'לא צוינה עיר';
  const bWantReg = bp.strictArea || bp.area;
  const bHomeReg = bp.cityReg;
  if (zp.online) {
    geoPts = 15;
    why.push(`מיקום: "${zname}" פועל בעיקר באינטרנט, כך שהמרחק פחות חשוב.`);
    how.push({ label: 'מיקום', pts: 15, max: 20, text: 'עסק אונליין - לא תלוי במיקום של הקונה.' });
  } else if (zp.hybridOnline && false) {
  } else if (!zp.region && !zp.city) {
    caveats.push('לא רשומה עיר לעסק - לא בדקנו מרחק.');
    how.push({ label: 'מיקום', pts: 0, max: 20, text: 'אין עיר לעסק.' });
  } else if (bp.notAreas.some(c => sameCity(c, zp.city))) {
    return { rejected: true, reason: `${bname} כתב שלא מתאים לו ${zp.city}.` };
  } else if (bWantReg || bHomeReg) {
    const ref = bWantReg || bHomeReg;
    const refTxt = bWantReg ? `האזור שהוא מבקש (${REGIONS[ref.region].label})` : `המקום שהוא גר בו (${bp.city})`;
    const refTo = 'ל' + refTxt.slice(1), refFrom = 'מ' + refTxt;
    const cityHit = (bWantReg && sameCity(bWantReg.city, zp.city)) || (!bWantReg && sameCity(bp.city, zp.city));
    if (cityHit) { geoPts = 20; why.push(`מיקום: העסק ב${zcity} - בדיוק ${bWantReg ? 'העיר שהוא מבקש' : 'העיר שהוא גר בה'}.`); }
    else if (zp.region && zp.region === ref.region) { geoPts = 14; why.push(`מיקום: העסק ב${zcity}, באותו אזור כמו ${refTxt}.`); }
    else if (zp.region && regionsNear(zp.region, ref.region)) { geoPts = 6; why.push(`מיקום: ${zcity} באזור סמוך ${refTo}.`); caveats.push(`לא באותו אזור בדיוק (${zcity}, ${REGIONS[zp.region].label}).`); }
    else if (zp.hybridOnline) { geoPts = 0; caveats.push(`העסק ב${zcity}, רחוק ${refFrom}. לעסק יש גם מכירות באינטרנט, אבל החנות עצמה במקום קבוע.`); }
    else if (zp.relocatable) { geoPts = 4; caveats.push(`העסק ב${zcity}, רחוק ${refFrom} - אבל זה מפעל/ייצור, וייתכן שאפשר להעביר אותו.`); }
    else if (zp.semiMobile) { geoPts = 2; caveats.push(`העסק ב${zcity}, רחוק ${refFrom}. בעסק ייבוא/הפצה המיקום פחות קריטי, אבל כדאי לבדוק.`); }
    else if (bp.strictArea) { geoPts = -40; caveats.push(`${bname} כתב שהוא רוצה רק ב${REGIONS[bp.strictArea.region].label}, והעסק ב${zcity}.`); }
    else { geoPts = -10; caveats.push(`העסק ב${zcity} - רחוק ${refFrom}.`); }
    if (!zp.region && !cityHit) caveats.push(`לא זיהינו באיזה אזור נמצאת ${zcity}.`);
    how.push({ label: 'מיקום', pts: geoPts, max: 20, text: `העסק ב${zcity}${zp.region ? ` (${REGIONS[zp.region].label})` : ''}; הקונה: ${bWantReg ? `מבקש ${REGIONS[bWantReg.region].label}` : `גר ב${bp.city}`}.${zp.relocatable ? ' מפעל - ייתכן שאפשר להעביר.' : ''}` });
  } else if (bp.abroad) {
    caveats.push(`${bname} גר כרגע בחו"ל - לבדוק לאן הוא מתכנן לעבור.`);
    how.push({ label: 'מיקום', pts: 0, max: 20, text: 'הקונה בחו"ל.' });
  } else {
    caveats.push(`לא ידוע איפה ${bname} גר או מחפש - לא בדקנו מרחק.`);
    how.push({ label: 'מיקום', pts: 0, max: 20, text: 'אין מיקום לקונה.' });
  }
  if (zp.relocatable && geoPts >= 6) why.push('מפעל/ייצור: גם אם יידרש, אפשר לשקול העברה.');

  // --- 4. מילים משותפות בתיאורים (עד 10) ---
  const sharedAll = [...bp.kwSet].filter(w => !STOP.has(w) && zp.kwSet.has(w) && !/^\d+$/.test(w));
  // בלי כפילויות כמו "ירושלים"/"בירושלים"
  const shared = sharedAll.filter(w => !(/^[בהולמש]/.test(w) && sharedAll.includes(w.slice(1))));
  const textPts = Math.min(shared.length * 3, 10);
  if (shared.length) how.push({ label: 'מילים משותפות בהערות', pts: textPts, max: 10, text: `מופיעות גם אצל הקונה וגם בתיאור העסק: ${shared.slice(0, 6).map(displayWord).join(', ')}.` });

  // --- 5. העדפות נוספות מהטקסט ---
  let prefPts = 0;
  if (/רוחי|רווחי/.test(norm(bp.notesRaw)) && zp.profit) { prefPts += 3; why.push(`רווחיות: ${bname} מחפש עסק רווחי, ולעסק רשום רווח של ${fmtMoney(zp.profit)} בשנה.`); }
  if (bp.passive && zp.sectors.has('restaurant')) caveats.push(`${bname} מחפש השקעה פסיבית, ומסעדה בדרך כלל דורשת מעורבות יומיומית.`);
  if (/ותיק|וותיק/.test(norm(bp.notesRaw)) && zp.years && zp.years >= 7) prefPts += 2;
  if (prefPts) how.push({ label: 'העדפות נוספות', pts: prefPts, max: 5, text: 'רווחיות/ותק שהקונה ביקש מופיעים בנתוני העסק.' });

  const pr = [...bp.pastRejected.keys()].find(id => zp.sectors.has(id));
  if (pr && zp.city && tokens(zp.city).some(w => w.length > 2 && bp.pastRejected.get(pr).near.includes(w))) {
    return { rejected: true, reason: `לפי ההערות, כבר הציעו ל${bname} ${SECTOR_BY_ID[pr].label} ב${zp.city} וזה לא התאים לו: «${bp.pastRejected.get(pr).quote}»` };
  }
  if (pr && !mention) caveats.push(`בעבר הוצע ל${bname} עסק אחר מאותו סוג (${SECTOR_BY_ID[pr].label}) והוא לא התאים לו - כדאי לבדוק למה: «${bp.pastRejected.get(pr).quote}».`);
  if (ctx.distributedAt) caveats.push(`כבר נשלח ל${bname} תקציר אנונימי של העסק הזה (${ctx.distributedAt}) - אבל לא נפתחה התאמה.`);
  if (!zp.raw.anon_summary && !zp.raw.short_description) caveats.push('לעסק אין עדיין תיאור/תקציר מסודר להצגה.');

  let score = sectorPts + (mention ? 20 : 0) + expPts + budgetPts + geoPts + textPts + prefPts;
  score = Math.max(0, Math.min(99, Math.round(score)));
  if (!why.length) return null;
  const tier = score >= 75 ? 'high' : score >= 60 ? 'good' : 'check';
  const summary = buildSummary({ bname, zname, zp, bp, score, mention, sectorWhy, geoPts, budgetPts });
  const F = bp.female ? fem : (x => x);
  return { score, tier, why: why.map(F), caveats: caveats.map(F), how: how.map(h => ({ ...h, text: F(h.text) })), summary: F(summary), mentioned: !!mention };
}

// לשון נקבה לקונה (רק מחוץ לציטוטים «...»)
const FEM = { 'מחפש': 'מחפשת', 'הזכיר': 'הזכירה', 'שמע': 'שמעה', 'ביקש': 'ביקשה', 'כתב': 'כתבה', 'פתוח': 'פתוחה', 'עוסק/עסק': 'עוסקת/עסקה', 'שלו': 'שלה', 'לו': 'לה', 'אליו': 'אליה', 'הוא': 'היא', 'שהוא': 'שהיא', 'גר': 'גרה', 'מבקש': 'מבקשת', 'מתכנן': 'מתכננת', 'עליו': 'עליה', 'לך': 'לך' };
export function fem(text) {
  return String(text).split(/(«[^»]*»)/).map(part => part.startsWith('«') ? part
    : part.replace(/(^|[^\u05d0-\u05ea\/])([\u05d0-\u05ea]+(?:\/[\u05d0-\u05ea]+)?)(?=$|[^\u05d0-\u05ea\/])/g, (m, pre, w) => pre + (FEM[w] || w))).join('');
}

function buildSummary({ bname, zname, zp, score, mention, geoPts, budgetPts }) {
  const parts = [];
  if (mention && mention.context) parts.push(`${bname} כתב שהוא מתעניין ב${mention.sector} ב${zp.city} - וזה "${zname}"`);
  else if (mention) parts.push(`${bname} כבר הזכיר את "${zname}" בעצמו`);
  else parts.push(`"${zname}" (${zp.label}${zp.city ? `, ${zp.city}` : ''}) מתאים למה ש${bname} מחפש`);
  if (zp.online) parts.push('פועל אונליין כך שהמרחק פחות חשוב');
  else if (geoPts >= 14) parts.push('קרוב אליו');
  if (budgetPts >= 12) parts.push('ובתוך התקציב');
  const lvl = score >= 75 ? 'התאמה גבוהה' : score >= 60 ? 'התאמה טובה' : 'שווה בדיקה';
  return `${lvl}: ${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// הרצה מלאה
/**
 * @param {{ buyers?: any[], businesses?: any[], matches?: any[], distributions?: any[], notes?: any[] }} data
 * @param {{ minScore?: number }} [opts]
 * @returns {{ engine_version: number, min_score: number, stats: any, suggestions: any[], already_matched: any[], rejected: any[] }}
 */
export function buildSuggestions({ buyers = [], businesses = [], matches = [], distributions = [], notes = [] }, opts = {}) {
  const min = opts.minScore ?? MIN_SCORE;
  const notesBy = new Map();
  for (const n of notes) {
    const k = n.table_name + ':' + n.record_id;
    if (!notesBy.has(k)) notesBy.set(k, []);
    notesBy.get(k).push(n.note_text);
  }
  const existing = new Map();
  for (const m of matches) if (m.buyer_id && m.business_id) existing.set(m.buyer_id + '|' + m.business_id, m);
  const dist = new Map();
  for (const d of distributions) if (d.buyer_id && d.business_id) {
    const k = d.buyer_id + '|' + d.business_id;
    const at = d.sent_at || d.created_at;
    if (!dist.has(k) || (at && at > dist.get(k))) dist.set(k, at);
  }
  const bps = buyers.map(b => profileBuyer(b, notesBy.get('leads:' + b.id) || []));
  const zps = businesses.map(z => profileBusiness(z, notesBy.get('businesses:' + z.id) || []));
  const suggestions = [], alreadyMatched = [], rejected = [];
  let pairs = 0, skippedNoInfo = 0;
  for (const bp of bps) {
    if (!bp.hasInfo) { skippedNoInfo++; continue; }
    for (const zp of zps) {
      pairs++;
      const key = bp.id + '|' + zp.id;
      const d = dist.get(key);
      const r = scorePair(bp, zp, { distributedAt: d ? fmtDate(d) : '' });
      if (!r) continue;
      if (r.rejected) { rejected.push({ buyer_id: bp.id, business_id: zp.id, reason: r.reason }); continue; }
      if (r.score < min) continue;
      const item = { buyer_id: bp.id, business_id: zp.id, ...r, distributed_at: d || null, business_sector: zp.label, online: zp.online, relocatable: zp.relocatable };
      const ex = existing.get(key);
      if (ex) alreadyMatched.push({ ...item, existing_match: { id: ex.id, status: ex.status || '', created_at: ex.created_at || null } });
      else suggestions.push(item);
    }
  }
  const byScore = (a, b) => b.score - a.score || (b.mentioned - a.mentioned);
  suggestions.sort(byScore); alreadyMatched.sort(byScore);
  return {
    engine_version: ENGINE_VERSION,
    min_score: min,
    stats: { buyers: buyers.length, businesses: businesses.length, buyers_without_info: skippedNoInfo, pairs_checked: pairs, new_suggestions: suggestions.length, already_matched: alreadyMatched.length, rejected_by_notes: rejected.length, existing_matches: existing.size },
    suggestions, already_matched: alreadyMatched, rejected,
  };
}
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }); } catch (_e) { return String(iso).slice(0, 10); } }

// מוסיף לכל הצעה פרטי תצוגה (שם, מספר, עיר, קישורים) - משותף לפונקציה ולבדיקות.
// פרטי קשר (טלפון/מייל/טלפון בעל העסק) רק כש-fullAccess (מנהל/אדמין).
/**
 * @param {any[]} list
 * @param {{ buyers: any[], businesses: any[], fullAccess: boolean }} ctx
 * @returns {any[]}
 */
export function decorateForClient(list, { buyers, businesses, fullAccess }) {
  const buyerById = new Map(buyers.map(b => [b.id, b]));
  const bizById = new Map(businesses.map(b => [b.id, b]));
  const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
  return list.map(s => {
    const b = buyerById.get(s.buyer_id) || {};
    const z = bizById.get(s.business_id) || {};
    const buyerName = clean(b.full_name) || '—';
    const bizName = clean(z.internal_name || z.anon_display_name) || '—';
    return {
      ...s,
      level: s.tier,                                   // high | good | check
      tier: s.score > 60 ? 'blue' : 'yellow',          // תאימות לדף הישן (צבע)
      buyer: buyerName, business: bizName,             // תאימות לדף הישן
      reason: s.summary,                               // תאימות לדף הישן
      financing: false,
      buyer_info: {
        id: b.id, name: buyerName, client_number: b.client_number || '', city: clean(b.city),
        agreement_status: b.agreement_status || '', status: b.status || '',
        phone: fullAccess ? (b.phone || '') : '', phone2: fullAccess ? (b.phone2 || '') : '', email: fullAccess ? (b.email || '') : '',
      },
      business_info: {
        id: z.id, name: bizName, number: z.business_number || '', city: clean(z.city), sector: s.business_sector,
        asking_price: num(z.asking_price), annual_revenue: num(z.annual_revenue), net_profit: num(z.net_profit),
        website: z.website || '', owner_phone: fullAccess ? (z.owner_phone || '') : '',
      },
    };
  });
}
