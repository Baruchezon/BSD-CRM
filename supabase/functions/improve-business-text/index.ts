// BSD CRM - improve-business-text Edge Function
//
// Rewrites ONE field's text (short_description or notes) that the user has
// typed into the business form - "שיפור ניסוח באמצעות AI" / "סידור וניסוח
// מקצועי באמצעות AI" buttons on businesses.html.
//
// Design, per explicit spec:
//   - Stateless single call: receives the CURRENT text straight from the
//     form field (not from the DB), so this works identically for a brand
//     new, not-yet-saved business and for an existing one - there is no
//     business_id requirement at all.
//   - NEVER writes to the database. The rewritten text is only ever shown
//     in a client-side preview modal; the real save still goes through the
//     normal "שמירה" button and saveBiz(), exactly like manual typing would.
//     This satisfies "no automatic save without explicit approval" and
//     "allow reverting to the original" by construction - nothing here is
//     persisted until the user's own save.
//   - Must never invent facts/numbers/advantages that were not in the
//     source text, and must never guess at missing information - enforced
//     via the system prompt AND via tool-use (forced structured output,
//     same pattern as generate-anonymous-card, to avoid free-text JSON
//     parsing failures).
//
// Requires: ANTHROPIC_API_KEY secret (already used by analyze-meeting-audio
// and generate-anonymous-card - no new secret needed).
//
// Called from businesses.html via:
//   supabase.functions.invoke('improve-business-text', {
//     body: { field_type: 'short_description' | 'notes', source_text, is_anonymous }
//   })

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanEnv(v: string | undefined): string {
  return (v || '').trim();
}

const ANTHROPIC_API_KEY = cleanEnv(Deno.env.get('ANTHROPIC_API_KEY'));
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// נדרש רק כדי לאמת שהמשתמש מחובר (auth.getUser) - אין כאן שום קריאה/כתיבה
// לטבלת businesses, בכוונה: הפונקציה הזו לא נוגעת בבסיס הנתונים בכלל.
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

// סכימת הכלי (tool) שכפית את Claude להחזיר JSON תקני ומובנה - כמו
// ב-generate-anonymous-card, כדי למנוע שגיאות פענוח JSON חופשי.
const IMPROVE_TOOL = {
  name: 'submit_improved_text',
  description: 'הגשת ניסוח משופר לטקסט שהוזן על ידי המשתמש, בלי להוסיף שום מידע שלא היה במקור',
  input_schema: {
    type: 'object',
    properties: {
      improved_text: {
        type: 'string',
        description: 'הטקסט המשופר, במילים חדשות - אך ורק על בסיס מה שכבר הופיע בטקסט המקורי, בלי שום עובדה/מספר/יתרון חדש',
      },
      insufficient_info: {
        type: 'boolean',
        description: 'true אם הטקסט המקורי ריק כמעט לגמרי או חסר תוכן מהותי, כך שאין מה לשפר בצורה משמעותית',
      },
      notes_to_user: {
        type: ['string', 'null'],
        description: 'הערה קצרה ואופציונלית למשתמש - למשל אם היה חסר מידע חשוב שלא הושלם בניחוש, או אם משהו הושמט בכוונה בגלל דיסקרטיות',
      },
    },
    required: ['improved_text', 'insufficient_info'],
  },
};

function buildSystemPrompt(fieldType: 'short_description' | 'notes', isAnonymous: boolean): string {
  const commonRules = [
    'לעולם אל תמציא נתונים, מספרים, יתרונות או עובדות שלא הופיעו במפורש בטקסט המקורי שסופק לך.',
    'אם חסר מידע או שהטקסט המקורי עמום - אל תשלים את החסר בניחוש, פשוט נסח מחדש את מה שבאמת יש בצורה הטובה ביותר.',
    'אם הטקסט המקורי ריק כמעט לגמרי או חסר תוכן מהותי לשיפור - סמן insufficient_info=true, ואל תמלא אותו בתוכן שלא סופק.',
  ];

  if (fieldType === 'short_description') {
    const rules = [
      'נסח מחדש את "תיאור קצר של העסק" עבור כרטיס עסק במערכת CRM פנימית של BSD Business Brokers Israel.',
      'הניסוח צריך להיות תמציתי, ברור, שיווקי ומכובד - מתאים להצגת עסק בפני קונים וסוכנים.',
      ...commonRules,
    ];
    if (isAnonymous) {
      rules.push(
        'העסק מסומן כאנונימי: אל תכלול בניסוח המשופר שם העסק, שם הבעלים, כתובת מדויקת, טלפון, אימייל, אתר אינטרנט, שם מותג ייחודי או כל פרט מזהה אחר - גם אם הם הופיעו בטקסט המקורי, השמט אותם והשאר את שאר התוכן.'
      );
    }
    return `אתה עוזר לסוכני BSD Business Brokers Israel לשפר ניסוח.\n\nכללים מחייבים:\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nחובה להשתמש בכלי submit_improved_text כדי להחזיר את התשובה.`;
  }

  // notes
  const rules = [
    'סדר ונסח מחדש את "הערות" הפנימיות על עסק בכרטיס עסק במערכת CRM.',
    'תקן שגיאות כתיב ונסח בצורה ברורה ומקצועית.',
    'אם יש בפועל יותר מנושא אחד בטקסט (למשל: רקע, נתונים פיננסיים, לקוחות, סיכונים, משימות המשך) - חלק לפי נושאים עם כותרות קצרות; אם מדובר בנושא אחד בלבד, אל תמציא חלוקה מלאכותית.',
    'שמור על מלוא הפרטים והעובדות מהטקסט המקורי - אסור למחוק או להשמיט שום פרט, גם אם הוא נראה שולי.',
    ...commonRules,
  ];
  return `אתה עוזר לסוכני BSD Business Brokers Israel לסדר הערות פנימיות.\n\nכללים מחייבים:\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nחובה להשתמש בכלי submit_improved_text כדי להחזיר את התשובה.`;
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
    const fieldType = body.field_type;
    const sourceText = typeof body.source_text === 'string' ? body.source_text.trim() : '';
    const isAnonymous = !!body.is_anonymous;

    if (fieldType !== 'short_description' && fieldType !== 'notes') {
      return jsonResponse({ error: 'field_type לא תקין - צריך short_description או notes' }, 400);
    }
    if (!sourceText) {
      return jsonResponse({ error: 'אין טקסט לשיפור - יש להזין תיאור/הערות תחילה' }, 400);
    }

    const systemPrompt = buildSystemPrompt(fieldType, isAnonymous);
    const userPrompt = `הטקסט המקורי שהוזן על ידי המשתמש (לשימושך בלבד - אל תעתיק אותו מילה במילה, נסח מחדש):\n"""\n${sourceText}\n"""`;

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
        tools: [IMPROVE_TOOL],
        tool_choice: { type: 'tool', name: 'submit_improved_text' },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ error: `שיפור הניסוח נכשל (${res.status}): ${errText.slice(0, 300)}` }, 502);
    }
    const data = await res.json();
    const toolBlock = (data.content || []).find((b: { type: string }) => b.type === 'tool_use');
    if (!toolBlock || typeof toolBlock.input !== 'object' || toolBlock.input === null) {
      return jsonResponse({ error: 'התשובה מ-Claude לא הגיעה במבנה הצפוי (tool_use חסר) - נסה שוב' }, 502);
    }
    const input = toolBlock.input as { improved_text?: string; insufficient_info?: boolean; notes_to_user?: string | null };

    return jsonResponse({
      improved_text: typeof input.improved_text === 'string' ? input.improved_text : '',
      insufficient_info: !!input.insufficient_info,
      notes_to_user: input.notes_to_user || null,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
