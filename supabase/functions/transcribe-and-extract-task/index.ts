// BSD CRM - transcribe-and-extract-task Edge Function
//
// Powers the quick-add task screen (task-quick.html). Two modes:
//   - Voice: receives an audio blob directly in the request body, transcribes
//     it (Whisper), then extracts structured task fields from the transcript.
//   - Text: receives typed free text directly, skips transcription, extracts
//     structured task fields from it.
//
// Design, per explicit spec (23.08.2026):
//   - This function NEVER writes to the tasks table. It only returns
//     extracted fields (title/description/due_date/due_time/possible
//     business-buyer-match matches). The actual INSERT happens client-side
//     using the logged-in user's own Supabase session, so RLS
//     (tasks_insert: assigned_to = auth.uid() OR admin) is the one and only
//     enforcement layer for the write itself - this function is never
//     trusted with "who owns this task".
//   - The audio blob is received directly in the request body and is never
//     written to Supabase Storage or any other persistent location - it
//     exists only in memory for the duration of this single request, then
//     is discarded when the function returns. Nothing to delete afterward
//     because nothing was ever saved.
//   - Access gate: this function IS the real enforcement point for "who may
//     use the quick-add screen" (can_quick_add_task or admin) - checked
//     fresh against the live profiles row on every call via a real JWT,
//     never trusting a client-supplied flag or a cached value.
//   - Business/buyer/match matching: candidates are looked up server-side,
//     scoped to what THIS user is authorized to see (same visibility rule
//     as the rest of the app - admin/manager see all, everyone else only
//     records they created/handle) - never a raw unfiltered list handed to
//     the client to filter in JavaScript.
//
// Requires: OPENAI_API_KEY, ANTHROPIC_API_KEY (both already set - reused
// from analyze-meeting-audio), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (auto-provided). Service role is used ONLY for the permission check and
// the scoped candidate lookup below - never for creating/modifying tasks.

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

async function transcribeAudio(audioBlob: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', audioBlob, filename);
  form.append('model', 'gpt-4o-mini-transcribe');
  form.append('language', 'he');
  form.append('response_format', 'text');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    // gpt-4o-mini-transcribe is very new - fall back to the older, proven
    // whisper-1 if the newer model rejects the request for any reason,
    // rather than failing the whole task capture.
    const form2 = new FormData();
    form2.append('file', audioBlob, filename);
    form2.append('model', 'whisper-1');
    form2.append('language', 'he');
    form2.append('response_format', 'text');
    const res2 = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form2,
    });
    if (!res2.ok) {
      const errText = await res2.text();
      throw new Error(`תמלול נכשל: ${errText.slice(0, 300)}`);
    }
    return (await res2.text()).trim();
  }
  return (await res.text()).trim();
}

function todayISOInTz(): string {
  const s = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
  const d = new Date(s);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function extractJson(raw: string): Record<string, unknown> {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  return JSON.parse(text);
}

async function extractTaskFields(rawText: string): Promise<Record<string, unknown>> {
  const today = todayISOInTz();
  const systemPrompt = `אתה עוזר למשרד תיווך עסקים (BSD Business Brokers Israel) לחלץ פרטי משימה יומיומית מטקסט חופשי בעברית (יכול להיות תמלול של הקלטה קולית, לכן ייתכנו שגיאות תמלול קלות - התייחס בסבלנות).

היום הוא ${today} (אזור זמן ישראל). אם מוזכר תאריך יחסי ("מחר", "ביום שני הבא", "בעוד שבוע"), חשב את התאריך המדויק ביחס להיום.

החזר אך ורק אובייקט JSON תקני (בלי טקסט נוסף, בלי סימוני קוד), במבנה המדויק:
{
  "title": "כותרת קצרה וברורה של המשימה (עד 8 מילים)",
  "description": "פירוט נוסף אם יש, אחרת מחרוזת ריקה",
  "due_date": "תאריך בפורמט YYYY-MM-DD אם ניתן לזהות, אחרת null",
  "due_time": "שעה בפורמט HH:MM (24 שעות) אם צוינה במפורש, אחרת null",
  "possible_names": ["שם עסק/קונה/איש קשר שהוזכר, אם יש - אחרת מערך ריק"]
}

חשוב: אל תמציא תאריך או שעה שלא נאמרו או שלא ניתן לחשב בוודאות מהטקסט - במקרה של ספק, החזר null. אל תמציא שמות שלא הוזכרו בפירוש.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: rawText }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`חילוץ פרטים נכשל: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find((b: { type: string }) => b.type === 'text');
  if (!textBlock) throw new Error('תשובת AI לא הכילה טקסט');
  return extractJson(textBlock.text);
}

// מחפש התאמות אפשריות לשם שהוזכר, מוגבל לרשומות שהמשתמש הזה מורשה לראות -
// בדיוק אותו מודל הרשאות כמו שאר המערכת (admin/manager הכל, אחרת רק
// created_by/handled_by = המשתמש עצמו).
async function findPossibleMatches(name: string, userId: string, isAdminOrManager: boolean) {
  const like = `%${name}%`;
  const [{ data: bizMatches }, { data: leadMatches }] = await Promise.all([
    supabase.from('businesses').select('id, internal_name, created_by, handled_by').ilike('internal_name', like).limit(10),
    supabase.from('leads').select('id, full_name, first_name, last_name, created_by, handled_by').or(`full_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`).limit(10),
  ]);
  // סינון הרשאות בצד השרת (בתוך ה-Edge Function, לפני שהתוצאה יוצאת מכאן) -
  // בדיוק אותו כלל בעלות כמו bsdOwnsRecord() בשאר המערכת: created_by או
  // handled_by = המשתמש עצמו, אלא אם admin/manager. הלקוח אף פעם לא מקבל
  // רשימה גולמית לא-מסוננת.
  const owns = (r: { created_by?: string; handled_by?: string }) => r.created_by === userId || r.handled_by === userId;
  const bizFiltered = isAdminOrManager ? (bizMatches || []) : (bizMatches || []).filter(owns);
  const leadFiltered = isAdminOrManager ? (leadMatches || []) : (leadMatches || []).filter(owns);
  return {
    businesses: bizFiltered.slice(0, 5).map(b => ({ id: b.id, name: b.internal_name })),
    leads: leadFiltered.slice(0, 5).map(l => ({ id: l.id, name: l.full_name || [l.first_name, l.last_name].filter(Boolean).join(' ') })),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

  try {
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: 'ANTHROPIC_API_KEY לא מוגדר ב-Secrets' }, 500);

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonResponse({ error: 'לא מחובר' }, 401);
    const userId = userData.user.id;

    // בדיקת ההרשאה האמיתית - מול הפרופיל החי בבסיס הנתונים, לא מטמון/דגל שהלקוח שלח
    const { data: profile, error: profileErr } = await supabase.from('profiles').select('role, can_quick_add_task').eq('id', userId).single();
    if (profileErr || !profile) return jsonResponse({ error: 'פרופיל משתמש לא נמצא' }, 403);
    const isAdmin = profile.role === 'admin';
    const isAdminOrManager = profile.role === 'admin' || profile.role === 'manager';
    if (!isAdmin && !profile.can_quick_add_task) {
      return jsonResponse({ error: 'אין לך הרשאה להשתמש בהוספת משימה מהירה' }, 403);
    }

    const contentType = req.headers.get('content-type') || '';
    let rawText = '';

    if (contentType.includes('multipart/form-data')) {
      // מצב הקלטה - קובץ אודיו מגיע ישירות בגוף הבקשה, אף פעם לא נשמר ב-Storage
      const form = await req.formData();
      const audioFile = form.get('audio');
      if (!(audioFile instanceof File)) return jsonResponse({ error: 'לא סופק קובץ אודיו' }, 400);
      rawText = await transcribeAudio(audioFile, audioFile.name || 'recording.webm');
    } else {
      const body = await req.json();
      rawText = typeof body.text === 'string' ? body.text.trim() : '';
    }

    if (!rawText) return jsonResponse({ error: 'לא זוהה טקסט לעיבוד' }, 400);

    const extracted = await extractTaskFields(rawText);

    // חיפוש התאמות אפשריות לשם ראשון שהוזכר, אם יש - מוגבל להרשאות המשתמש
    let matches: { businesses: unknown[]; leads: unknown[] } = { businesses: [], leads: [] };
    const possibleNames = Array.isArray(extracted.possible_names) ? extracted.possible_names as string[] : [];
    if (possibleNames.length > 0 && possibleNames[0]) {
      matches = await findPossibleMatches(possibleNames[0], userId, isAdminOrManager);
    }

    return jsonResponse({
      transcript: contentType.includes('multipart/form-data') ? rawText : undefined,
      title: extracted.title || '',
      description: extracted.description || '',
      due_date: extracted.due_date || null,
      due_time: extracted.due_time || null,
      possible_matches: matches,
    });
  } catch (err) {
    console.error('transcribe-and-extract-task error', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'שגיאה לא ידועה' }, 500);
  }
});
