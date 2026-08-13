// BSD CRM - analyze-meeting-audio Edge Function
//
// Pipeline: downloads a temp audio recording from Supabase Storage,
// transcribes it with OpenAI Whisper, sends the transcript to Claude for
// structured business-meeting analysis, and (only if both steps succeed)
// deletes the temp audio file. If transcription fails, the audio file is
// left in place so a retry is possible (per the spec).
//
// Requires these Edge Function secrets:
//   OPENAI_API_KEY
//   ANTHROPIC_API_KEY
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-provided by Supabase)
//
// Called from match-detail.html via:
//   supabase.functions.invoke('analyze-meeting-audio', { body: {
//     storage_path,           // path inside the "temp-audio" bucket
//     meeting_type,           // 'שיחת טלפון' | 'פגישה' | ...
//     business_name, buyer_name  // context only, never sent anywhere external beyond OpenAI/Anthropic
//   }})
//   -> { transcript, analysis: { summary, decisions, open_questions,
//        requested_documents, next_action, suggested_status,
//        follow_up_meeting_date, drop_reason_category, tasks: [...] } }

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanEnv(v: string | undefined): string {
  return (v || '').trim();
}

const OPENAI_API_KEY = cleanEnv(Deno.env.get('OPENAI_API_KEY'));
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

// 19 הסטטוסים הרשמיים + קטגוריות סיבת ירידה - כדי שה-AI יבחר רק מתוכם
const MATCH_STATUSES = ['מידע ראשוני','ממתין לתגובת קונה','מתעניין','ממתין להסכם או NDA','חומר מורחב נשלח',
  'בבדיקת הקונה','ממתין למידע מהעסק','ממתין לקונה','שיחה עם בעל העסק','פגישה','משא ומתן',
  'הצעה התקבלה','כתב כוונות','בדיקת נאותות','עורכי דין','לקראת סגירה','נסגר בהצלחה','בהשהיה','לא רלוונטי'];
const DROP_REASON_CATEGORIES = ['מחיר','תחום','מיקום','רווחיות','מימון','גודל העסק','סיכון',
  'לא מתאים לקונה','לא מתאים לבעל העסק','בחר עסק אחר','הקונה עצר חיפוש','אחר'];

// ---------- שלב 1: תמלול (OpenAI Whisper) ----------
async function transcribeAudio(audioBlob: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', audioBlob, filename);
  form.append('model', 'whisper-1');
  form.append('language', 'he');
  form.append('response_format', 'text');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`תמלול נכשל (Whisper): ${errText.slice(0, 300)}`);
  }
  return (await res.text()).trim();
}

// ---------- שלב 2: ניתוח מובנה (Claude) ----------
function extractJson(raw: string): unknown {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  return JSON.parse(text);
}

async function analyzeTranscript(transcript: string, ctx: { businessName?: string; buyerName?: string; meetingType?: string }): Promise<Record<string, unknown>> {
  const systemPrompt = `אתה עוזר למשרד תיווך עסקים (BSD Business Brokers Israel) לנתח תמלול של שיחה/פגישה בין סוכן, קונה ובעל עסק, ולהוציא ממנו רק מידע עסקי רלוונטי - לא שיחת חולין.

החזר אך ורק אובייקט JSON תקני (בלי טקסט נוסף לפניו או אחריו, בלי סימוני קוד), במבנה המדויק הבא:
{
  "summary": "עיקרי הדברים - 2-4 משפטים",
  "decisions": "החלטות שהתקבלו, או מחרוזת ריקה אם אין",
  "open_questions": "שאלות פתוחות, או מחרוזת ריקה",
  "requested_documents": "מסמכים שהתבקשו (למשל דוחות כספיים), או מחרוזת ריקה",
  "next_action": "פעולה הבאה קונקרטית אחת, או מחרוזת ריקה",
  "suggested_status": "אחד מהערכים המדויקים הבאים בלבד, או null: ${MATCH_STATUSES.join(' | ')}",
  "follow_up_meeting_date": "תאריך בפורמט YYYY-MM-DD אם נקבע מועד עתידי מפורש, אחרת null",
  "drop_reason_category": "אחד מהערכים המדויקים הבאים בלבד אם הקונה ירד/סירב, אחרת null: ${DROP_REASON_CATEGORIES.join(' | ')}",
  "tasks": [ { "title": "כותרת משימה קצרה וברורה", "due_hint": "רמז לתאריך יעד אם נאמר, למשל 'שבוע הבא' או תאריך מדויק, אחרת null" } ]
}

דוגמאות: "תעביר לי את דוחות 2025" -> משימה "להעביר דוחות 2025". "דבר איתי בשבוע הבא" -> next_action "לחזור לקונה בשבוע הבא". "לא מתאים לי בגלל המחיר" -> suggested_status "לא רלוונטי", drop_reason_category "מחיר".

אם אין תוכן עסקי ממשי בתמלול (למשל שיחת חולין בלבד), החזר את כל השדות ריקים/null ו-tasks כמערך ריק.`;

  const userPrompt = `הקשר: ${ctx.meetingType || 'פגישה'} בין הסוכן, הקונה "${ctx.buyerName || ''}" ובעל העסק "${ctx.businessName || ''}".

תמלול השיחה:
"""
${transcript}
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
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ניתוח AI נכשל (Claude): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find((b: { type: string }) => b.type === 'text');
  if (!textBlock) throw new Error('תשובת Claude לא הכילה טקסט');
  try {
    return extractJson(textBlock.text) as Record<string, unknown>;
  } catch (_e) {
    throw new Error('תשובת Claude לא הייתה JSON תקני: ' + textBlock.text.slice(0, 200));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    if (!OPENAI_API_KEY || !ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'OPENAI_API_KEY / ANTHROPIC_API_KEY לא מוגדרים ב-Secrets' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return jsonResponse({ error: 'לא מחובר' }, 401);
    }

    const body = await req.json();
    const { storage_path, meeting_type, business_name, buyer_name } = body;
    if (!storage_path) return jsonResponse({ error: 'חסר storage_path' }, 400);

    // הורדת האודיו הזמני מ-Storage
    const { data: fileData, error: dlErr } = await supabase.storage.from('temp-audio').download(storage_path);
    if (dlErr || !fileData) {
      return jsonResponse({ error: 'לא ניתן להוריד את קובץ האודיו: ' + (dlErr?.message || '') }, 404);
    }

    let transcript: string;
    try {
      transcript = await transcribeAudio(fileData, storage_path.split('/').pop() || 'audio.webm');
    } catch (e) {
      // תמלול נכשל - האודיו נשאר ב-Storage לניסיון חוזר, כפי שהוגדר באפיון
      return jsonResponse({ error: e instanceof Error ? e.message : String(e), retryable: true }, 502);
    }

    if (!transcript) {
      return jsonResponse({ error: 'התמלול חזר ריק - ייתכן שההקלטה שקטה מדי', retryable: true }, 502);
    }

    let analysis: Record<string, unknown>;
    try {
      analysis = await analyzeTranscript(transcript, { businessName: business_name, buyerName: buyer_name, meetingType: meeting_type });
    } catch (e) {
      // הניתוח נכשל - התמלול כן הצליח, אבל בכל זאת משאירים את האודיו
      // כדי לא לאבד מידע; המשתמש יכול לנסות שוב.
      return jsonResponse({ error: e instanceof Error ? e.message : String(e), transcript, retryable: true }, 502);
    }

    // הצלחה מלאה (תמלול + ניתוח) - מוחקים את קובץ האודיו הזמני כעת
    await supabase.storage.from('temp-audio').remove([storage_path]);

    return jsonResponse({ transcript, analysis });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
