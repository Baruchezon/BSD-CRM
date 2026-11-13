// Public unsubscribe page. Deploy with verify_jwt = false.
// GET or POST /functions/v1/business-alert-unsubscribe?token=...&channel=email|whatsapp|all
// The token is the subscriber's 32-byte url-safe unsubscribe_token. A missing
// or unknown token is 404. Repeating a valid token is a success.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { channelLabel, normalizeChannel, unsubscribePage } from "../_shared/business-alert-rules.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is missing");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const ALLOWED = new Set([
  "https://www.bsd-bbi.co.il",
  "https://bsd-bbi.co.il",
  "https://lively-wood-e2c6.baruch-ezon.workers.dev",
  "https://cursor-alerts-consent-unsubscribe-afca-lively-wood-e2c6.baruch-ezon.workers.dev"
]);
const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 30;

function cors(origin: string | null) {
  const allow = origin && ALLOWED.has(origin) ? origin : "https://www.bsd-bbi.co.il";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin"
  };
}

function clientIp(req: Request) {
  const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim().slice(0, 64);
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function html(body: string, status: number, origin: string | null) {
  return new Response(body, {
    status,
    headers: { ...cors(origin), "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function limited(ip: string) {
  if (!ip) return false;
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from("business_alert_signup_attempts")
    .select("id", { count: "exact", head: true })
    .eq("kind", "unsubscribe")
    .eq("ip", ip)
    .gte("created_at", since);
  if (error) throw error;
  return (count || 0) >= LIMIT;
}

async function note(ip: string) {
  const { error } = await supabase.from("business_alert_signup_attempts").insert({
    kind: "unsubscribe",
    email: null,
    ip: ip || null
  });
  if (error) console.error("unsubscribe attempt log failed", error.message);
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  }

  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").trim();
  const channel = normalizeChannel(url.searchParams.get("channel"));
  const wantsHtml = req.method === "GET";

  if (!channel) {
    const error = { ok: false, error: "invalid_channel" };
    return wantsHtml
      ? html(unsubscribePage({ ok: false, channel: "all" }), 400, origin)
      : json(error, 400, origin);
  }

  try {
    const ip = clientIp(req);
    if (await limited(ip)) {
      return wantsHtml
        ? html(unsubscribePage({ ok: false, channel }), 429, origin)
        : json({ ok: false, error: "rate_limited" }, 429, origin);
    }
    await note(ip);

    if (token.length < 43 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      return wantsHtml
        ? html(unsubscribePage({ ok: false, channel }), 404, origin)
        : json({ ok: false, error: "invalid_token" }, 404, origin);
    }

    const { data, error } = await supabase.rpc("business_alert_unsubscribe_by_token", {
      p_token: token,
      p_channel: channel
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.found) {
      return wantsHtml
        ? html(unsubscribePage({ ok: false, channel }), 404, origin)
        : json({ ok: false, error: "invalid_token" }, 404, origin);
    }

    const status = String(row.status || "unsubscribed_all");
    const shown = status === "unsubscribed_email" ? "email" : status === "unsubscribed_whatsapp" ? "whatsapp" : "all";
    let addressForm = null;
    const person = await supabase.from("business_alert_subscribers").select("address_form").eq("unsubscribe_token", token).maybeSingle();
    if (!person.error) addressForm = person.data?.address_form || null;
    if (wantsHtml) return html(unsubscribePage({ ok: true, channel: shown, addressForm }), 200, origin);
    return json({ ok: true, status }, 200, origin);
  } catch (error) {
    console.error("business-alert-unsubscribe failed", error instanceof Error ? error.message : String(error));
    return wantsHtml
      ? html(unsubscribePage({ ok: false, channel: channel || "all" }), 500, origin)
      : json({ ok: false, error: "save_failed" }, 500, origin);
  }
});

export { channelLabel };
