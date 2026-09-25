import { createClient } from "npm:@supabase/supabase-js@2";

function cleanEnv(v: string | undefined) {
  return (v || "").replace(/[^\x20-\x7E]/g, "").trim();
}

const SUPABASE_URL = cleanEnv(Deno.env.get("SUPABASE_URL"));
const SERVICE_ROLE_KEY = cleanEnv(Deno.env.get("SB_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const GMAIL_CLIENT_ID = cleanEnv(Deno.env.get("GMAIL_CLIENT_ID"));
const GMAIL_CLIENT_SECRET = cleanEnv(Deno.env.get("GMAIL_CLIENT_SECRET"));
const GMAIL_REFRESH_TOKEN = cleanEnv(Deno.env.get("GMAIL_REFRESH_TOKEN"));
const GMAIL_FROM_EMAIL = cleanEnv(Deno.env.get("GMAIL_FROM_EMAIL")) || "baruch.ezon@gmail.com";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

function looksLikeEmail(s: unknown) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64Url(bytes: Uint8Array) {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function utf8Base64(value: string) {
  return base64(new TextEncoder().encode(value));
}

function encodedHeader(value: string) {
  return `=?UTF-8?B?${utf8Base64(value)}?=`;
}

function safeFilename(value: string) {
  return (value || "report.pdf").replace(/[\r\n"]/g, "").slice(0, 180) || "report.pdf";
}

async function getGmailAccessToken() {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error("חיבור Gmail של המערכת טרם הושלם");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error("אימות Gmail נכשל. יש לחדש את הרשאת החשבון");
  }
  return payload.access_token as string;
}

function buildRawMessage(opts: {
  to: string;
  subject: string;
  html: string;
  attachmentBase64?: string;
  attachmentFilename?: string;
}) {
  const boundary = `bsd_${crypto.randomUUID().replace(/-/g, "")}`;
  const lines = [
    `From: BSD Business Brokers Israel <${GMAIL_FROM_EMAIL}>`,
    `To: ${opts.to}`,
    `Reply-To: ${GMAIL_FROM_EMAIL}`,
    `Subject: ${encodedHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(opts.html),
    ""
  ];

  if (opts.attachmentBase64) {
    const filename = safeFilename(opts.attachmentFilename || "report.pdf");
    lines.push(
      `--${boundary}`,
      "Content-Type: application/pdf",
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "",
      opts.attachmentBase64.replace(/\s/g, ""),
      ""
    );
  }
  lines.push(`--${boundary}--`, "");
  return base64Url(new TextEncoder().encode(lines.join("\r\n")));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  try {
    const { to, subject, html, attachment_base64, attachment_filename } = await req.json();
    if (!looksLikeEmail(to)) return jsonResponse({ error: "כתובת המייל של הנמען חסרה או לא תקינה" }, 400);
    if (!subject || !html) return jsonResponse({ error: "נושא ותוכן ההודעה הם שדות חובה" }, 400);

    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonResponse({ error: "לא ניתן לאמת את המשתמש המחובר" }, 401);
    const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).single();
    if (!callerProfile) return jsonResponse({ error: "אין הרשאה לשליחת המייל" }, 403);

    if (attachment_base64) {
      const approxBytes = Math.floor(attachment_base64.replace(/\s/g, "").length * 0.75);
      if (approxBytes > MAX_ATTACHMENT_BYTES) return jsonResponse({ error: "קובץ ה PDF גדול מדי לשליחה במייל" }, 400);
    }

    const accessToken = await getGmailAccessToken();
    const raw = buildRawMessage({
      to: to.trim(), subject, html,
      attachmentBase64: attachment_base64,
      attachmentFilename: attachment_filename
    });
    const gmailResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw })
    });
    const gmailResult = await gmailResponse.json().catch(() => ({}));
    if (!gmailResponse.ok) {
      const detail = gmailResult?.error?.message || `Google Gmail API ${gmailResponse.status}`;
      return jsonResponse({ error: `שליחה דרך Gmail נכשלה: ${detail}` }, 502);
    }
    return jsonResponse({ ok: true, provider: "gmail", message_id: gmailResult.id });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
