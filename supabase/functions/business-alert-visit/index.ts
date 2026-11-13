// Records a listing path for a signed-up visitor. Deploy with verify_jwt = false.
// POST { token, page_path, via? }. Unknown tokens still return { ok: true }
// and store nothing, so the token cannot be used to look a person up.
// The website proposal in the PR describes the cookie and the email-link token.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { normalizeListingPath } from "../_shared/business-alert-rules.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is missing");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const ALLOWED = new Set([
  "https://www.bsd-bbi.co.il",
  "https://bsd-bbi.co.il",
  "https://lively-wood-e2c6.baruch-ezon.workers.dev"
]);

function cors(origin: string | null) {
  const allow = origin && ALLOWED.has(origin) ? origin : "https://www.bsd-bbi.co.il";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  if (origin && !ALLOWED.has(origin)) return json({ ok: false, error: "origin_not_allowed" }, 403, origin);

  try {
    const body = await req.json();
    const path = normalizeListingPath(body?.page_path || body?.path || "");
    if (!path) return json({ ok: false, error: "invalid_path" }, 400, origin);
    const via = body?.via === "cookie" ? "cookie" : "email_link";
    const token = String(body?.token || "").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return json({ ok: true }, 200, origin);

    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64);
    if (ip) {
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count } = await supabase.from("business_alert_signup_attempts")
        .select("id", { count: "exact", head: true })
        .eq("kind", "visit")
        .eq("ip", ip)
        .gte("created_at", since);
      if ((count || 0) >= 60) return json({ ok: false, error: "rate_limited" }, 429, origin);
      await supabase.from("business_alert_signup_attempts").insert({ kind: "visit", email: null, ip });
    }

    await supabase.rpc("business_alert_record_visit", { p_token: token, p_path: path, p_via: via });
    return json({ ok: true }, 200, origin);
  } catch (error) {
    console.error("business-alert-visit failed", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "save_failed" }, 500, origin);
  }
});
