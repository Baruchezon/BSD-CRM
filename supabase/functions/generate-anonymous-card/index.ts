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
import { buildAnonInput, buildAnonPrompts, localSafetyScan } from './lib.ts';

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
      warnings: generated.anon_summary ? [] : ['אין מספיק מידע כדי לכתוב תקציר אמין - כתוב את המידע על העסק בתיבה «כל המידע על העסק» ונסה שוב'],
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
