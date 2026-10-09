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
// 09.10.2026 (Baruch): every email from BSD systems goes out as «צוות BSD <info@bsd-bbi.co.il>»
// with replies to info@bsd-bbi.co.il. Fixed in code on purpose: the shared RESEND_FROM_EMAIL
// secret is no longer read (it was unset/onboarding@resend.dev, which Resend only lets send
// to the account owner).
const MAIL_FROM = 'צוות BSD <info@bsd-bbi.co.il>';
const MAIL_REPLY_TO = 'info@bsd-bbi.co.il';
// 09.10.2026 (Baruch): every BSD email ends with the approved signature, no logo.
// Appended here once, at the very end (after any summary/links the CRM adds); skipped when the
// body already carries it (e.g. a template that already ends with it).
const SIGNATURE_MARK = 'info@bsd-bbi.co.il | www.bsd-bbi.co.il';
const SIGNATURE_TEXT = 'בברכה,\nצוות BSD\nBSD Business Brokers Israel · מחברים עסקים להזדמנויות\n' + SIGNATURE_MARK;
const SIGNATURE_HTML = '<div dir="rtl" style="margin-top:22px;padding-top:12px;border-top:1px solid #e3d9bf;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2d3d;text-align:right">'
  + 'בברכה,<br><b>צוות BSD</b><br><span style="color:#8a6d1f">BSD Business Brokers Israel · מחברים עסקים להזדמנויות</span><br>'
  + '<span dir="ltr"><a href="mailto:info@bsd-bbi.co.il" style="color:#0f5ea8;text-decoration:none">info@bsd-bbi.co.il</a> | <a href="https://www.bsd-bbi.co.il/" style="color:#0f5ea8;text-decoration:none">www.bsd-bbi.co.il</a></span></div>';
const escHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function signedText(bodyText: string): string {
  if (!bodyText) return '';
  return bodyText.includes(SIGNATURE_MARK) ? bodyText : bodyText.replace(/\s+$/, '') + '\n\n' + SIGNATURE_TEXT;
}
// Text-only sends also get a Hebrew right-to-left HTML part (same words, links clickable).
export function signedHtml(htmlBody: string, bodyText: string): string {
  if (htmlBody) {
    if (htmlBody.includes(SIGNATURE_MARK)) return htmlBody;
    return /<\/body>/i.test(htmlBody) ? htmlBody.replace(/<\/body>/i, SIGNATURE_HTML + '</body>') : htmlBody + SIGNATURE_HTML;
  }
  if (!bodyText) return '';
  const has = bodyText.includes(SIGNATURE_MARK);
  const linked = escHtml(bodyText.replace(/\s+$/, '')).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" dir="ltr">${u}</a>`);
  return '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#1f2d3d;text-align:right;white-space:pre-wrap">'
    + linked + '</div>' + (has ? '' : SIGNATURE_HTML);
}

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
    from: MAIL_FROM,
    to: [opts.to],
    subject: opts.subject,
    // עברית מוצגת נכון בשני הפורמטים בלי שום קידוד ידני - Resend שולח
    // הכל כ-UTF-8 תקין מהצד שלו; זה מה שמחליף את כל טיפול ה-RFC 2047/
    // base64 הידני שהיה נחוץ בגרסת ה-SMTP הגולמית.
    text: signedText(opts.bodyText) || undefined,
    html: signedHtml(opts.htmlBody || '', opts.bodyText) || undefined,
  };
  // Replies always go to info@ (09.10.2026); the caller's reply_to is no longer used.
  payload.reply_to = MAIL_REPLY_TO;
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
    // 30.09.2026: עד עכשיו כשל של Resend לא נרשם בכלל בלוג הפונקציה (רק 500 ריק
    // בלוג ה-gateway) - רושמים את השגיאה האמיתית של הספק (בלי תוכן המייל).
    const toDomain = String(opts.to || '').split('@')[1] || '?';
    const fromDomain = 'bsd-bbi.co.il';
    console.error('resend_send_failed', JSON.stringify({
      status: resp.status, name: respBody?.name, message: detail, from_domain: fromDomain, to_domain: toDomain,
    }));
    // המקרה הידוע: חשבון Resend במצב בדיקה (דומיין השולח לא מאומת) - Resend
    // מאפשר אז לשלוח רק לכתובת בעל החשבון. מוסיפים הסבר בעברית למשתמש.
    const unverifiedDomain = /verify a domain|testing emails|domain is not verified/i.test(String(detail));
    const hint = unverifiedDomain
      ? ' | הסבר: דומיין השולח לא מאומת ב-Resend, ולכן אפשר לשלוח רק לכתובת בעל חשבון ה-Resend. יש לאמת את bsd-bbi.co.il ב-Resend (Domains) ולהגדיר את ה-Secret RESEND_FROM_EMAIL לכתובת בדומיין הזה.'
      : '';
    throw new Error(`שליחה דרך Resend נכשלה: ${detail}${hint}`);
  }
  console.log('resend_send_ok', JSON.stringify({ id: respBody?.id, to_domain: String(opts.to || '').split('@')[1] || '?' }));
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
    console.error('send-match-summary failed:', e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }
});
