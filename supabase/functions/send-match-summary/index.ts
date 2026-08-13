// BSD CRM - send-match-summary Edge Function
//
// Sends a meeting/call summary email via Resend, reusing the same
// RESEND_API_KEY / RESEND_FROM_EMAIL secrets already configured for
// send-anonymous-presentations. The "From" address stays the fixed
// verified domain address (Resend requires a verified sending domain -
// you cannot send "from" an arbitrary user's personal inbox), but
// reply_to is set to the sending agent's own email, so replies land
// directly in their inbox - "כל משתמש שולח דרך האימייל שלו" in effect.
//
// Requires these Edge Function secrets (already set for send-anonymous-presentations):
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL   (optional - falls back to "BSD Business Brokers Israel <noreply@bsd-bbi.co.il>")
//
// Called from match-detail.html via:
//   supabase.functions.invoke('send-match-summary', { body: {
//     to, subject, html_body, reply_to,
//     attachment_base64?, attachment_filename?
//   }})

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanEnv(v: string | undefined): string {
  return (v || '').trim();
}

const RESEND_API_KEY = cleanEnv(Deno.env.get('RESEND_API_KEY'));
const FROM_EMAIL_RAW = (Deno.env.get('RESEND_FROM_EMAIL') || 'BSD Business Brokers Israel <noreply@bsd-bbi.co.il>').trim();
const FROM_EMAIL = FROM_EMAIL_RAW;

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
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY לא מוגדר ב-Secrets' }), {
        status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    // מוודאים שהקורא מחובר (auth header כבר מגיע אוטומטית מ-supabaseClient.functions.invoke)
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'לא מחובר' }), {
        status: 401, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json();
    const { to, subject, html_body, reply_to, attachment_base64, attachment_filename } = body;

    if (!to || !subject || !html_body) {
      return new Response(JSON.stringify({ error: 'חסרים שדות חובה: to, subject, html_body' }), {
        status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    const payload: Record<string, unknown> = {
      from: FROM_EMAIL,
      to: [to],
      subject,
      html: html_body,
    };
    if (reply_to) payload.reply_to = reply_to;
    if (attachment_base64 && attachment_filename) {
      payload.attachments = [{ filename: attachment_filename, content: attachment_base64 }];
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const resendJson = await resendRes.json();
    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: resendJson?.message || 'שגיאה משליחת Resend', details: resendJson }), {
        status: 502, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: true, id: resendJson?.id }), {
      status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }
});
