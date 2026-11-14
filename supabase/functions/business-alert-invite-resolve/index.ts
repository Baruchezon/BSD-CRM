// Public prefill for an invite link. verify_jwt is false.
// Accepts the long token or the 7-character short code. Never returns an internal id.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { isShortCode } from "../_shared/short-links.mjs";
import { hashInviteToken, inviteOpen, publicPrefill } from "../_shared/business-alert-invite.mjs";
import { RATE_LIMITS, cleanText } from "../business-alert-signup/logic.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is missing");
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const ALLOWED = new Set([
  "https://bsd-bbi.co.il",
  "https://www.bsd-bbi.co.il",
  "https://lively-wood-e2c6.baruch-ezon.workers.dev",
  "https://cursor-alerts-consent-unsubscribe-afca-lively-wood-e2c6.baruch-ezon.workers.dev",
  "https://cursor-invite-link-prefill-f01e-lively-wood-e2c6.baruch-ezon.workers.dev"
]);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED.has(origin) ? origin : "https://www.bsd-bbi.co.il",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  try {
    const url = new URL(req.url);
    let token = url.searchParams.get("token") || "";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      token = String(body.token || token || "");
    }
    token = cleanText(token, 200);
    const ip = cleanText((req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0], 64);
    const since = new Date(Date.now() - RATE_LIMITS.signupPerIp.windowMs).toISOString();
    const { count } = await supabase.from("business_alert_signup_attempts").select("id", { count: "exact", head: true })
      .eq("kind", "invite_resolve").eq("ip", ip).gte("created_at", since);
    if ((count || 0) >= RATE_LIMITS.signupPerIp.limit) return json({ ok: false, error: "rate_limited" }, 429, origin);
    await supabase.from("business_alert_signup_attempts").insert({ kind: "invite_resolve", ip: ip || null, email: null });
    if (!token) return json({ ok: false, error: "invalid_invite" }, 404, origin);
    const query = supabase.from("business_alert_invites")
      .select("id, status, expires_at, opened_at, prefill, short_code");
    const { data, error } = isShortCode(token) && token.length === 7
      ? await query.eq("short_code", token).maybeSingle()
      : await query.eq("token_hash", hashInviteToken(token)).maybeSingle();
    if (error) throw error;
    const decision = inviteOpen(data, Date.now());
    if (!decision.ok) return json({ ok: false, error: decision.error }, decision.error === "expired" ? 410 : 404, origin);
    if (decision.firstOpen) {
      await supabase.from("business_alert_invites").update({ status: "opened", opened_at: new Date().toISOString() }).eq("id", data.id).is("opened_at", null);
    }
    return json({ ok: true, prefill: publicPrefill(data) }, 200, origin);
  } catch (error) {
    console.error("invite resolve failed", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "save_failed" }, 500, origin);
  }
});
