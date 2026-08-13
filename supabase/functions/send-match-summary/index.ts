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
  to: string; subject: string; bodyText: string; replyTo?: string;
  attachmentBase64?: string; attachmentFilename?: string;
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

    let mime: string;
    if (opts.attachmentBase64 && opts.attachmentFilename) {
      mime =
        `${headers}\r\n` +
        `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain; charset="UTF-8"\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        `${wrapBase64(utf8ToBase64(opts.bodyText))}\r\n\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: application/pdf; name="${opts.attachmentFilename}"\r\n` +
        `Content-Disposition: attachment; filename="${opts.attachmentFilename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        `${wrapBase64(opts.attachmentBase64)}\r\n\r\n` +
        `--${boundary}--\r\n`;
    } else {
      mime =
        `${headers}\r\n` +
        `Content-Type: text/plain; charset="UTF-8"\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        `${wrapBase64(utf8ToBase64(opts.bodyText))}\r\n`;
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
    const { to, subject, html_body, body_text, reply_to, attachment_base64, attachment_filename } = body;
    const bodyText = body_text || String(html_body || '').replace(/<[^>]+>/g, '');

    if (!to || !subject || !bodyText) {
      return new Response(JSON.stringify({ error: 'חסרים שדות חובה: to, subject, ותוכן (body_text)' }), {
        status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    await sendMailViaGmailSmtp({
      to, subject, bodyText, replyTo: reply_to,
      attachmentBase64: attachment_base64, attachmentFilename: attachment_filename,
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
