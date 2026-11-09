// Internal meeting-prep web research for one business.
//
// Reuses the same Anthropic web_search tool and ANTHROPIC_API_KEY secret as
// the deployed survey-report function. Differences, on purpose:
//   - does not send email and does not write to the database
//   - the browser saves the result onto the business row the user can already edit
//   - searches only with public identity fields (name, city, address, website, phone)
//   - never reads the office research note or the call write-up, so a CRM line
//     like «נקבעה פגישה» cannot be echoed back as market research
//   - if the web search finds nothing, the strings come back empty
//
// Deploy: supabase functions deploy meeting-prep-research
// Secret already configured: ANTHROPIC_API_KEY
// Requires the caller to be logged in and to have full access to that business.

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanEnv(v: string | undefined): string {
  return (v || '').trim();
}

const ANTHROPIC_API_KEY = cleanEnv(Deno.env.get('ANTHROPIC_API_KEY'));
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REVIEW = /ביקור|דירוג|כוכב|גוגל|welp|medreview|איזי/i;
const EMPTY_LINE = /^(לא נמצא|לא ידוע|לא תועד|אין מידע|אין נתונים|לא אותר|לא דווח)/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

export function cleanBlock(value: string): string {
  return String(value || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      const bare = line.replace(/^[-•*]\s*/, '').trim();
      return bare && !EMPTY_LINE.test(bare);
    })
    .join('\n')
    .trim();
}

export function parseWebResearch(raw: string): { research: string; reviews: string } {
  const src = String(raw || '').replace(/\r/g, '');
  const at = src.search(/^##\s*ביקורות/m);
  let research = src;
  let reviews = '';
  if (at >= 0) {
    research = src.slice(0, at);
    reviews = src.slice(at).replace(/^##\s*ביקורות[^\n]*\n?/, '');
  }
  research = research.replace(/^##\s*חקר[^\n]*\n?/, '');
  if (at < 0) {
    const lines = cleanBlock(research).split('\n').filter(Boolean);
    return {
      research: cleanBlock(lines.filter(line => !REVIEW.test(line)).join('\n')),
      reviews: cleanBlock(lines.filter(line => REVIEW.test(line)).join('\n')),
    };
  }
  return { research: cleanBlock(research), reviews: cleanBlock(reviews) };
}

function filled(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function searchPrompt(biz: Record<string, unknown>): string {
  const lines = [
    filled(biz.internal_name) && `שם העסק: ${filled(biz.internal_name)}`,
    filled(biz.field) && `תחום: ${filled(biz.field)}`,
    filled(biz.category) && `קטגוריה: ${filled(biz.category)}`,
    filled(biz.subcategory) && `תת-קטגוריה: ${filled(biz.subcategory)}`,
    filled(biz.city) && `עיר: ${filled(biz.city)}`,
    filled(biz.region) && `אזור: ${filled(biz.region)}`,
    filled(biz.address) && `כתובת: ${filled(biz.address)}`,
    filled(biz.website) && `אתר: ${filled(biz.website)}`,
    filled(biz.owner_phone) && `טלפון לזיהוי בלבד (ייתכן שזה נייד של הבעלים, לא מספר העסק): ${filled(biz.owner_phone)}`,
  ].filter(Boolean);
  return `אתה חוקר שוק פנימי של BSD. חפש באינטרנט מידע פומבי על העסק הבא, כדי שסוכן ייכנס לפגישה עם נקודות לשיחה. זה מסמך פנימי. אל תנסח פנייה ללקוח ואל תשלח דבר.

עובדות לחיפוש בלבד (לא לאשר אותן אם הרשת סותרת):
${lines.join('\n')}

חובה כמה חיפושים נפרדים: שם + עיר, שם + ביקורות / Google reviews, האתר הרשמי, שם + פייסבוק / אינסטגרם.

כתוב רק מה שמקור פומבי תומך בו. אסור להמציא דירוג, מספר ביקורות, ציטוט, מוצר, כתובת או נוכחות ברשת. אם חיפוש לא מצא כלום — השאר את הסעיף ריק לגמרי. אל תכתוב «לא נמצא», «לא ידוע», «אין מידע» או «לא תועד».

אל תכלול סטטוס מתוך CRM: לא «נקבעה פגישה», לא «לא מאומת», לא «הערת דנה», לא מספר ליד.

הפורמט, בעברית, בדיוק כך:

## חקר
נקודות על מה העסק מציע (מוצרים/שירותים), נוכחות באתר וברשתות, ומוניטין. כמה משפטים או תבליטים.

## ביקורות
דירוג ומספר ביקורות אם פורסמו, ומה חוזר בביקורות. בלי דירוג — אל תנחש מספר.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  try {
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: 'ANTHROPIC_API_KEY לא מוגדר ב-Secrets' }, 500);
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonResponse({ error: 'לא מחובר' }, 401);

    const body = await req.json().catch(() => ({}));
    const businessId = typeof body.business_id === 'string' ? body.business_id.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(businessId)) return jsonResponse({ error: 'business_id חסר' }, 400);

    const { data: allowed, error: accessErr } = await supabase.rpc('has_full_business_access', {
      biz_id: businessId,
      uid: userData.user.id,
    });
    if (accessErr || allowed !== true) return jsonResponse({ error: 'אין הרשאה לחקר העסק הזה' }, 403);

    const { data: biz, error: bizErr } = await supabase
      .from('businesses')
      .select('id, internal_name, field, category, subcategory, city, region, address, website, owner_phone')
      .eq('id', businessId)
      .maybeSingle();
    if (bizErr) return jsonResponse({ error: bizErr.message }, 500);
    if (!biz) return jsonResponse({ error: 'העסק לא נמצא' }, 404);
    if (!filled(biz.internal_name) && !filled(biz.website) && !filled(biz.owner_phone)) {
      return jsonResponse({ research: '', reviews: '' });
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
        messages: [{ role: 'user', content: searchPrompt(biz) }],
      }),
    });
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return jsonResponse({ error: `חיפוש הרשת נכשל (${aiRes.status}): ${errText.slice(0, 300)}` }, 502);
    }
    const aiData = await aiRes.json();
    const raw = (aiData.content || [])
      .filter((c: { type?: string }) => c.type === 'text')
      .map((c: { text?: string }) => c.text || '')
      .join('\n\n');
    const parsed = parseWebResearch(raw);
    return jsonResponse({ ok: true, research: parsed.research, reviews: parsed.reviews });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
