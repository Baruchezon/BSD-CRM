// BSD CRM - generate-anonymous-card Edge Function
//
// Builds an anonymous business card for a given business: a short generic
// display name plus a structured, multi-section summary (field, region,
// opportunity, key facts) REWRITTEN by Claude from the business's own
// description/notes/sale reason/financials - never a copy of the original
// text, and only using data that actually exists (never invented).
//
// Two-step flow, per explicit requirement that nothing publishes automatically:
//   1. action: 'draft' (default) - calls Claude, returns the draft for the
//      admin to preview/edit. Never saves, never hard-blocks (concerns are
//      returned alongside the draft so the admin can see and fix them).
//   2. action: 'confirm' - takes the final text (possibly hand-edited by the
//      admin) and re-runs the safety scan on THAT exact text before saving -
//      this is the only place anything is written to the businesses table.
//
// Restricted to admin/manager only (stricter than general business access).
//
// Uses Claude's tool-use (forced function call) instead of asking for
// freeform-text JSON and parsing it ourselves - the previous approach could
// throw "Unterminated string in JSON" when the model put a literal newline
// inside a JSON string value; tool-use has the API return already-validated
// structured data, eliminating that failure mode at the source rather than
// working around the symptom.
//
// Requires: ANTHROPIC_API_KEY secret (already used by analyze-meeting-audio).
//
// Called from businesses.html via:
//   supabase.functions.invoke('generate-anonymous-card', { body: { business_id, form } })
//   (form = ערכי הטופס הנוכחיים מהמסך, ראו buildAnonInput; בלי form - ערכים שמורים)
//   supabase.functions.invoke('generate-anonymous-card', { body: { business_id, action: 'confirm', anon_display_name, anon_summary } })

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanEnv(v: string | undefined): string {
  return (v || '').trim();
}

const ANTHROPIC_API_KEY = cleanEnv(Deno.env.get('ANTHROPIC_API_KEY'));
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}
function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
}

// סכימת הכלי (tool) שכפית את Claude להחזיר JSON תקני מובנה, שכבר עבר
// אימות מבני על ידי ה-API עצמו - ולא טקסט חופשי שאנחנו צריכים לפענח בעצמנו.
// זהו התיקון האמיתי לשגיאת "Unterminated string in JSON": הבעיה לא הייתה
// בקוד הפענוח שלנו אלא בזה שביקשנו מהמודל "תחזיר JSON" בתוך טקסט חופשי -
// לפעמים הוא הכניס ירידת שורה אמיתית בתוך string במקום \n בורח, מה ששובר
// JSON.parse רגיל. tool_use מונע את כל מחלקת הבאג הזו מהשורש.
const ANON_CARD_TOOL = {
  name: 'submit_anonymous_card',
  description: 'הגשת תקציר עסק אנונימי שיווקי, בטוח לפרסום',
  input_schema: {
    type: 'object',
    properties: {
      anon_display_name: { type: ['string', 'null'], description: 'ביטוי גנרי קצר לפי תחום הפעילות (למשל "משחקיית ילדים אינדור"), או null אם אין מספיק מידע' },
      anon_summary: { type: ['string', 'null'], description: 'התקציר האנונימי המלא כטקסט רגיל בעברית: פתיחה קצרה, תיאור העסק ואיך הוא נראה, נתונים מרכזיים (שורות שמתחילות ב-"•"), וסיכום. בלי רווח/רווחיות, בלי עיר/כתובת, בלי שמות/טלפונים/קישורים. null אם אין מספיק מידע.' },
      ai_flagged_concerns: { type: 'array', items: { type: 'string' }, description: 'חששות אנונימיות שנשארו בטקסט שהגשת (אם יש), אחרת מערך ריק' },
    },
    required: ['anon_display_name', 'anon_summary', 'ai_flagged_concerns'],
  },
};

// ---------- טביעת אצבע (hash) של התוכן שבאמת משפיע על התקציר האנונימי ----------
// שימוש: לזהות "האם התקציר עדיין תואם את נתוני העסק" בלי לנחש לפי updated_at
// (שמתעדכן על כל שינוי טכני, גם כזה שלא נוגע לתקציר בכלל - למשל סטטוס מכירה
// או מטפל בעסק). כולל רק את השדות שבאמת מוזנים ל-AI ב-generateSummary()
// למעלה: תחום/קטגוריה/עיר, תיאור/הערות, נתונים כמותיים, וסיבת מכירה רק אם
// היא בפועל מוצגת (anon_card_show_reason). internal_name הוסר בכוונה -
// שינוי שם העסק הפנימי לא משפיע על תוכן התקציר האנונימי בכלל.
// חייב להישאר זהה בדיוק (סדר שדות, טיפול ב-null/undefined) לפונקציית
// ה-JS המקבילה ב-businesses.html (computeAnonSourceFingerprint) - שתיהן
// חייבות לחשב את אותו hash על אותו קלט כדי שבדיקת ה"יש עדכון" תהיה אמינה.
async function computeAnonSourceHash(biz: Record<string, unknown>): Promise<string> {
  const parts = [
    biz.field, biz.category, biz.city,
    biz.short_description, biz.notes,
    biz.years_active, biz.annual_revenue, biz.operating_profit, biz.net_profit, biz.employees_count,
    biz.anon_card_show_reason ? biz.sale_reason : null,
  ];
  const raw = parts.filter(v => v !== null && v !== undefined && v !== '').map(String).join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// שם תצוגה אנונימי גנרי לפי תחום/קטגוריה בלבד - לא תלוי ב-AI ולא תלוי בטקסט
// חופשי, כך שהוא תמיד זמין (גם כשאין short_description/notes/sale_reason
// בכלל) וגם תמיד בטוח (field/category הם כבר שדות מובנים שהוגדרו כלליים,
// לא טקסט חופשי שעלול לזהות את העסק). זו רשת הביטחון שמבטיחה ששם תצוגה
// אנונימי תמיד ילווה תקציר אנונימי - לא רק ניסיון בלבד מה-AI.
function buildFallbackDisplayName(biz: Record<string, unknown>): string | null {
  const field = typeof biz.field === 'string' ? biz.field.trim() : '';
  const category = typeof biz.category === 'string' ? biz.category.trim() : '';
  const label = field || category;
  return label ? `עסק בתחום ${label}` : null;
}

// ---------- שלב 1: בניית הקלט ל-AI (06.10.2026, בקשת ברוך) ----------
// הכפתור עובד על מה שכתוב כרגע על המסך, לא על מה ששמור במסד. הדפדפן שולח
// body.form. סדר עדיפות לטקסט המקור:
//   1. תיבת התקציר האנונימי עצמה (אם יש בה טקסט) - "תסדר לי את מה שכתבתי"
//   2. תיבת התקציר העסקי הפנימי המלא
//   3. תיבת התיאור הפנימי של העסק
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

  let sourceLabel: string | null = null, sourceText = '';
  if (anonText) { sourceLabel = 'הטקסט שכתוב כרגע בתיבת התקציר האנונימי'; sourceText = anonText; }
  else if (internalText) { sourceLabel = 'התקציר העסקי הפנימי המלא (פנימי - חייב לעבור אנונימיזציה)'; sourceText = internalText; }
  else if (descText) { sourceLabel = 'התיאור הפנימי של העסק (פנימי - חייב לעבור אנונימיזציה)'; sourceText = descText; }

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

  return { sourceLabel, sourceText, field: pick('field'), category: pick('category'), region: pick('region'), facts };
}

export function buildAnonPrompts(input: AnonInput): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `אתה כותב תוכן שיווקי עבור משרד תיווך עסקים (BSD Business Brokers Israel). המשימה: לכתוב תקציר אנונימי של עסק למכירה, שיתפרסם באתר ויישלח לקונים פוטנציאליים - בלי שאפשר יהיה לזהות את העסק.

מבנה התקציר (anon_summary), טקסט רגיל בעברית, פסקאות מופרדות בשורה ריקה:
1. פתיחה קצרה (1-2 משפטים) שמציגה את ההזדמנות.
2. תיאור העסק: מה הוא מציע, איך הוא נראה, הפעילות, סוג הלקוחות (באופן כללי), המתחם/השטח, הציוד והצוות - ככל שהמידע קיים.
3. נתונים מרכזיים: שורות קצרות שמתחילות ב-"•" - רק נתונים שסופקו (מחזור, שנות פעילות, עובדים, שטח, ציוד/תכולה, שכירות ותנאי חוזה, ומחיר מבוקש רק אם הוא מופיע בבלוק הנתונים).
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

async function generateSummary(biz: Record<string, unknown>, form: unknown): Promise<{ anon_display_name: string | null; anon_summary: string | null; ai_flagged_concerns: string[] }> {
  const input = buildAnonInput(biz, form);

  if (!input.sourceText) {
    // אין טקסט מקור (תקציר אנונימי / תקציר פנימי / תיאור) - לא קוראים ל-AI על ריק,
    // אבל עדיין נותנים שם תצוגה גנרי לפי תחום/קטגוריה אם קיימים.
    return { anon_display_name: buildFallbackDisplayName({ field: input.field, category: input.category }), anon_summary: null, ai_flagged_concerns: [] };
  }

  const { systemPrompt, userPrompt } = buildAnonPrompts(input);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      // 06.10.2026: תקציר שיווקי מלא בעברית - 3000, עם בדיקת stop_reason למטה.
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [ANON_CARD_TOOL],
      tool_choice: { type: 'tool', name: 'submit_anonymous_card' },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`יצירת תקציר AI נכשלה (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data && data.stop_reason === 'max_tokens') {
    // לא מחזירים תקציר חלקי בשקט - עדיף שגיאה ברורה ולנסות שוב
    throw new Error('תשובת ה-AI נחתכה באמצע (ארוכה מדי) - לא נשמר כלום. נסה שוב.');
  }
  const toolBlock = (data.content || []).find((b: { type: string }) => b.type === 'tool_use');
  if (!toolBlock || typeof toolBlock.input !== 'object' || toolBlock.input === null) {
    // לא אמור לקרות עם tool_choice מאולץ, אבל אם כן - הודעה ברורה, לא קריסה
    throw new Error('התשובה מ-Claude לא הגיעה במבנה הצפוי (tool_use חסר) - נסה שוב');
  }
  const out = toolBlock.input as { anon_display_name?: string | null; anon_summary?: string | null; ai_flagged_concerns?: string[] };
  const summary = typeof out.anon_summary === 'string'
    ? out.anon_summary.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim()
    : '';

  return {
    // אם Claude החזיר null - נופלים לשם גנרי לפי תחום/קטגוריה, כדי שתקציר
    // אנונימי לעולם לא ייווצר בלי שם תצוגה.
    anon_display_name: out.anon_display_name || buildFallbackDisplayName({ field: input.field, category: input.category }),
    anon_summary: summary || null,
    ai_flagged_concerns: Array.isArray(out.ai_flagged_concerns) ? out.ai_flagged_concerns : [],
  };
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

  // 06.10.2026: עיר העסק - מותר רק אזור. אם שם העיר הוא חלק מהאזור שהוגדר
  // לעסק (למשל עיר "ירושלים" ואזור "אזור ירושלים") - לא מסמנים, כי האזור מותר.
  const city = typeof biz.city === 'string' ? biz.city.trim() : '';
  const region = typeof biz.region === 'string' ? biz.region.trim() : '';
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  try {
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'ANTHROPIC_API_KEY לא מוגדר ב-Secrets' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonResponse({ error: 'לא מחובר' }, 401);

    const body = await req.json();
    const { business_id } = body;
    if (!business_id) return jsonResponse({ error: 'חסר business_id' }, 400);

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
    const { data: biz, error: bizErr } = await supabase.from('businesses').select('*').eq('id', business_id).maybeSingle();
    if (bizErr || !biz) return jsonResponse({ error: 'עסק לא נמצא' }, 404);

    // הרשאה: לפי סעיף 6 - רק אדמין/מנהל יכולים ליצור/לערוך/לאשר תקציר
    // אנונימי (בניגוד לצפייה/טיפול הרגילים בעסק, שמותרים למגוון רחב יותר
    // של תפקידים - זו הרחבה מכוונת ומחמירה יותר, במפורש לפי בקשתו).
    const isAdminOrManager = profile && ['admin', 'manager'].includes(profile.role);
    if (!isAdminOrManager) {
      return jsonResponse({ error: 'רק אדמין או מנהל יכולים ליצור תקציר אנונימי' }, 403);
    }

    if (body.action === 'confirm') {
      // שלב האישור: הטקסט הסופי (אולי נערך ידנית ע"י האדמין אחרי הטיוטה)
      // עובר סריקת בטיחות אמיתית משלו על מה שבאמת עומד להישמר - לא סומכים
      // על הבדיקה שרצה בזמן יצירת הטיוטה, כי הטקסט יכול היה להשתנות.
      const finalDisplayName = typeof body.anon_display_name === 'string' ? body.anon_display_name.trim() || null : null;
      const finalSummary = typeof body.anon_summary === 'string' ? body.anon_summary.trim() || null : null;
      const scanTarget = [finalDisplayName, finalSummary].filter(Boolean).join(' ');
      const concerns = localSafetyScan(scanTarget, biz);
      if (concerns.length) {
        return jsonResponse({ error: 'הטקסט מכיל מידע שעלול לזהות את העסק - לא נשמר', concerns }, 422);
      }
      // תיקון 21.08.2026: ה-hash היה בנוי על internal_name (לא באמת משפיע
      // על התקציר) ולא כלל תחום/קטגוריה/עיר/נתונים כמותיים/סיבת מכירה
      // (כן משפיעים) - זו הייתה הסיבה שהמלצת "צור תקציר חדש" הופיעה על כל
      // שינוי טכני ולא נעלמה גם אחרי תקציר עדכני. עכשיו על אותו נוסחה
      // המשותפת (ראו computeAnonSourceHash למעלה), מחושב על הביזנס העדכני
      // ביותר שבאמת נשמר - biz שנטען למעלה עשוי להיות "ישן" אם ה-draft
      // נוצר לפני שינוי אחר בטופס; שולפים שוב טרי כדי לא לשמור hash שגוי.
      const { data: freshBizForHash } = await supabase.from('businesses').select('*').eq('id', business_id).maybeSingle();
      const sourceHash = await computeAnonSourceHash(freshBizForHash || biz);
      const { error: updateErr } = await supabase.from('businesses').update({
        anon_display_name: finalDisplayName,
        anon_summary: finalSummary,
        anon_summary_generated_at: new Date().toISOString(),
        anon_summary_generated_by: userData.user.id,
        anon_summary_source_hash: sourceHash,
      }).eq('id', business_id);
      if (updateErr) return jsonResponse({ error: 'שגיאה בשמירת התקציר: ' + updateErr.message }, 500);
      return jsonResponse({ anon_display_name: finalDisplayName, anon_summary: finalSummary });
    }

    // שלב הטיוטה: תמיד מחזיר את מה ש-Claude כתב לתצוגה מקדימה - לעולם לא
    // שומר ולעולם לא חוסם, גם אם יש חששות (הם מוצגים לאדמין כדי שיוכל
    // לתקן ידנית בתצוגה המקדימה; החסימה האמיתית היא בשלב האישור למעלה).
    const generated = await generateSummary(biz, body.form);
    const scanTarget = [generated.anon_display_name, generated.anon_summary].filter(Boolean).join(' ');
    const localHits = localSafetyScan(scanTarget, biz);
    const allConcerns = [...generated.ai_flagged_concerns, ...localHits];

    return jsonResponse({
      anon_display_name: generated.anon_display_name,
      anon_summary: generated.anon_summary,
      concerns: allConcerns,
      warnings: generated.anon_summary ? [] : ['אין מספיק מידע כדי לכתוב תקציר אמין - כתוב טקסט בתיבת התקציר האנונימי, בתקציר העסקי המלא או בתיאור הפנימי, ונסה שוב'],
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
