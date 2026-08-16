// BSD CRM - generate-anonymous-card Edge Function
//
// Builds an anonymous business card for a given business: a short generic
// display name (e.g. "עסק בתחום המזון") and a 1-2 sentence summary that is
// REWRITTEN by Claude from the business's own description/notes/sale reason -
// never a copy or lightly-redacted version of the original text.
//
// Two independent safety layers before anything is saved:
//   1. Claude itself self-checks its own output and reports any concern.
//   2. A local (non-AI) regex/substring scan of the final text against the
//      business's own real name, owner name, phone, email, website, and
//      generic phone/email/URL patterns. If ANYTHING trips, the function
//      refuses to save and returns an error for manual review - it never
//      tries to auto-fix or guess at a "safer" version.
// If there isn't enough source material to write a reliable summary, the
// function deliberately returns without a summary rather than inventing one.
//
// Requires: ANTHROPIC_API_KEY secret (already used by analyze-meeting-audio).
//
// Called from businesses.html via:
//   supabase.functions.invoke('generate-anonymous-card', { body: { business_id } })
//   -> { anon_display_name, anon_summary, warnings: [] }
//   or -> { error: "..." } (nothing saved) if the safety check fails.

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

function extractJson(raw: string): unknown {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  return JSON.parse(text);
}

// ---------- שלב 1: יצירת התקציר (Claude כותב מחדש, לא מעתיק) ----------
async function generateSummary(biz: Record<string, unknown>): Promise<{ anon_display_name: string | null; anon_summary: string | null; ai_flagged_concerns: string[] }> {
  const sourceText = [biz.short_description, biz.notes, biz.anon_card_show_reason ? biz.sale_reason : null]
    .filter(Boolean).join('\n---\n');

  const systemPrompt = `אתה עוזר למשרד תיווך עסקים (BSD Business Brokers Israel) ליצור כרטיס עסק אנונימי, שיוצג למשתמשים שאינם רשאים לראות את פרטי העסק המלאים.

כללים מחייבים, בלי יוצא מן הכלל:
1. אסור להעתיק אף משפט מהטקסט המקורי. אתה צריך להבין את התוכן ולכתוב תקציר חדש משלך, קצר (1-2 משפטים בלבד).
2. אסור שהתקציר יכיל: שם העסק, שם בעל העסק או כל אדם, שמות עובדים, כתובת, רחוב, מספר בית, טלפון, אימייל, אתר אינטרנט, קישור לרשת חברתית, שם לקוח או ספק, או כל פרט ייחודי מדי שעלול לזהות את העסק באופן סביר (למשל "העסק היחיד מסוגו בעיר X").
3. שם תצוגה אנונימי (anon_display_name): ביטוי גנרי קצר לפי תחום הפעילות בלבד, למשל "עסק בתחום המזון", "עסק תעשייתי ותיק", "חנות קמעונאית בתחום האופנה" - לא שם אמיתי ולא תיאור ייחודי מדי.
4. אם אין מספיק מידע כדי לכתוב תקציר אמין ובטוח - אל תמציא. החזר anon_summary כ-null.
5. בסוף, בדוק את התקציר שכתבת בעצמך פעם נוספת לפני שאתה מחזיר תשובה - אם יש בו ולו חשד קל להפרת אחד הכללים למעלה, רשום זאת ב-ai_flagged_concerns ואל תכלול את הפרט הבעייתי בתקציר עצמו.

החזר אך ורק אובייקט JSON תקני (בלי טקסט נוסף, בלי סימוני קוד), במבנה המדויק:
{
  "anon_display_name": "ביטוי גנרי קצר, או null אם אין מספיק מידע",
  "anon_summary": "1-2 משפטים חדשים ואנונימיים לגמרי, או null אם אין מספיק מידע אמין",
  "ai_flagged_concerns": ["רשימת חששות אם יש, אחרת מערך ריק"]
}`;

  const userPrompt = `נתונים כלליים על העסק (מותרים להצגה): תחום=${biz.field || ''}, קטגוריה=${biz.category || ''}, עיר=${biz.city || ''}, וותק=${biz.years_active || ''} שנים, עובדים=${biz.employees_count || ''}.

טקסט מקור (תיאור/הערות/סיבת מכירה - לשימושך הפנימי בלבד, אסור להעתיק ממנו):
"""
${sourceText || '(אין טקסט מקור זמין)'}
"""`;

  if (!sourceText.trim()) {
    // אין בכלל טקסט חופשי - אין מה לתמצת, ואין טעם לקרוא ל-AI על ריק (סעיף 4)
    return { anon_display_name: null, anon_summary: null, ai_flagged_concerns: [] };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`יצירת תקציר AI נכשלה: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find((b: { type: string }) => b.type === 'text');
  if (!textBlock) throw new Error('תשובת Claude לא הכילה טקסט');
  const parsed = extractJson(textBlock.text) as { anon_display_name?: string | null; anon_summary?: string | null; ai_flagged_concerns?: string[] };
  return {
    anon_display_name: parsed.anon_display_name || null,
    anon_summary: parsed.anon_summary || null,
    ai_flagged_concerns: parsed.ai_flagged_concerns || [],
  };
}

// ---------- שלב 2: רשת ביטחון מקומית, לא תלויה ב-AI (תמיד רצה) ----------
function localSafetyScan(text: string, biz: Record<string, unknown>): string[] {
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

    // בדיקת הרשאה: מותר רק ליוצר/מטפל/אדמין/מנהל של העסק - אותה לוגיקה כמו
    // has_full_business_access ב-DB, נבדקת כאן ידנית כי הפונקציה רצה
    // עם service_role שעוקף RLS
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
    const { data: biz, error: bizErr } = await supabase.from('businesses').select('*').eq('id', business_id).maybeSingle();
    if (bizErr || !biz) return jsonResponse({ error: 'עסק לא נמצא' }, 404);

    const isAdminOrManager = profile && ['admin', 'manager'].includes(profile.role);
    const isOwnerOrHandler = biz.created_by === userData.user.id || biz.handled_by === userData.user.id;
    let hasGrant = false;
    if (!isAdminOrManager && !isOwnerOrHandler) {
      const { data: grant } = await supabase.from('business_access_grants').select('id')
        .eq('business_id', business_id).eq('granted_to', userData.user.id).eq('active', true).maybeSingle();
      hasGrant = !!grant;
    }
    if (!isAdminOrManager && !isOwnerOrHandler && !hasGrant) {
      return jsonResponse({ error: 'אין הרשאה ליצור תקציר אנונימי לעסק זה' }, 403);
    }

    const generated = await generateSummary(biz);

    // רשת ביטחון מקומית תמיד רצה, גם אם ה-AI עצמו לא דיווח על חשש
    const scanTarget = [generated.anon_display_name, generated.anon_summary].filter(Boolean).join(' ');
    const localHits = localSafetyScan(scanTarget, biz);
    const allConcerns = [...generated.ai_flagged_concerns, ...localHits];

    if (allConcerns.length) {
      // לא שומרים כלום - מחזירים למשתמש לבדיקה ידנית, לא מנחשים גרסה "בטוחה" יותר
      return jsonResponse({
        error: 'התקציר שנוצר נכשל בבדיקת האנונימיות ולא נשמר',
        concerns: allConcerns,
        draft_display_name: generated.anon_display_name,
        draft_summary: generated.anon_summary,
      }, 422);
    }

    const sourceHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
      [biz.internal_name, biz.short_description, biz.notes, biz.sale_reason].filter(Boolean).join('|')
    )).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));

    const { error: updateErr } = await supabase.from('businesses').update({
      anon_display_name: generated.anon_display_name,
      anon_summary: generated.anon_summary,
      anon_summary_generated_at: new Date().toISOString(),
      anon_summary_generated_by: userData.user.id,
      anon_summary_source_hash: sourceHash,
    }).eq('id', business_id);
    if (updateErr) return jsonResponse({ error: 'שגיאה בשמירת התקציר: ' + updateErr.message }, 500);

    return jsonResponse({
      anon_display_name: generated.anon_display_name,
      anon_summary: generated.anon_summary,
      warnings: generated.anon_summary ? [] : ['אין מספיק מידע כדי לכתוב תקציר אמין - הכרטיס יוצג בלי תיאור'],
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
