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
const FROM_EMAIL_RAW = (Deno.env.get("RESEND_FROM_EMAIL") || "BSD Business Brokers <noreply@bsd-bbi.co.il>").trim();
const FROM_EMAIL = FROM_EMAIL_RAW;

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
      from: FROM_EMAIL,
      to: [to.trim()],
      subject,
      html
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
