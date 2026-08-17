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
//   supabase.functions.invoke('generate-anonymous-card', { body: { business_id } })
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
  description: 'הגשת כרטיס עסק אנונימי סופי, שכתוב מחדש ובטוח לפרסום',
  input_schema: {
    type: 'object',
    properties: {
      anon_display_name: { type: ['string', 'null'], description: 'ביטוי גנרי קצר לפי תחום הפעילות, או null אם אין מספיק מידע' },
      field_desc: { type: ['string', 'null'], description: 'תיאור כללי של תחום הפעילות, או null' },
      region: { type: ['string', 'null'], description: 'אזור/עיר בלבד, מנוסח כך שלא חושף את זהות העסק, או null' },
      opportunity: { type: ['string', 'null'], description: 'מה הופך את העסק למעניין עבור קונה - 1-2 משפטים, או null' },
      key_facts: { type: 'array', items: { type: 'string' }, description: 'רשימת עובדות מרכזיות שקיימות בפועל בנתונים (מחזור/רווחיות/עובדים/וותק/לקוחות/נכסים/פוטנציאל) - רק מה שבאמת קיים, בלי להמציא. מערך ריק אם אין נתונים.' },
      ai_flagged_concerns: { type: 'array', items: { type: 'string' }, description: 'רשימת חששות אנונימיות אם יש, אחרת מערך ריק' },
    },
    required: ['anon_display_name', 'field_desc', 'region', 'opportunity', 'key_facts', 'ai_flagged_concerns'],
  },
};

function formatKeyFacts(facts: string[]): string {
  return facts.filter(Boolean).map(f => `• ${f}`).join('\n');
}

// ---------- שלב 1: יצירת התקציר (Claude כותב מחדש, לא מעתיק) ----------
async function generateSummary(biz: Record<string, unknown>): Promise<{ anon_display_name: string | null; anon_summary: string | null; ai_flagged_concerns: string[] }> {
  const sourceText = [biz.short_description, biz.notes, biz.anon_card_show_reason ? biz.sale_reason : null]
    .filter(Boolean).join('\n---\n');

  if (!sourceText.trim()) {
    // אין בכלל טקסט חופשי - אין מה לתמצת, ואין טעם לקרוא ל-AI על ריק (סעיף 4)
    return { anon_display_name: null, anon_summary: null, ai_flagged_concerns: [] };
  }

  const systemPrompt = `אתה עוזר למשרד תיווך עסקים (BSD Business Brokers Israel) ליצור כרטיס עסק אנונימי מקצועי ושיווקי, שיוצג למשתמשים שאינם רשאים לראות את פרטי העסק המלאים. המטרה: לאפשר לסוכן או לקונה להבין את ההזדמנות העסקית בלי לחשוף מידע שמאפשר לזהות את העסק.

כללים מחייבים, בלי יוצא מן הכלל:
1. אסור להעתיק אף משפט מהטקסט המקורי או מההערות כפי שהן. תמצת והבן, ואז כתוב מחדש במילים שלך.
2. אסור שיופיע: שם העסק, שם בעל העסק או כל אדם, שמות עובדים, כתובת, רחוב, מספר בית, טלפון, אימייל, אתר אינטרנט, קישור לרשת חברתית, שם לקוח או ספק, מותג ייחודי, או כל פרט ייחודי מדי שעלול לזהות את העסק באופן סביר (למשל "העסק היחיד מסוגו בעיר X").
3. anon_display_name: ביטוי גנרי קצר לפי תחום הפעילות בלבד, למשל "עסק בתחום המזון" - לא שם אמיתי ולא תיאור ייחודי מדי.
4. region: אזור כללי בלבד (למשל "אזור המרכז"), לעולם לא כתובת מדויקת.
5. key_facts: רק עובדות שבאמת קיימות בנתונים שסופקו לך למטה (מחזור/רווחיות/עובדים/וותק/לקוחות/נכסים/פוטנציאל צמיחה) - אל תמציא נתון שלא סופק, ואל תכלול נתון אם הוא עלול לבדו לזהות את העסק.
6. אם אין מספיק מידע אמין לשדה מסוים - החזר null עבורו (או מערך ריק ל-key_facts), אל תמציא.
7. בסוף, בדוק את מה שכתבת בעצמך פעם נוספת - אם יש ולו חשד קל להפרת אחד הכללים, רשום זאת ב-ai_flagged_concerns ואל תכלול את הפרט הבעייתי בתשובה עצמה.

חובה להשתמש בכלי submit_anonymous_card כדי להחזיר את התשובה.`;

  const factsAvailable: string[] = [];
  if (biz.annual_revenue) factsAvailable.push(`מחזור שנתי משוער: ${biz.annual_revenue}`);
  if (biz.operating_profit) factsAvailable.push(`רווח תפעולי משוער: ${biz.operating_profit}`);
  if (biz.net_profit) factsAvailable.push(`רווח נקי משוער: ${biz.net_profit}`);
  if (biz.employees_count) factsAvailable.push(`מספר עובדים: ${biz.employees_count}`);
  if (biz.years_active) factsAvailable.push(`שנות פעילות: ${biz.years_active}`);

  const userPrompt = `נתונים כלליים על העסק (מותרים להצגה): תחום=${biz.field || ''}, קטגוריה=${biz.category || ''}, עיר=${biz.city || ''}.

נתונים כמותיים זמינים (אלה שקיימים בפועל בלבד - אל תמציא נוספים):
${factsAvailable.length ? factsAvailable.join('\n') : '(אין נתונים כמותיים זמינים)'}

טקסט מקור (תיאור/הערות/סיבת מכירה - לשימושך הפנימי בלבד, אסור להעתיק ממנו):
"""
${sourceText}
"""`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 900,
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
  const toolBlock = (data.content || []).find((b: { type: string }) => b.type === 'tool_use');
  if (!toolBlock || typeof toolBlock.input !== 'object' || toolBlock.input === null) {
    // לא אמור לקרות עם tool_choice מאולץ, אבל אם כן - הודעה ברורה, לא קריסה
    throw new Error('התשובה מ-Claude לא הגיעה במבנה הצפוי (tool_use חסר) - נסה שוב');
  }
  const input = toolBlock.input as {
    anon_display_name?: string | null; field_desc?: string | null; region?: string | null;
    opportunity?: string | null; key_facts?: string[]; ai_flagged_concerns?: string[];
  };

  const sections: string[] = [];
  if (input.field_desc) sections.push(`תחום פעילות:\n${input.field_desc}`);
  if (input.region) sections.push(`אזור:\n${input.region}`);
  if (input.opportunity) sections.push(`הזדמנות עסקית:\n${input.opportunity}`);
  if (Array.isArray(input.key_facts) && input.key_facts.length) sections.push(`נתונים מרכזיים:\n${formatKeyFacts(input.key_facts)}`);

  return {
    anon_display_name: input.anon_display_name || null,
    anon_summary: sections.length ? sections.join('\n\n') : null,
    ai_flagged_concerns: Array.isArray(input.ai_flagged_concerns) ? input.ai_flagged_concerns : [],
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

  return hits;
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
      const sourceHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
        [biz.internal_name, biz.short_description, biz.notes, biz.sale_reason].filter(Boolean).join('|')
      )).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
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
    const generated = await generateSummary(biz);
    const scanTarget = [generated.anon_display_name, generated.anon_summary].filter(Boolean).join(' ');
    const localHits = localSafetyScan(scanTarget, biz);
    const allConcerns = [...generated.ai_flagged_concerns, ...localHits];

    return jsonResponse({
      anon_display_name: generated.anon_display_name,
      anon_summary: generated.anon_summary,
      concerns: allConcerns,
      warnings: generated.anon_summary ? [] : ['אין מספיק מידע כדי לכתוב תקציר אמין - הוסף תיאור/הערות לעסק ונסה שוב'],
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
