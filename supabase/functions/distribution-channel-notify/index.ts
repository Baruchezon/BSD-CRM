// Notifies Adam or Roman when a distribution checkbox changes.
// verify_jwt is false. The caller is the database trigger, authenticated
// by the x-distribution-secret header. This function does not email anyone.
// If DISTRIBUTION_NOTIFY_WEBHOOK_URL is unset, the payload is only logged.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const secret = Deno.env.get("DISTRIBUTION_NOTIFY_SECRET") || "";
const webhook = Deno.env.get("DISTRIBUTION_NOTIFY_WEBHOOK_URL") || "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const got = req.headers.get("x-distribution-secret") || "";
  if (!secret || got !== secret) return json({ ok: false, error: "unauthorized" }, 401);

  const payload = await req.json().catch(() => null);
  if (!payload || !payload.channel || !payload.event) return json({ ok: false, error: "payload" }, 400);
  const logId = payload.log_id || null;
  const supabase = supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    : null;

  async function mark(status: string, error: string | null, attempts: number) {
    if (!supabase || !logId) return;
    await supabase.from("business_distribution_notify_log").update({
      status,
      last_error: error,
      attempts,
      updated_at: new Date().toISOString()
    }).eq("id", logId);
  }

  if (!webhook) {
    console.log("distribution notify", payload);
    await mark("logged", null, 1);
    return json({ ok: true, logged: true });
  }

  let lastError = "webhook failed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        await mark("sent", null, attempt);
        return json({ ok: true, sent: true, attempts: attempt });
      }
      lastError = `http ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  await mark("failed", lastError, 3);
  return json({ ok: false, error: "webhook_failed" }, 200);
});
