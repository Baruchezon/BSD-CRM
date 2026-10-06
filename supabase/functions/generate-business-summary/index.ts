// BSD CRM - generate-business-summary Edge Function
//
// Generates the two NON-anonymous summary types for a business card:
//   mode 'short'          -> a few-line overview for short_description
//   mode 'internal_full'  -> the full internal summary (internal_business_summary)
//
// Deliberately a SEPARATE function from generate-anonymous-card: no
// anonymization rules apply here at all. Both modes may include real
// identifying info (business name, owner, phone, address) when it exists
// in the business record. This separation is intentional and must never be
// merged with the anonymous-card function, so identifying info can never
// leak into that anonymous pipeline by code-sharing accident.
//
// Same two-step flow as generate-anonymous-card, for the same reason
// (nothing publishes automatically):
//   1. action: 'draft'   - returns AI draft for preview, never saves.
//   2. action: 'confirm' - saves the (possibly hand-edited) final text.
//
// Requires: ANTHROPIC_API_KEY secret (already used elsewhere in this project).
//
// Called from businesses.html via:
//   supabase.functions.invoke('generate-business-summary', { body: { business_id, mode, form } })
//   (form = ערכי הטופס הנוכחיים מהמסך; שדה ריק -> הערך השמור במסד)
//   supabase.functions.invoke('generate-business-summary', { body: { business_id, mode, action:'confirm', text } })

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanEnv(v: string | undefined): string { return (v || '').trim(); }

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

type Mode = 'short' | 'internal_full';

const SUMMARY_TOOL = {
  name: 'submit_business_summary',
  description: 'הגשת טקסט תקציר עסקי סופי',
  input_schema: {
    type: 'object',
    properties: {
      summary_text: { type: 'string', description: 'טקסט התקציר המלא, מוכן להצגה' },
      insufficient_info: { type: 'boolean', description: 'true אם אין מספיק נתונים בכרטיס העסק כדי לכתוב תקציר אמין' },
    },
    required: ['summary_text', 'insufficient_info'],
  },
};

// שדות "מותרים לחלוטין" בשני המצבים - זה ההבדל המהותי מ-generate-anonymous-card:
// שם העסק, בעלים, טלפון, כתובת - כל אלה נכנסים כאן במפורש, ואסור שהפונקציה
// הזו תדע או תפעיל אי-פעם כלל אנונימיזציה.
function buildFactsBlock(biz: Record<string, unknown>): string {
  const lines: string[] = [];
  const push = (label: string, val: unknown) => { if (val !== null && val !== undefined && val !== '') lines.push(`${label}: ${val}`); };
  push('שם העסק', biz.internal_name);
  push('בעל/ת העסק', biz.owner_name);
  push('טלפון', biz.owner_phone);
  push('אימייל', biz.owner_email);
  push('ח.פ./ע.מ.', biz.id_number);
  push('סוג ישות', biz.entity_type);
  push('תחום', biz.field);
  push('קטגוריה', biz.category);
  push('תת-קטגוריה', biz.subcategory);
  push('עיר', biz.city);
  push('אזור', biz.region);
  push('כתובת', biz.address);
  push('אתר', biz.website);
  push('שנות פעילות', biz.years_active);
  push('מחזור שנתי משוער', biz.annual_revenue);
  push('רווח תפעולי משוער', biz.operating_profit);
  push('רווח נקי משוער', biz.net_profit);
  push('מספר עובדים', biz.employees_count);
  push('מחיר מבוקש', biz.asking_price);
  push('סיבת מכירה', biz.sale_reason);
  push('סטטוס', biz.status);
  return lines.join('\n');
}

// 06.10.2026 (בקשת ברוך): הכפתור עובד על מה שכתוב כרגע על המסך (כולל עריכות
// שעוד לא נשמרו), ולא על מה ששמור במסד. הדפדפן שולח body.form עם ערכי הטופס;
// שדה ריק/חסר בטופס -> נופלים לערך השמור במסד.
export const FORM_FACT_KEYS = [
  'internal_name', 'owner_name', 'owner_phone', 'owner_email', 'id_number', 'entity_type',
  'field', 'category', 'subcategory', 'city', 'region', 'address', 'website',
  'years_active', 'annual_revenue', 'operating_profit', 'net_profit', 'employees_count',
  'asking_price', 'sale_reason', 'status', 'short_description', 'notes',
];

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

// ממזג ערכי טופס על גבי הרשומה השמורה: ערך טופס לא-ריק גובר, אחרת נשאר הערך מה-DB.
export function mergeFormOverDb(biz: Record<string, unknown>, form: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...biz };
  if (!form || typeof form !== 'object') return out;
  const f = form as Record<string, unknown>;
  for (const k of FORM_FACT_KEYS) {
    if (isFilled(f[k])) out[k] = typeof f[k] === 'string' ? (f[k] as string).trim() : f[k];
  }
  return out;
}

// הטקסט שבתיבת "תקציר עסקי פנימי מלא" עצמה: אם התיבה קיימת על המסך (נשלחה
// מחרוזת, גם ריקה) - זה מה שקובע; רק אם הטופס לא שלח אותה בכלל - הערך השמור.
export function pickBoxText(form: unknown, dbValue: unknown): string {
  if (form && typeof form === 'object' && typeof (form as Record<string, unknown>).internal_business_summary === 'string') {
    return ((form as Record<string, unknown>).internal_business_summary as string).trim();
  }
  return typeof dbValue === 'string' ? dbValue.trim() : '';
}

export function buildInternalPrompts(biz: Record<string, unknown>, mode: Mode, boxText: string): { systemPrompt: string; userPrompt: string } | null {
  const factsBlock = buildFactsBlock(biz);
  const freeText = [biz.short_description, biz.notes].filter(Boolean).join('\n---\n');
  const hasBox = mode === 'internal_full' && !!boxText;

  if (!hasBox && !factsBlock.trim() && !freeText.trim()) return null;

  let modeInstructions: string;
  if (mode === 'short') {
    modeInstructions = 'כתוב תקציר קצר של 2-4 שורות בלבד: במה העסק עוסק, מה היקף הפעילות (בקצרה), מה מיוחד בו, ומה הסטטוס הכללי. תמציתי ושיווקי אך מדויק.';
  } else if (hasBox) {
    modeInstructions = 'המשתמש כבר כתב בעצמו את התקציר העסקי הפנימי (מופיע למטה תחת "הטקסט שבתיבה"). המשימה: לסדר, לתקן כתיב ודקדוק, ולנסח אותו בצורה נקייה, מסודרת ומקצועית - בסעיפים עם כותרת קצרה לכל סעיף. חובה לשמור על כל פרט, מספר, שם, סכום ותנאי שמופיעים בטקסט שבתיבה - אסור להשמיט, לעגל או לקצר. מותר להשאיר משפטים טובים כמו שהם. אם נתון מובנה מהכרטיס (למטה) חסר בטקסט - מותר להוסיף אותו לסעיף המתאים. זהו מסמך פנימי - פרטים מזהים נשארים.';
  } else {
    modeInstructions = 'כתוב תקציר עסקי פנימי מלא ומפורט, בסעיפים ברורים (כותרת קצרה לכל סעיף): תחום פעילות, תיאור הפעילות, שנות פעילות, נתונים כספיים (מחזור/רווח/מחיר מבוקש) ככל שקיימים, עובדים, ציוד ונכסים, יתרונות/חוזקות, סיכונים אם ידועים, פוטנציאל, סיבת מכירה, ומצב העסק/סטטוס. השתמש בכל הפרטים שבתיאור ובהערות - אל תקצר ואל תשמיט פרטים. זהו מסמך פנימי - מותר ורצוי לכלול פרטים מזהים (שם העסק, בעלים, טלפון, כתובת) כאשר הם קיימים בנתונים.';
  }

  const systemPrompt = `אתה עוזר למשרד תיווך עסקים (BSD Business Brokers Israel) לכתוב תקציר עסקי פנימי (לא אנונימי) על בסיס הנתונים שקיימים בפועל בכרטיס העסק במערכת.

כללים מחייבים:
1. השתמש רק בנתונים שסופקו לך למטה. אסור להמציא נתון שלא קיים - אם משהו חסר, פשוט השמט אותו, אל תנחש ואל תמלא בערך גנרי.
2. ${modeInstructions}
3. מותר להעתיק/לנסח מחדש בחופשיות מתוך הטקסט שסופק - זה לא מסמך אנונימי ואין כאן שום מגבלת חשיפת פרטים מזהים.
4. אם אין כלל מספיק מידע לכתוב תקציר משמעותי - סמן insufficient_info=true והשאר summary_text ריק.
5. כתוב טקסט רגיל בלבד - בלי סימוני Markdown (בלי **, בלי #, בלי כוכביות כלשהן). הטקסט הזה מוצג כמו שהוא בשדה טקסט רגיל ומודפס כפי שהוא ל-PDF, לא עובר רינדור של Markdown. כותרות סעיפים - פשוט שורה נפרדת עם רווח לפניה ואחריה, בלי כוכביות. רשימות - בשורות שמתחילות ב-"•".

חובה להשתמש בכלי submit_business_summary כדי להחזיר את התשובה.`;

  const userPrompt = hasBox
    ? `הטקסט שבתיבה (כפי שהמשתמש כתב אותו כרגע על המסך - זה המקור העיקרי):\n"""\n${boxText}\n"""\n\nנתונים מובנים מהכרטיס (להשלמה בלבד, אם חסרים בטקסט):\n${factsBlock || '(אין נתונים מובנים)'}`
    : `נתונים מובנים קיימים בכרטיס העסק:\n${factsBlock || '(אין נתונים מובנים)'}\n\nטקסט חופשי קיים (תיאור פנימי / הערות):\n"""\n${freeText || '(אין)'}\n"""`;

  return { systemPrompt, userPrompt };
}

async function generateSummary(biz: Record<string, unknown>, mode: Mode, boxText = ''): Promise<{ summary_text: string | null; insufficient_info: boolean }> {
  const prompts = buildInternalPrompts(biz, mode, boxText);
  if (!prompts) return { summary_text: null, insufficient_info: true };
  const { systemPrompt, userPrompt } = prompts;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      // 06.10.2026: 1400 קטע תקצירים מלאים - עכשיו 4000 + בדיקת stop_reason למטה.
      max_tokens: mode === 'short' ? 400 : 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [SUMMARY_TOOL],
      tool_choice: { type: 'tool', name: 'submit_business_summary' },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`יצירת תקציר AI נכשלה (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data && data.stop_reason === 'max_tokens') {
    throw new Error('תשובת ה-AI נחתכה באמצע (ארוכה מדי) - לא שונה כלום. נסה שוב.');
  }
  const toolBlock = (data.content || []).find((b: { type: string }) => b.type === 'tool_use');
  if (!toolBlock || typeof toolBlock.input !== 'object' || toolBlock.input === null) {
    throw new Error('התשובה מ-Claude לא הגיעה במבנה הצפוי (tool_use חסר) - נסה שוב');
  }
  const input = toolBlock.input as { summary_text?: string; insufficient_info?: boolean };
  // רשת ביטחון: גם עם ההנחיה המפורשת לא להשתמש ב-Markdown, לפעמים המודל
  // עדיין מכניס כוכביות - מנקים אותן כאן כדי שלעולם לא יופיעו כטקסט גולמי
  // בשדה/ב-PDF (שאינם מרנדרים Markdown).
  const cleanText = (t: string | null | undefined) => t ? t.replace(/\*\*/g, '').replace(/^#+\s*/gm, '') : t;
  return {
    summary_text: input.insufficient_info ? null : cleanText(input.summary_text) || null,
    insufficient_info: !!input.insufficient_info,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  try {
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: 'ANTHROPIC_API_KEY לא מוגדר ב-Secrets' }, 500);

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonResponse({ error: 'לא מחובר' }, 401);

    const body = await req.json();
    const { business_id, mode } = body;
    if (!business_id) return jsonResponse({ error: 'חסר business_id' }, 400);
    if (mode !== 'short' && mode !== 'internal_full') return jsonResponse({ error: 'mode לא תקין - נדרש short או internal_full' }, 400);

    const { data: biz, error: bizErr } = await supabase.from('businesses').select('*').eq('id', business_id).maybeSingle();
    if (bizErr || !biz) return jsonResponse({ error: 'עסק לא נמצא' }, 404);

    // הרשאה: כל מי שמורשה לצפות/לערוך את העסק (לא מחמיר יותר כמו האנונימי -
    // זהו תוכן פנימי רגיל, לא דורש הרשאת אדמין/מנהל מיוחדת).
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
    if (!profile) return jsonResponse({ error: 'פרופיל משתמש לא נמצא' }, 403);

    if (body.action === 'confirm') {
      const finalText = typeof body.text === 'string' ? body.text.trim() || null : null;
      if (mode === 'short') {
        const { error: updErr } = await supabase.from('businesses').update({
          short_description: finalText,
          short_description_ai_edited_at: new Date().toISOString(),
          short_description_ai_edited_by: userData.user.id,
        }).eq('id', business_id);
        if (updErr) return jsonResponse({ error: 'שגיאה בשמירה: ' + updErr.message }, 500);
      } else {
        const { error: updErr } = await supabase.from('businesses').update({
          internal_business_summary: finalText,
          internal_business_summary_generated_at: new Date().toISOString(),
          internal_business_summary_generated_by: userData.user.id,
        }).eq('id', business_id);
        if (updErr) return jsonResponse({ error: 'שגיאה בשמירה: ' + updErr.message }, 500);
      }
      return jsonResponse({ text: finalText });
    }

    const merged = mergeFormOverDb(biz, body.form);
    const boxText = mode === 'internal_full' ? pickBoxText(body.form, biz.internal_business_summary) : '';
    const generated = await generateSummary(merged, mode as Mode, boxText);
    return jsonResponse({
      text: generated.summary_text,
      warnings: generated.insufficient_info ? ['אין מספיק מידע כדי לכתוב תקציר אמין - הוסף פרטים לעסק ונסה שוב'] : [],
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
