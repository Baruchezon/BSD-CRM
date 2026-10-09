import { createClient } from "npm:@supabase/supabase-js@2";

function cleanEnv(v) {
  // Strip anything outside printable ASCII — guards against stray
  // non-Latin1 characters ending up in a secret value (e.g. from a
  // multi-secret paste), which breaks fetch()'s header construction
  // with "not a valid ByteString".
  return (v || "").replace(/[^\x20-\x7E]/g, "").trim();
}

const SUPABASE_URL = cleanEnv(Deno.env.get("SUPABASE_URL"));
const SERVICE_ROLE_KEY = cleanEnv(Deno.env.get("SB_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const RESEND_API_KEY = cleanEnv(Deno.env.get("RESEND_API_KEY"));
// 09.10.2026 (Baruch): every email from BSD systems goes out as «צוות BSD <info@bsd-bbi.co.il>»
// with replies to info@bsd-bbi.co.il. Fixed in code on purpose: the shared RESEND_FROM_EMAIL
// secret is no longer read (it was unset/onboarding@resend.dev, which Resend only lets send
// to the account owner).
const MAIL_FROM = "צוות BSD <info@bsd-bbi.co.il>";
const MAIL_REPLY_TO = "info@bsd-bbi.co.il";
// 09.10.2026 (Baruch): every BSD email ends with the approved signature, no logo.
const SIGNATURE_MARK = 'info@bsd-bbi.co.il | www.bsd-bbi.co.il';
const SIGNATURE_HTML = '<div dir="rtl" style="margin-top:22px;padding-top:12px;border-top:1px solid #e3d9bf;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2d3d;text-align:right">'
  + 'בברכה,<br><b>צוות BSD</b><br><span style="color:#8a6d1f">BSD Business Brokers Israel · מחברים עסקים להזדמנויות</span><br>'
  + '<span dir="ltr"><a href="mailto:info@bsd-bbi.co.il" style="color:#0f5ea8;text-decoration:none">info@bsd-bbi.co.il</a> | <a href="https://www.bsd-bbi.co.il/" style="color:#0f5ea8;text-decoration:none">www.bsd-bbi.co.il</a></span></div>';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

// simple RFC5322-ish email sanity check — not exhaustive, just catches
// obvious typos/empties before we burn a Resend call.
function looksLikeEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // ~15MB base64-decoded, Resend's own cap is ~40MB total request

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  try {
    const { to, subject, html, attachment_base64, attachment_filename } = await req.json();

    if (!looksLikeEmail(to)) {
      return jsonResponse({ error: "כתובת המייל של הנמען חסרה או לא תקינה" }, 400);
    }
    if (!subject || !html) {
      return jsonResponse({ error: "subject and html are required" }, 400);
    }

    // Server-side enforcement: verify the caller is a real, logged-in
    // BSD-CRM user before we let them send mail through our Resend account.
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "could not verify caller identity" }, 401);
    }
    const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).single();
    if (!callerProfile) {
      return jsonResponse({ error: "you do not have permission to send this email" }, 403);
    }

    const payload = {
      from: MAIL_FROM,
      reply_to: MAIL_REPLY_TO,
      to: [to.trim()],
      subject,
      // The CRM's default text already ends with the signature; anything else gets it appended once.
      html: String(html).includes(SIGNATURE_MARK) ? html : String(html) + SIGNATURE_HTML
    };

    if (attachment_base64) {
      const approxBytes = Math.floor(attachment_base64.length * 0.75);
      if (approxBytes > MAX_ATTACHMENT_BYTES) {
        return jsonResponse({ error: "קובץ ה-PDF גדול מדי לשליחה במייל" }, 400);
      }
      payload.attachments = [{
        filename: attachment_filename || "report.pdf",
        content: attachment_base64
      }];
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      return jsonResponse({ error: "resend failed: " + errText }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: e.message || String(e) }, 500);
  }
});
