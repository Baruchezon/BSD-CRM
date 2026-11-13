// CRM screen for website alert subscribers. verify_jwt stays enabled.
// The caller must be an active admin or manager. The function then uses the
// service role to call the business_alert_* functions. Tables stay closed to anon.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  SUBSCRIBER_FROM,
  SUBSCRIBER_REPLY_TO,
  SUBSCRIBER_SITE,
  listUnsubscribeHeaders,
  subscriberFromHeader,
  subscriberHtml,
  subscriberSubject,
  subscriberText,
  unsubscribeHttpsUrl,
  whatsappMessage
} from "../_shared/business-alert-mail.mjs";
import { gateDecision } from "../_shared/business-alert-rules.mjs";
import { matchAlertEmail, normalizeMatchConfig, publicCard, scoreAlert, sendGate } from "../_shared/alert-match.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is missing");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const ALLOWED = new Set([
  "https://baruchezon.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
]);

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

function clean(value: unknown, max = 2000) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

async function requireManager(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { error: "not_authenticated" as const };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { error: "not_authenticated" as const };
  const { data: profile } = await supabase.from("profiles").select("id, full_name, role, status").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.status !== "active" || !["admin", "manager"].includes(profile.role)) {
    return { error: "forbidden" as const };
  }
  return { user: data.user, profile };
}

function budgetLabel(row: Record<string, unknown>) {
  if (row.budget_open) return "פתוח להצעות";
  const min = row.budget_min as number | null;
  const max = row.budget_max as number | null;
  if (min === 0 && max === 250000) return "עד 250 אלף";
  if (min === 250000 && max === 500000) return "250–500 אלף";
  if (min === 500000 && max === 1000000) return "500 אלף–1 מיליון";
  if (min === 1000000 && max === 3000000) return "1–3 מיליון";
  if (min === 3000000 && max == null) return "מעל 3 מיליון";
  return "לא צוין";
}

function waLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, "");
  let national = digits;
  if (national.startsWith("0")) national = `972${national.slice(1)}`;
  if (!national) return "";
  return `https://wa.me/${national}?text=${encodeURIComponent(text)}`;
}

async function loadRow(id: string) {
  const { data, error } = await supabase.rpc("business_alert_crm_detail", { p_subscriber_id: id });
  if (error) throw error;
  return data?.subscriber || null;
}

async function matchSettings() {
  const { data, error } = await supabase.from("business_alert_match_settings").select("*").eq("id", true).maybeSingle();
  if (error) return normalizeMatchConfig({});
  return normalizeMatchConfig(data || {});
}

const BIZ_COLS = "id,business_number,internal_name,anon_display_name,field,category,subcategory,city,region,asking_price,short_description,anon_summary,anon_card_show_price,public_listing_active,anon_card_active,listing_status,is_archived";

function listedBusiness(row: Record<string, unknown>) {
  return row.is_archived !== true && (row.public_listing_active === true || row.anon_card_active === true);
}

async function recomputeMatches(subscriberId?: string) {
  const settings = await matchSettings();
  let subQuery = supabase.from("business_alert_subscribers").select("id,first_name,last_name,interests,region,budget_min,budget_max,budget_open,looking_for,manager_notes,legacy_no_consent,consent_general,consent_email,consent_whatsapp");
  if (subscriberId) subQuery = subQuery.eq("id", subscriberId);
  const { data: subscribers, error: subError } = await subQuery;
  if (subError) throw subError;
  const { data: businesses, error: bizError } = await supabase.from("businesses").select(BIZ_COLS).limit(2000);
  if (bizError) throw bizError;
  const listed = (businesses || []).filter(listedBusiness);
  let stored = 0;
  for (const subscriber of subscribers || []) {
    const scored = [];
    for (const business of listed) {
      const match = scoreAlert(subscriber, business, settings);
      if (!match) continue;
      scored.push({
        subscriber_id: subscriber.id,
        business_id: business.id,
        score: match.score,
        sector_points: match.sector_points,
        budget_points: match.budget_points,
        location_points: match.location_points,
        eligible: match.eligible,
        sendable: match.sendable,
        block_reason: match.block_reason,
        breakdown: match.breakdown,
        public_card: match.public_card,
        computed_at: new Date().toISOString()
      });
    }
    if (scored.length) {
      const { error } = await supabase.from("business_alert_matches").upsert(scored, { onConflict: "subscriber_id,business_id" });
      if (error) throw error;
      stored += scored.length;
    }
    const keep = new Set(scored.map(row => row.business_id));
    const { data: previous } = await supabase.from("business_alert_matches").select("id,business_id").eq("subscriber_id", subscriber.id);
    const stale = (previous || []).filter(row => !keep.has(row.business_id)).map(row => row.id);
    if (stale.length) {
      await supabase.from("business_alert_matches").update({
        sendable: false,
        eligible: false,
        block_reason: "no_longer_a_match",
        score: 0,
        computed_at: new Date().toISOString()
      }).in("id", stale);
    }
  }
  return { subscribers: (subscribers || []).length, businesses: listed.length, stored, sendingEnabled: settings.sendingEnabled };
}

async function matchAction(action: string, body: Record<string, unknown>, origin: string | null) {
  if (action === "recompute") {
    const result = await recomputeMatches(clean(body.id, 80) || undefined);
    return json({ ok: true, ...result }, 200, origin);
  }
  if (action === "matches") {
    const { data, error } = await supabase.from("business_alert_matches")
      .select("business_id,score,sector_points,budget_points,location_points,eligible,sendable,block_reason,breakdown,public_card,computed_at")
      .eq("subscriber_id", body.id)
      .order("score", { ascending: false });
    if (error) throw error;
    return json({ ok: true, matches: data || [], sendingEnabled: (await matchSettings()).sendingEnabled }, 200, origin);
  }
  if (action === "business_matches") {
    const { data, error } = await supabase.from("business_alert_matches")
      .select("subscriber_id,score,sector_points,budget_points,location_points,sendable,block_reason,breakdown,public_card")
      .eq("business_id", body.id)
      .order("score", { ascending: false });
    if (error) throw error;
    const ids = [...new Set((data || []).map(row => row.subscriber_id))];
    const { data: people } = ids.length
      ? await supabase.from("business_alert_subscribers").select("id,first_name,last_name,region,interests,status,legacy_no_consent,consent_email,consent_whatsapp").in("id", ids)
      : { data: [] };
    const byId = new Map((people || []).map(person => [person.id, person]));
    return json({
      ok: true,
      matches: (data || []).map(row => ({ ...row, subscriber: byId.get(row.subscriber_id) || null })),
      sendingEnabled: (await matchSettings()).sendingEnabled
    }, 200, origin);
  }
  const settings = await matchSettings();
  const { data: stored, error } = await supabase.from("business_alert_matches")
    .select("subscriber_id,sendable,block_reason,public_card")
    .eq("subscriber_id", body.subscriber_id)
    .eq("business_id", body.business_id)
    .maybeSingle();
  if (error) throw error;
  if (!stored) return json({ ok: false, error: "not_found" }, 404, origin);
  const blocked = sendGate(settings, stored);
  if (blocked) return json({ ok: false, error: blocked, allowed: false }, 200, origin);
  const row = await loadSecrets(String(stored.subscriber_id));
  if (!row) return json({ ok: false, error: "not_found" }, 404, origin);
  const channel = body.channel === "whatsapp" ? "whatsapp" : "email";
  const decision = gateDecision(row, channel);
  await supabase.rpc("business_alert_gate_send", {
    p_subscriber_id: row.id,
    p_channel: channel,
    p_purpose: "alert",
    p_business_number: null,
    p_match_pct: null
  });
  if (!decision.allowed) return json({ ok: false, error: decision.reason, allowed: false }, 200, origin);
  const link = unsubscribeHttpsUrl(supabaseUrl, row.unsubscribe_token, channel);
  const mail = matchAlertEmail({ firstName: row.first_name, card: stored.public_card, unsubscribeUrl: link });
  if (channel === "whatsapp") {
    const text = `${mail.text}`;
    return json({ ok: true, allowed: true, text, url: waLink(row.phone || "", text) }, 200, origin);
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ ok: false, error: "missing_email_configuration", allowed: true }, 200, origin);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: mail.from,
      reply_to: SUBSCRIBER_REPLY_TO,
      to: [row.email],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: listUnsubscribeHeaders(link)
    })
  });
  if (!response.ok) return json({ ok: false, error: "send_failed", allowed: true }, 200, origin);
  return json({ ok: true, allowed: true, sent: true }, 200, origin);
}

async function loadSecrets(id: string) {
  const { data, error } = await supabase
    .from("business_alert_subscribers")
    .select("id, unsubscribe_token, visit_token, first_name, email, phone, legacy_no_consent, consent_general, consent_email, consent_whatsapp, status, email_unsubscribed_at, whatsapp_unsubscribed_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  if (origin && !ALLOWED.has(origin)) return json({ ok: false, error: "origin_not_allowed" }, 403, origin);

  const auth = await requireManager(req);
  if ("error" in auth && auth.error) {
    const status = auth.error === "forbidden" ? 403 : 401;
    return json({ ok: false, error: auth.error }, status, origin);
  }

  try {
    const body = await req.json();
    const action = clean(body.action, 40);

    if (action === "list") {
      const { data, error } = await supabase.rpc("business_alert_crm_list");
      if (error) throw error;
      const { count } = await supabase.from("leads").select("id", { count: "exact", head: true })
        .eq("source", "אתר BSD החדש").eq("type", "buyer").eq("is_archived", false);
      const settings = await matchSettings();
      return json({ ok: true, subscribers: data || [], websiteBuyerLeads: count || 0, from: subscriberFromHeader(), sendingEnabled: settings.sendingEnabled }, 200, origin);
    }

    if (action === "detail") {
      const { data, error } = await supabase.rpc("business_alert_crm_detail", { p_subscriber_id: body.id });
      if (error) throw error;
      if (!data?.subscriber) return json({ ok: false, error: "not_found" }, 404, origin);
      return json({ ok: true, ...data }, 200, origin);
    }

    if (action === "status") {
      const { data, error } = await supabase.rpc("business_alert_apply_status", {
        p_subscriber_id: body.id,
        p_status: clean(body.status, 40),
        p_reason: clean(body.reason, 300) || null,
        p_fresh_consent: body.fresh_consent === true
      });
      if (error) return json({ ok: false, error: "status_rejected", message: error.message }, 400, origin);
      return json({ ok: true, result: data }, 200, origin);
    }

    if (action === "handling") {
      const { data, error } = await supabase.rpc("business_alert_set_handling", {
        p_subscriber_id: body.id,
        p_notes: body.notes == null ? null : clean(body.notes, 4000),
        p_handled: typeof body.handled === "boolean" ? body.handled : null,
        p_do_not_call: typeof body.do_not_call === "boolean" ? body.do_not_call : null
      });
      if (error) return json({ ok: false, error: "not_found" }, 404, origin);
      return json({ ok: true, result: data }, 200, origin);
    }

    if (action === "prepare_whatsapp" || action === "prepare_email" || action === "send_email") {
      const row = await loadSecrets(body.id);
      if (!row) return json({ ok: false, error: "not_found" }, 404, origin);
      const channel = action === "prepare_whatsapp" ? "whatsapp" : "email";
      const decision = gateDecision(row, channel);
      const { data: gated, error: gateError } = await supabase.rpc("business_alert_gate_send", {
        p_subscriber_id: row.id,
        p_channel: channel,
        p_purpose: "manual",
        p_business_number: null,
        p_match_pct: null
      });
      if (gateError) throw gateError;
      const gate = Array.isArray(gated) ? gated[0] : gated;
      if (!decision.allowed || !gate?.allowed) {
        return json({ ok: false, error: gate?.reason || decision.reason || "blocked", allowed: false }, 200, origin);
      }
      if (channel === "whatsapp") {
        const text = whatsappMessage(row.first_name);
        return json({ ok: true, allowed: true, text, url: waLink(row.phone || "", text) }, 200, origin);
      }
      const link = unsubscribeHttpsUrl(supabaseUrl, row.unsubscribe_token, "email");
      const catalog = `${SUBSCRIBER_SITE}/עסקים-למכירה/?bat=${encodeURIComponent(row.visit_token)}`;
      const message = `נרשמתם לעדכונים על עסקים למכירה. אפשר לראות את הרשימה האנונימית כאן:\n${catalog}\nאין בהודעה שם של עסק.`;
      const subject = subscriberSubject("עדכון על עסקים למכירה");
      const text = subscriberText({ firstName: row.first_name, body: message, unsubscribeUrl: link });
      const html = subscriberHtml({ firstName: row.first_name, body: message, unsubscribeUrl: link });
      if (action === "prepare_email") {
        return json({
          ok: true,
          allowed: true,
          subject,
          text,
          mailto: `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
        }, 200, origin);
      }
      const apiKey = Deno.env.get("RESEND_API_KEY");
      if (!apiKey) return json({ ok: false, error: "missing_email_configuration", allowed: true }, 200, origin);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from: SUBSCRIBER_FROM,
          reply_to: SUBSCRIBER_REPLY_TO,
          to: [row.email],
          subject,
          html,
          text,
          headers: listUnsubscribeHeaders(link)
        })
      });
      if (!response.ok) {
        const detail = await response.text();
        console.error("manual alert email failed", response.status, detail);
        return json({ ok: false, error: "send_failed", allowed: true }, 200, origin);
      }
      return json({ ok: true, allowed: true, sent: true }, 200, origin);
    }

    if (action === "convert_lead") {
      const detail = await loadRow(body.id);
      if (!detail) return json({ ok: false, error: "not_found" }, 404, origin);
      if (detail.crm_lead_id) return json({ ok: true, lead_id: detail.crm_lead_id, already: true }, 200, origin);
      const fullName = [detail.first_name, detail.last_name].filter(Boolean).join(" ");
      const notes = [
        "נוצר מנרשם לעדכוני עסקים באתר.",
        `תחומים: ${(detail.interests || []).join(", ") || "לא צוין"}`,
        `אזור: ${detail.region || "לא צוין"}`,
        `תקציב: ${budgetLabel(detail)}`,
        `הסכמה שיווקית: ${detail.legacy_no_consent ? "עדיין אין" : "כן"}`,
        `אימייל: ${detail.consent_email ? "כן" : "לא"}`,
        `וואטסאפ: ${detail.consent_whatsapp ? "כן" : "לא"}`,
        `לא להתקשר: ${detail.do_not_call ? "כן" : "לא"}`,
        detail.source_url ? `עמוד: ${detail.source_url}` : ""
      ].filter(Boolean).join("\n");
      const { data: lead, error } = await supabase.from("leads").insert({
        type: "buyer",
        first_name: detail.first_name,
        last_name: detail.last_name,
        full_name: fullName,
        phone: detail.phone,
        email: detail.email,
        source: "עדכוני אתר BSD",
        status: "חדש",
        notes,
        requested_area: detail.region,
        budget: detail.budget_max,
        lead_side: "buyer",
        lead_side_source: "business_alert",
        created_by: auth.user.id,
        handled_by: auth.user.id
      }).select("id").single();
      if (error || !lead?.id) throw error ?? new Error("lead_not_created");
      const { error: linkError } = await supabase.from("business_alert_subscribers").update({ crm_lead_id: lead.id }).eq("id", detail.id);
      if (linkError) throw linkError;
      return json({ ok: true, lead_id: lead.id, already: false }, 200, origin);
    }

    if (action === "recompute" || action === "matches" || action === "business_matches" || action === "send_match") {
      return await matchAction(action, body, origin);
    }

    return json({ ok: false, error: "unknown_action" }, 400, origin);
  } catch (error) {
    console.error("business-alert-admin failed", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "save_failed" }, 500, origin);
  }
});
