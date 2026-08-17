// BSD CRM - send-match-summary Edge Function (raw SMTP, Gmail account)
//
// Sends email via a hand-rolled minimal SMTP client over TLS directly to
// smtp.gmail.com - no third-party mail library (denomailer had unresolved
// open bugs around encoding non-ASCII/Hebrew content: raw quoted-printable
// escapes were left undecoded). This version builds the MIME message by
// hand with explicit, correct headers: base64 for the body and RFC 2047
// encoded-word (base64) for the subject - both are unambiguous, no
// heuristics, no room for a "forgot to declare the encoding" bug.
//
// Requires these Edge Function secrets:
//   GMAIL_USER            e.g. baruch.ezon@gmail.com
//   GMAIL_APP_PASSWORD    the 16-character app password (no spaces)
//
// Called from match-detail.html via:
//   supabase.functions.invoke('send-match-summary', { body: {
//     to, subject, body_text, reply_to,
//     attachment_base64?, attachment_filename?
//   }})

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanEnv(v: string | undefined): string {
  return (v || '').trim();
}

const GMAIL_USER = cleanEnv(Deno.env.get('GMAIL_USER'));
const GMAIL_APP_PASSWORD = cleanEnv(Deno.env.get('GMAIL_APP_PASSWORD'));

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

// ---------- base64 helpers (UTF-8 safe) ----------
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
// wraps a base64 string into RFC-compliant 76-char lines joined by CRLF
function wrapBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}
function encodedWordSubject(subject: string): string {
  // RFC 2047 encoded-word, base64, for non-ASCII headers like a Hebrew subject
  return `=?UTF-8?B?${utf8ToBase64(subject)}?=`;
}

// ---------- minimal raw SMTP client over implicit TLS ----------
async function readSmtpResponse(conn: Deno.TlsConn): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const buf = new Uint8Array(4096);
  while (true) {
    const n = await conn.read(buf);
    if (n === null) break;
    text += decoder.decode(buf.subarray(0, n), { stream: true });
    const lines = text.split('\r\n').filter((l) => l.length > 0);
    const last = lines[lines.length - 1] || '';
    // a final (non-continuation) SMTP reply line has a SPACE after the 3-digit code, not a dash
    if (/^\d{3} /.test(last)) break;
  }
  return text;
}
async function sendSmtpCommand(conn: Deno.TlsConn, cmd: string): Promise<string> {
  await conn.write(new TextEncoder().encode(cmd + '\r\n'));
  return await readSmtpResponse(conn);
}
function assertOk(resp: string, step: string) {
  const code = parseInt(resp.slice(0, 3), 10);
  if (!(code >= 200 && code < 400)) {
    throw new Error(`SMTP ${step} נכשל: ${resp.trim()}`);
  }
}

async function sendMailViaGmailSmtp(opts: {
  to: string; subject: string; bodyText: string; htmlBody?: string; replyTo?: string;
  attachments?: { base64: string; filename: string; contentType?: string }[];
}) {
  const conn = await Deno.connectTls({ hostname: 'smtp.gmail.com', port: 465 });
  try {
    assertOk(await readSmtpResponse(conn), 'greeting');
    assertOk(await sendSmtpCommand(conn, `EHLO bsd-crm.local`), 'EHLO');
    assertOk(await sendSmtpCommand(conn, 'AUTH LOGIN'), 'AUTH LOGIN');
    assertOk(await sendSmtpCommand(conn, btoa(GMAIL_USER)), 'AUTH USER');
    assertOk(await sendSmtpCommand(conn, btoa(GMAIL_APP_PASSWORD)), 'AUTH PASSWORD (בדוק שהעתקת נכון את סיסמת האפליקציה בת 16 התווים)');
    assertOk(await sendSmtpCommand(conn, `MAIL FROM:<${GMAIL_USER}>`), 'MAIL FROM');
    assertOk(await sendSmtpCommand(conn, `RCPT TO:<${opts.to}>`), 'RCPT TO');
    assertOk(await sendSmtpCommand(conn, 'DATA'), 'DATA');

    const boundary = `bsd-boundary-${crypto.randomUUID()}`;
    const headers = [
      `From: BSD Business Brokers Israel <${GMAIL_USER}>`,
      `To: ${opts.to}`,
      `Subject: ${encodedWordSubject(opts.subject)}`,
      `MIME-Version: 1.0`,
      opts.replyTo ? `Reply-To: ${opts.replyTo}` : null,
    ].filter(Boolean).join('\r\n');

    const attachments = (opts.attachments || []).filter(a => a && a.base64 && a.filename);
    const isHtml = !!opts.htmlBody;
    const bodyContentType = isHtml ? 'text/html' : 'text/plain';
    const bodyContent = isHtml ? opts.htmlBody! : opts.bodyText;
    const bodyPart =
      `Content-Type: ${bodyContentType}; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${wrapBase64(utf8ToBase64(bodyContent))}\r\n\r\n`;

    let mime: string;
    if (attachments.length) {
      // שם קובץ מצורף עם עברית: "filename=" רגיל (ASCII בלבד) לא תומך בעברית -
      // חלק מלקוחות המייל היו מציגים שם שבור. פותר עם RFC 2231/5987 -
      // filename*=UTF-8''<percent-encoded> לצד fallback ASCII רגיל, כך שגם
      // לקוחות ישנים שלא תומכים ב-filename* עדיין מקבלים שם קובץ תקין (ASCII).
      const asciiFallback = (name: string) => {
        const m = name.match(/\.[A-Za-z0-9]+$/);
        const ext = m ? m[0] : '';
        return /^[\x20-\x7E]+$/.test(name) ? name : `attachment${ext}`;
      };
      const attachmentParts = attachments.map(a => {
        const fallback = asciiFallback(a.filename);
        const encoded = encodeURIComponent(a.filename);
        return `--${boundary}\r\n` +
          `Content-Type: ${a.contentType || 'application/pdf'}; name="${fallback}"\r\n` +
          `Content-Disposition: attachment; filename="${fallback}"; filename*=UTF-8''${encoded}\r\n` +
          `Content-Transfer-Encoding: base64\r\n\r\n` +
          `${wrapBase64(a.base64)}\r\n\r\n`;
      }).join('');
      mime =
        `${headers}\r\n` +
        `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
        `--${boundary}\r\n` +
        bodyPart +
        attachmentParts +
        `--${boundary}--\r\n`;
    } else {
      mime =
        `${headers}\r\n` +
        `Content-Type: ${bodyContentType}; charset="UTF-8"\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        `${wrapBase64(utf8ToBase64(bodyContent))}\r\n`;
    }

    // dot-stuffing: a line consisting of a lone "." would prematurely end DATA
    const dataSafe = mime.split('\r\n').map(l => l.startsWith('.') ? '.' + l : l).join('\r\n');
    assertOk(await sendSmtpCommand(conn, dataSafe + '\r\n.'), 'DATA body');
    await sendSmtpCommand(conn, 'QUIT');
  } finally {
    try { conn.close(); } catch (_e) { /* already closed */ }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      return new Response(JSON.stringify({ error: 'GMAIL_USER / GMAIL_APP_PASSWORD לא מוגדרים ב-Secrets' }), {
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

    await sendMailViaGmailSmtp({
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
