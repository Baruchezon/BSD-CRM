// BSD CRM - send-match-summary Edge Function (Gmail SMTP version)
//
// Sends a meeting/call summary email through the user's own Gmail account
// via SMTP - no domain verification / DNS required at all (unlike Resend,
// which requires the "from" domain to be verified). Uses a Gmail "App
// Password" (16-character code generated at myaccount.google.com/apppasswords,
// requires 2-Step Verification to be turned on first).
//
// Requires these Edge Function secrets:
//   GMAIL_USER            e.g. baruch.ezon@gmail.com
//   GMAIL_APP_PASSWORD    the 16-character app password (no spaces)
//
// Called from match-detail.html via:
//   supabase.functions.invoke('send-match-summary', { body: {
//     to, subject, html_body, reply_to,
//     attachment_base64?, attachment_filename?
//   }})

import { createClient } from 'npm:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

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

    if (!to || !subject || (!html_body && !body_text)) {
      return new Response(JSON.stringify({ error: 'חסרים שדות חובה: to, subject, ותוכן (body_text)' }), {
        status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
      },
    });

    // הערה: denomailer עם html מייצר לפעמים גוף עם קידוד quoted-printable
    // שגוי כשיש תווים לא-לטיניים (עברית) - הודעת מייל יוצאת "מקולקלת"
    // (=d7=a9=d7=99... נשאר גולמי, לא מפוענח). כדי למנוע את זה בוודאות,
    // שולחים כטקסט פשוט (content) בלבד ולא כ-HTML.
    const sendConfig: Record<string, unknown> = {
      from: `BSD Business Brokers Israel <${GMAIL_USER}>`,
      to,
      subject,
      content: body_text || String(html_body).replace(/<[^>]+>/g, ''),
    };
    if (reply_to) sendConfig.replyTo = reply_to;
    if (attachment_base64 && attachment_filename) {
      sendConfig.attachments = [{
        filename: attachment_filename,
        content: attachment_base64,
        encoding: 'base64',
      }];
    }

    await client.send(sendConfig);
    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }
});
