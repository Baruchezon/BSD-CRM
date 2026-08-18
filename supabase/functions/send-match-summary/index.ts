// BSD CRM - send-match-summary Edge Function (Resend HTTPS API)
//
// 17.08.2026: replaced the previous raw-SMTP-to-Gmail approach. Root cause
// of the "click send, nothing happens / times out" saga that evening:
// Supabase Edge Functions block outbound connections on ports 25, 465 and
// 587 (documented Supabase platform limitation) - the old code connected
// directly to smtp.gmail.com:465, which explains an indefinite hang with
// zero response, on any timeout length. Switched to Resend's HTTPS API
// (https://api.resend.com/emails, port 443 - never blocked) instead of
// raw SMTP. Same external contract as before (to/subject/body_text/
// html_body/reply_to/attachment_base64+attachment_filename/attachments[])
// so match-detail.html and businesses.html needed no changes at all.
//
// Requires these Edge Function secrets:
//   RESEND_API_KEY     from resend.com (Settings -> API Keys)
//   RESEND_FROM_EMAIL   e.g. noreply@bsd-bbi.co.il - MUST be on a domain
//                        verified in Resend (Settings -> Domains) to send
//                        to arbitrary recipients. Until a domain is
//                        verified, Resend only allows sending to the
//                        account owner's own signup email address - fine
//                        for a first test, not for real buyers. Falls back
//                        to onboarding@resend.dev (Resend's own shared test
//                        address) if this secret isn't set, which has the
//                        same own-email-only restriction.
//
// Called from match-detail.html / businesses.html via:
//   supabase.functions.invoke('send-match-summary', { body: {
//     to, subject, body_text, reply_to,
//     attachment_base64?, attachment_filename?  (or attachments: [...])
//   }})

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanEnv(v: string | undefined): string {
  return (v || '').trim();
}

const RESEND_API_KEY = cleanEnv(Deno.env.get('RESEND_API_KEY'));
const RESEND_FROM_EMAIL = cleanEnv(Deno.env.get('RESEND_FROM_EMAIL')) || 'onboarding@resend.dev';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

async function sendMailViaResend(opts: {
  to: string; subject: string; bodyText: string; htmlBody?: string; replyTo?: string;
  attachments?: { base64: string; filename: string; contentType?: string }[];
}) {
  const attachments = (opts.attachments || []).filter(a => a && a.base64 && a.filename);
  const payload: Record<string, unknown> = {
    from: `BSD Business Brokers Israel <${RESEND_FROM_EMAIL}>`,
    to: [opts.to],
    subject: opts.subject,
    // עברית מוצגת נכון בשני הפורמטים בלי שום קידוד ידני - Resend שולח
    // הכל כ-UTF-8 תקין מהצד שלו; זה מה שמחליף את כל טיפול ה-RFC 2047/
    // base64 הידני שהיה נחוץ בגרסת ה-SMTP הגולמית.
    text: opts.bodyText || undefined,
    html: opts.htmlBody || undefined,
  };
  if (opts.replyTo) payload.reply_to = opts.replyTo;
  if (attachments.length) {
    // Resend מקבל attachments כ-base64 ישירות עם שם קובץ יוניקוד רגיל -
    // לא צריך את כל ה-RFC 2231 filename*=UTF-8'' הידני שהיה ב-SMTP; ה-API
    // כבר שולח multipart תקין בעצמו.
    payload.attachments = attachments.map(a => ({
      filename: a.filename,
      content: a.base64,
    }));
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const respBody = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // Resend מחזיר שגיאה ברורה (JSON עם message) - כולל המקרה השכיח ביותר:
    // domain לא מאומת, שאז ההודעה בפועל אומרת שאפשר לשלוח רק לכתובת שאיתה
    // נרשמת ל-Resend. מעבירים את זה כמו שהוא הלאה כדי שהמשתמש יראה סיבה
    // אמיתית ולא הודעה גנרית.
    const detail = (respBody && (respBody.message || respBody.error)) || `HTTP ${resp.status}`;
    throw new Error(`שליחה דרך Resend נכשלה: ${detail}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY לא מוגדר ב-Secrets של הפונקציה' }), {
        status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'לא מחובר' }), {
        status: 401, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json();
    const { to, subject, html_body, body_text, reply_to, attachment_base64, attachment_filename, attachments } = body;
    // html_body: כשסופק, נשלח כ-HTML אמיתי (קישורים לחיצים וכו') - לא רק "טקסט עם תגיות שהוסרו".
    // body_text עדיין נדרש כתוכן טקסטואלי כשאין html_body (התנהגות קיימת, לא משתנה).
    const bodyText = body_text || '';
    const htmlBody = html_body || '';

    if (!to || !subject || (!bodyText && !htmlBody)) {
      return new Response(JSON.stringify({ error: 'חסרים שדות חובה: to, subject, ותוכן (body_text או html_body)' }), {
        status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    // תאימות לאחור: קריאות ישנות (match-detail.html) עדיין שולחות attachment_base64/attachment_filename יחיד.
    // קריאות חדשות (שליחת חומרי תיק מכירה) שולחות attachments: [{base64, filename, contentType}].
    const resolvedAttachments = Array.isArray(attachments) && attachments.length
      ? attachments
      : (attachment_base64 && attachment_filename ? [{ base64: attachment_base64, filename: attachment_filename }] : []);

    await sendMailViaResend({
      to, subject, bodyText, htmlBody: htmlBody || undefined, replyTo: reply_to,
      attachments: resolvedAttachments,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }
});
