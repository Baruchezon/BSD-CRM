// vip-draft-send: sends exactly one approved VIP draft (plan item ו).
// Auth = single-use approval token issued by vip_draft_approve (only its sha256 is stored).
// Gates: vip_draft_send_control.enabled, draft status 'approved', html sha256, business_alert_gate_send,
// no business resent. is_test subscribers go to delivered@resend.dev only. Independent of dispatch_auth/cron.
import { createClient } from "npm:@supabase/supabase-js@2";
const FROM = '"BSD - עסקים למכירה" <info@bsd-bbi.co.il>';
const REPLY_TO = "info@bsd-bbi.co.il";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
async function sha256(t: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const draftId = String(body.draft_id || ""), token = String(body.token || "");
  if (!/^[0-9a-f-]{36}$/.test(draftId) || token.length < 32) return json({ ok: false, error: "bad_request" }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: c, error } = await db.rpc("vip_draft_claim", { p_draft_id: draftId, p_token: token });
  if (error) return json({ ok: false, error: "claim_failed", detail: error.message }, 500);
  if (!c?.ok) return json(c, 409);
  if ((await sha256(c.html)) !== c.html_sha256) {
    await db.rpc("vip_draft_finish", { p_draft_id: draftId, p_ok: false, p_resend_id: null, p_error: "sha_mismatch_runtime" });
    return json({ ok: false, error: "sha_mismatch" }, 409);
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    await db.rpc("vip_draft_finish", { p_draft_id: draftId, p_ok: false, p_resend_id: null, p_error: "missing_key" });
    return json({ ok: false, error: "missing_email_configuration" }, 500);
  }
  const payload: any = { from: FROM, reply_to: REPLY_TO, to: [c.to], subject: c.subject, html: c.html, text: c.text || undefined };
  if (c.unsubscribe_url) payload.headers = { "List-Unsubscribe": `<${c.unsubscribe_url}>, <mailto:${REPLY_TO}?subject=unsubscribe>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  if (c.logo_b64) payload.attachments = [{ filename: "logo.png", content: c.logo_b64, content_id: "logo.png", content_type: "image/png" }];
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "Idempotency-Key": `vip-draft-${draftId}` },
    body: JSON.stringify(payload),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out?.id) {
    await db.rpc("vip_draft_finish", { p_draft_id: draftId, p_ok: false, p_resend_id: null, p_error: `resend_${r.status}:${JSON.stringify(out).slice(0, 300)}` });
    return json({ ok: false, error: "send_failed", status: r.status }, 502);
  }
  const { data: f } = await db.rpc("vip_draft_finish", { p_draft_id: draftId, p_ok: true, p_resend_id: out.id, p_error: null });
  return json({ ok: true, resend_id: out.id, to_test_sink: c.is_test === true, logged: f });
});
