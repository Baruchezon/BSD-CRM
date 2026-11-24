// Valuation repeat alert: emails Baruch when a visitor is blocked on the 4th+
// calculator attempt. Auth is a private header token (not JWT, not the digest
// dispatch flag). From: BSD - עסקים למכירה <info@bsd-bbi.co.il>.
import { createClient } from "npm:@supabase/supabase-js@2";

function cleanEnv(v: string | undefined) {
  return (v || "").replace(/[^\x20-\x7E]/g, "").trim();
}

const SUPABASE_URL = cleanEnv(Deno.env.get("SUPABASE_URL"));
const SERVICE_ROLE_KEY = cleanEnv(Deno.env.get("SB_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const RESEND_API_KEY = cleanEnv(Deno.env.get("RESEND_API_KEY"));
const MAIL_FROM = "BSD - עסקים למכירה <info@bsd-bbi.co.il>";
const MAIL_TO = "baruch@bsd-bbi.co.il";
const MAIL_REPLY_TO = "info@bsd-bbi.co.il";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function shortKey(k: string) {
  const s = String(k || "");
  if (s.startsWith("vid:") && s.length > 12) return "vid:" + s.slice(4, 12);
  if (s.length > 16) return s.slice(0, 16) + "…";
  return s || "—";
}

function ilStamp(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(d);
  const p: Record<string, string> = {};
  parts.forEach((x) => { p[x.type] = x.value; });
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

function ils(n: unknown) {
  const x = Number(n);
  if (!isFinite(x)) return "—";
  return "₪" + Math.round(x).toLocaleString("he-IL");
}

function sectorName(code: unknown, label: unknown) {
  if (label) return String(label);
  const map: Record<string, string> = {
    food: "מסעדות, בתי קפה ומזון",
    retail: "חנויות, מינימרקטים וקמעונאות",
    services: "שירותים, קליניקות ומספרות",
    kids: "חינוך, חוגים ופנאי",
    transport: "תחבורה, הסעות ולוגיסטיקה",
    tourism: "תיירות, מלונאות ואירוח",
    import: "ייבוא, סיטונאות והפצה",
    industry: "תעשייה, ייצור ומפעלים",
    online: "טכנולוגיה, דיגיטל ומסחר מקוון",
    other: "תחום אחר"
  };
  return map[String(code || "")] || String(code || "—");
}

function historyLines(history: unknown, snapshot: Record<string, unknown> | null, createdAt: string | undefined) {
  const rows = Array.isArray(history) ? history : [];
  const lines = rows.map((r: Record<string, unknown>) => {
    const n = r.request_number != null ? String(r.request_number).padStart(3, "0") : "—";
    const att = r.visitor_attempt_no != null ? `בקשה ${r.visitor_attempt_no}` : "";
    const range = (r.value_low != null) ? `${ils(r.value_low)}–${ils(r.value_high)}` : "—";
    return `• הערכת שווי מס׳ ${n}${att ? " (" + att + ")" : ""} — ${sectorName(null, r.sector_label)}, רווח ${ils(r.profit)}, טווח ${range}, ${ilStamp(String(r.created_at || ""))} שעון ישראל`;
  });
  if (snapshot) {
    lines.push(`• ניסיון מס׳ שנחסם — ${sectorName(snapshot.sector, snapshot.sector_label)}, רווח ${ils(snapshot.profit)}${snapshot.employees != null ? ", " + snapshot.employees + " עובדים" : ""}${snapshot.turnover != null ? ", מחזור " + ils(snapshot.turnover) : ""}, ${ilStamp(createdAt)} שעון ישראל`);
  }
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "server" }, 500);

  const token = req.headers.get("x-bsd-valuation-alert-token") || "";
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: auth, error: authErr } = await supabase
    .from("valuation_repeat_alert_auth")
    .select("token")
    .eq("id", true)
    .maybeSingle();
  if (authErr || !auth?.token || token !== auth.token) return json({ error: "forbidden" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid" }, 400); }

  const isTest = !!body.is_test;
  const visitorKey = String(body.visitor_key || "—");
  const attemptNo = Number(body.attempt_no || 0);
  const attemptCount = Number(body.attempt_count || 0);
  const snapshot = (body.snapshot && typeof body.snapshot === "object") ? body.snapshot as Record<string, unknown> : null;
  const history = body.history;
  const subject = (isTest ? "[בדיקה] " : "") + "⚠ ניסיון חוזר בהערכת שווי – מעל 3 פעמים";
  const lines = historyLines(history, snapshot, body.created_at as string | undefined);
  const text =
    "שלום ברוך,\n\n" +
    (isTest ? "זה מייל בדיקה של מנגנון ההתראה (נתונים לדוגמה בלבד, לא מבקר אמיתי).\n\n" : "") +
    "גורם ניסה לבצע הערכת שווי במחשבון האתר מעל שלוש פעמים, והניסיון נחסם.\n\n" +
    "מפתח מבקר (מקוצר): " + shortKey(visitorKey) + "\n" +
    "מספר ניסיונות שהצליחו: " + (attemptCount || "—") + "\n" +
    "מספר הניסיון שנחסם: " + (attemptNo || "—") + "\n" +
    "מועד החסימה: " + ilStamp(body.created_at as string) + " שעון ישראל\n\n" +
    "הבקשות שנרשמו:\n" + (lines || "—") + "\n\n" +
    "בברכה,\nBSD - עסקים למכירה\nמשביחים עסקים, מחברים הזדמנויות, מובילים עסקאות\ninfo@bsd-bbi.co.il | www.bsd-bbi.co.il";

  const html =
    '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#2b1a20;text-align:right">' +
    "<p>שלום ברוך,</p>" +
    (isTest ? "<p><b>זה מייל בדיקה</b> של מנגנון ההתראה (נתונים לדוגמה בלבד, לא מבקר אמיתי).</p>" : "") +
    "<p>גורם ניסה לבצע הערכת שווי במחשבון האתר מעל שלוש פעמים, והניסיון נחסם.</p>" +
    "<p>מפתח מבקר (מקוצר): <b dir=\"ltr\">" + shortKey(visitorKey) + "</b><br>" +
    "מספר ניסיונות שהצליחו: <b>" + (attemptCount || "—") + "</b><br>" +
    "מספר הניסיון שנחסם: <b>" + (attemptNo || "—") + "</b><br>" +
    "מועד החסימה: <b>" + ilStamp(body.created_at as string) + " שעון ישראל</b></p>" +
    "<p><b>הבקשות שנרשמו:</b><br>" + historyLines(history, snapshot, body.created_at as string).replace(/\n/g, "<br>") + "</p>" +
    '<div style="margin-top:22px;padding-top:12px;border-top:1px solid #e3d9bf">בברכה,<br><b>BSD - עסקים למכירה</b><br>' +
    '<span style="color:#8a6d1f">משביחים עסקים, מחברים הזדמנויות, מובילים עסקאות</span><br>' +
    '<span dir="ltr"><a href="mailto:info@bsd-bbi.co.il">info@bsd-bbi.co.il</a> | <a href="https://www.bsd-bbi.co.il/">www.bsd-bbi.co.il</a></span></div></div>';

  if (!RESEND_API_KEY) {
    if (body.send_id) {
      await supabase.from("valuation_repeat_alert_sends").update({ status: "error", error: "resend_missing" }).eq("id", body.send_id);
    }
    return json({ error: "resend_missing" }, 500);
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + RESEND_API_KEY },
    body: JSON.stringify({
      from: MAIL_FROM,
      reply_to: MAIL_REPLY_TO,
      to: [MAIL_TO],
      subject,
      text,
      html
    })
  });
  const raw = await resp.text();
  let parsed: { id?: string; message?: string } = {};
  try { parsed = JSON.parse(raw); } catch { parsed = { message: raw.slice(0, 200) }; }

  if (body.send_id) {
    await supabase.from("valuation_repeat_alert_sends")
      .update({
        status: resp.ok ? "sent" : "error",
        resend_id: parsed.id || null,
        error: resp.ok ? null : (parsed.message || ("http_" + resp.status))
      })
      .eq("id", body.send_id);
  }

  if (!resp.ok) return json({ error: "resend", status: resp.status }, 502);
  return json({ ok: true, id: parsed.id || null, is_test: isTest });
});
