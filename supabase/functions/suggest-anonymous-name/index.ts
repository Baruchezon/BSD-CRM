// BSD CRM - suggest-anonymous-name Edge Function
//
// "הצע" button next to "שם אנונימי" on the business form (businesses.html).
// Replaces the old naive client-side template (which produced a full
// sentence, e.g. "עסק בתחום המזון ותיק, רווחי בהיקף משמעותי, באזור המרכז")
// with a short, AI-picked 2-3 word label describing the business's core
// field of activity - e.g. "מפעל עיבוד שבבי", "חנות אופנת נשים".
//
// Design, per explicit spec:
//   - Stateless, no business_id/DB read at all - takes field/category/
//     subcategory/short_description straight from the live form fields.
//     Works identically for a brand-new, not-yet-saved business.
//   - The real business name, owner, address, city etc. are NEVER sent to
//     the model at all - structurally impossible for the suggestion to
//     leak them, rather than relying only on a prompt instruction.
//   - Hard word-count enforcement (2-3 words) in code, not just prompt
//     wording - one retry with a corrective instruction if the model's
//     first attempt misses, then insufficient_info if it still misses.
//   - Never invents a field of activity - if the input doesn't contain
//     enough signal, returns insufficient_info=true and no name.
//   - Never writes to the database - purely returns a suggestion for the
//     client to place in the field, pending the user's own save.
//
// Requires: ANTHROPIC_API_KEY secret (already used by other AI functions).
//
// Called from businesses.html via:
//   supabase.functions.invoke('suggest-anonymous-name', {
//     body: { field, category, subcategory, short_description }
//   })

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanEnv(v: string | undefined): string {
  return (v || '').trim();
}

const ANTHROPIC_API_KEY = cleanEnv(Deno.env.get('ANTHROPIC_API_KEY'));
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// נדרש רק כדי לאמת שהמשתמש מחובר - אין כאן שום קריאה/כתיבה לטבלת businesses.
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

const NAME_TOOL = {
  name: 'submit_anon_name',
  description: 'הגשת הצעה לשם אנונימי קצר (2-3 מילים) המתאר את תחום העיסוק המרכזי של העסק',
  input_schema: {
    type: 'object',
    properties: {
      anon_name: {
        type: ['string', 'null'],
        description: 'שם אנונימי בן 2-3 מילים בלבד, המתאר את תחום העיסוק המרכזי - למשל "מפעל עיבוד שבבי" או "חנות אופנת נשים". null אם אין מספיק מידע.',
      },
      insufficient_info: {
        type: 'boolean',
        description: 'true אם אין מספיק מידע בקלט כדי לזהות בבירור את תחום העיסוק המרכזי',
      },
    },
    required: ['anon_name', 'insufficient_info'],
  },
};

function buildSystemPrompt(retry: boolean): string {
  const rules = [
    'הפק שם אנונימי קצר בן שתיים עד שלוש מילים בדיוק - לא פחות ולא יותר.',
    'השם חייב לתאר בבירור את תחום העיסוק המרכזי של העסק (למשל: "מפעל עיבוד שבבי", "חנות אופנת נשים", "מרכז טיפולי מים", "יבואן ציוד רפואי", "מסעדת אוכל איטלקי", "חברת ניקיון מוסדי").',
    'לעולם אל תכלול שם עסק אמיתי, שם בעלים, מותג, כתובת, עיר או כל פרט אחר שעלול לחשוף את זהות העסק - ממילא לא סופקו לך פרטים כאלה, אז אל תמציא אותם.',
    'לעולם אל תשתמש במשפטים שיווקיים, סופרלטיבים ("מצליח", "רווחי", "הזדמנות") או תיאורים כלליים שאינם מסבירים במה העסק עוסק בפועל.',
    'התבסס אך ורק על תחום הפעילות, הקטגוריה והתיאור שסופקו לך - אם אין בהם מספיק מידע כדי לזהות תחום עיסוק ברור, סמן insufficient_info=true ואל תמציא שם.',
  ];
  if (retry) {
    rules.unshift('הניסיון הקודם שלך לא עמד בדרישת שתיים-שלוש מילים בדיוק - הקפד הפעם בדיוק על 2 או 3 מילים, לא יותר ולא פחות.');
  }
  return `אתה עוזר לסוכני BSD Business Brokers Israel להציע שם תצוגה אנונימי קצר לעסק בכרטיס CRM.\n\nכללים מחייבים:\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nחובה להשתמש בכלי submit_anon_name כדי להחזיר את התשובה.`;
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function looksIdentifying(s: string): boolean {
  if (!s) return false;
  if (/0\d{1,2}[-\s]?\d{7}/.test(s)) return true;
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(s)) return true;
  if (/(https?:\/\/|www\.)/i.test(s)) return true;
  return false;
}

async function callClaude(userPrompt: string, retry: boolean): Promise<{ anon_name: string | null; insufficient_info: boolean }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      system: buildSystemPrompt(retry),
      messages: [{ role: 'user', content: userPrompt }],
      tools: [NAME_TOOL],
      tool_choice: { type: 'tool', name: 'submit_anon_name' },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`הצעת השם נכשלה (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const toolBlock = (data.content || []).find((b: { type: string }) => b.type === 'tool_use');
  if (!toolBlock || typeof toolBlock.input !== 'object' || toolBlock.input === null) {
    throw new Error('התשובה מ-Claude לא הגיעה במבנה הצפוי - נסה שוב');
  }
  const input = toolBlock.input as { anon_name?: string | null; insufficient_info?: boolean };
  return { anon_name: input.anon_name || null, insufficient_info: !!input.insufficient_info };
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
    const field = typeof body.field === 'string' ? body.field.trim() : '';
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const subcategory = typeof body.subcategory === 'string' ? body.subcategory.trim() : '';
    const shortDescription = typeof body.short_description === 'string' ? body.short_description.trim() : '';

    if (!field && !category && !subcategory && !shortDescription) {
      return jsonResponse({ anon_name: null, insufficient_info: true, message: 'אין מספיק מידע להצעת שם אנונימי. יש להשלים את תיאור העסק או את תחום הפעילות.' });
    }

    // חשוב: לעולם לא נשלחים ל-AI שם העסק, שם בעלים, כתובת, עיר וכו' - רק
    // תחום/קטגוריה/תיאור, בדיוק כמו שסופקו למעלה. זו הגנה מבנית, לא רק הנחיה.
    const userPrompt = `תחום פעילות: ${field || '(לא צוין)'}\nקטגוריה: ${category || '(לא צוין)'}\nתת-קטגוריה: ${subcategory || '(לא צוין)'}\nתיאור קצר של העסק: ${shortDescription || '(לא צוין)'}`;

    let result = await callClaude(userPrompt, false);
    let candidate = (result.anon_name || '').trim();

    // רשת ביטחון מקומית לספירת מילים - לא סומכים רק על ההנחיה למודל.
    // ניסיון שני עם הנחיה מתקנת אם הראשון לא עמד בדיוק ב-2-3 מילים.
    if (!result.insufficient_info && candidate && (countWords(candidate) < 2 || countWords(candidate) > 3)) {
      result = await callClaude(userPrompt, true);
      candidate = (result.anon_name || '').trim();
    }

    if (result.insufficient_info || !candidate || countWords(candidate) < 2 || countWords(candidate) > 3 || looksIdentifying(candidate)) {
      return jsonResponse({ anon_name: null, insufficient_info: true, message: 'אין מספיק מידע להצעת שם אנונימי. יש להשלים את תיאור העסק או את תחום הפעילות.' });
    }

    return jsonResponse({ anon_name: candidate, insufficient_info: false });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
