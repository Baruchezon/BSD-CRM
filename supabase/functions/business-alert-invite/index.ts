// Staff invite from a lead or buyer card. verify_jwt stays true.
// WhatsApp is not sent here: the caller opens the returned wa.me link.
// Email is sent from "BSD - עסקים למכירה" after the invite row is reserved.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { SUBSCRIBER_FROM, escapeHtml, signOffHtml, signOffText } from "../_shared/business-alert-mail.mjs";
import { newShortCode } from "../_shared/short-links.mjs";
import {
  INVITE_TTL_MS,
  emailBody,
  fillName,
  hashInviteToken,
  inviteGuard,
  inviteUrl,
  messageWithLink,
  newInviteToken,
  phone9,
  prefillFromCard,
  storedTemplate,
  waNumber
} from "../_shared/business-alert-invite.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is missing");
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const LOGO = "https://www.bsd-bbi.co.il/assets/bsd-asset-01-logo.png";
const ALLOWED = new Set(["https://baruchezon.github.io", "http://localhost:4173", "http://127.0.0.1:4173"]);

function cors(origin: string | null) {
  const allow = origin && ALLOWED.has(origin) ? origin : "https://baruchezon.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey",
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

async function requireStaff(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { error: "not_authenticated" };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { error: "not_authenticated" };
  const { data: profile } = await supabase.from("profiles").select("id, full_name, role, status").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.status !== "active" || !["admin", "manager"].includes(profile.role)) return { error: "forbidden" };
  return { user: data.user, profile };
}

function chip(invite: Record<string, unknown>) {
  return {
    id: invite.id,
    channel: invite.channel,
    status: invite.status,
    sent_at: invite.sent_at,
    opened_at: invite.opened_at,
    joined_at: invite.joined_at,
    expires_at: invite.expires_at
  };
}

async function inviteSettings() {
  const { data, error } = await supabase.from("business_alert_match_settings")
    .select("short_links_live, invite_whatsapp_template, invite_email_template")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  return {
    live: data?.short_links_live === true,
    whatsapp: storedTemplate(data?.invite_whatsapp_template),
    email: storedTemplate(data?.invite_email_template)
  };
}

async function loadCard(cardType: string, cardId: string) {
  const { data, error } = await supabase.from("leads")
    .select("id, type, first_name, last_name, full_name, phone, email, requested_categories, requested_field, requested_area, budget")
    .eq("id", cardId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (cardType === "buyer" && data.type !== "buyer") return null;
  if (cardType === "lead" && data.type === "buyer") return null;
  return data;
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  const auth = await requireStaff(req);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.error === "forbidden" ? 403 : 401, origin);
  try {
    const body = await req.json();
    const cardType = body.card_type === "buyer" ? "buyer" : body.card_type === "lead" ? "lead" : "";
    const cardId = String(body.card_id || "");
    if (!cardType || !/^[0-9a-f-]{36}$/i.test(cardId)) return json({ ok: false, error: "card" }, 400, origin);
    const column = cardType === "buyer" ? "buyer_id" : "lead_id";
    const { data: invites, error: listError } = await supabase.from("business_alert_invites")
      .select("id, channel, status, sent_at, opened_at, joined_at, expires_at, created_at")
      .eq(column, cardId)
      .order("sent_at", { ascending: false });
    if (listError) throw listError;
    const settings = await inviteSettings();
    if (body.action === "status" || !body.channel) {
      return json({
        ok: true,
        invites: (invites || []).map(chip),
        templates: { whatsapp: settings.whatsapp, email: settings.email }
      }, 200, origin);
    }
    const channel = body.channel === "whatsapp" || body.channel === "email" ? body.channel : "";
    if (!channel) return json({ ok: false, error: "channel" }, 400, origin);
    const card = await loadCard(cardType, cardId);
    if (!card) return json({ ok: false, error: "not_found" }, 404, origin);
    const nine = phone9(card.phone);
    let people: Record<string, unknown>[] = [];
    if (card.email || nine) {
      const filters = [];
      if (card.email) filters.push(`email.ilike.${card.email}`);
      if (nine) filters.push(`phone9.eq.${nine}`);
      const { data, error } = await supabase.from("business_alert_subscribers")
        .select("id, status, do_not_call, email_unsubscribed_at, whatsapp_unsubscribed_at")
        .or(filters.join(","));
      if (error) throw error;
      people = data || [];
    }
    const decision = inviteGuard({ card, channel, invites: invites || [], subscribers: people, now: Date.now() });
    if (!decision.ok) return json({ ok: false, error: decision.error, invites: (invites || []).map(chip) }, 200, origin);
    if (decision.supersede.length) {
      await supabase.from("business_alert_invites").update({ status: "superseded" }).in("id", decision.supersede);
    }
    const token = newInviteToken();
    const code = settings.live ? newShortCode() : null;
    const url = inviteUrl({ live: settings.live, token, code });
    const name = card.first_name || String(card.full_name || "").split(/\s+/)[0] || "";
    const template = channel === "email" ? settings.email : settings.whatsapp;
    const named = fillName(String(body.message || "").trim() || template, name);
    const whatsappText = messageWithLink(named, url);
    const expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const row = {
      [column]: cardId,
      channel,
      token_hash: hashInviteToken(token),
      short_code: code,
      prefill: prefillFromCard(card),
      status: "sent",
      sent_at: new Date().toISOString(),
      expires_at: expires,
      invited_by: "baruch",
      created_by: auth.user.id
    };
    const { data: saved, error: insertError } = await supabase.from("business_alert_invites").insert(row).select("id, channel, status, sent_at, opened_at, joined_at, expires_at").single();
    if (insertError) throw insertError;
    if (channel === "whatsapp") {
      const wa = `https://wa.me/${waNumber(card.phone)}?text=${encodeURIComponent(whatsappText)}`;
      return json({ ok: true, wa_url: wa, invite: chip(saved) }, 200, origin);
    }
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ ok: false, error: "missing_email_configuration", invite: chip(saved) }, 200, origin);
    const visible = emailBody(named);
    const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif">
<div dir="rtl" style="max-width:600px;margin:0 auto;background:#fff;padding:24px;text-align:right;color:#102844">
<img src="${LOGO}" alt="BSD" width="88" style="width:88px;height:auto;border:0">
<p style="font-size:18px;line-height:1.6;white-space:pre-wrap">${escapeHtml(visible)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0e1b34;color:#fff;text-decoration:none;border-radius:12px;padding:12px 18px;font-weight:700">הצטרפות לרשימה</a></p>
${signOffHtml()}
</div></body></html>`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: SUBSCRIBER_FROM,
        to: [card.email],
        subject: "הצטרפות לרשימת העדכונים של BSD",
        html,
        text: `${visible}\n\n${signOffText()}`
      })
    });
    if (!response.ok) return json({ ok: false, error: "send_failed", invite: chip(saved) }, 200, origin);
    return json({ ok: true, sent: true, invite: chip(saved) }, 200, origin);
  } catch (error) {
    console.error("business-alert-invite failed", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "save_failed" }, 500, origin);
  }
});
