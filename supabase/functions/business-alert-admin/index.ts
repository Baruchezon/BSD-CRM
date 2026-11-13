// CRM screen for website alert subscribers. verify_jwt stays enabled.
// The caller must be an active admin or manager. The function then uses the
// service role to call the business_alert_* functions. Tables stay closed to anon.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { timingSafeEqual } from "node:crypto";
import { oneAlertDecision, selectAlertBusinesses } from "./one-alert.mjs";
import {
  SUBSCRIBER_FROM,
  SUBSCRIBER_REPLY_TO,
  SUBSCRIBER_SITE,
  listUnsubscribeHeaders,
  subscriberFromHeader,
  subscriberHtml,
  subscriberSubject,
  say,
  subscriberText,
  unsubscribeHttpsUrl,
  whatsappMessage
} from "../_shared/business-alert-mail.mjs";
import { gateDecision } from "../_shared/business-alert-rules.mjs";
import { matchAlertEmail, normalizeMatchConfig, publicCard, scoreAlert, sendGate } from "../_shared/alert-match.mjs";
import { APPROVED_ALERT_BUSINESSES, threeBusinessEmail } from "../_shared/opportunity-email.mjs";
import copy from "../../../copy/he.json" with { type: "json" };

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

function numOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.map(item => clean(item, 60)).filter(Boolean) : [];
}

function sameSecret(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function requireCaller(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { error: "not_authenticated" as const };
  if (serviceRoleKey && sameSecret(token, serviceRoleKey)) return { serviceRole: true as const };
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

async function logDryRun(kind: string, detail: Record<string, unknown>) {
  const { error } = await supabase.from("business_alert_dry_run_log").insert({
    kind,
    subscriber_id: detail.subscriber_id || null,
    business_id: detail.business_id || null,
    channel: detail.channel || null,
    detail
  });
  if (error) console.log("dry_run", kind, detail);
}

async function vipSendSettings() {
  const { data } = await supabase.from("business_alert_match_settings")
    .select("vip_send_enabled, vip_send_allowlist")
    .eq("id", true)
    .maybeSingle();
  const allowlist = Array.isArray(data?.vip_send_allowlist) ? data.vip_send_allowlist.map(String) : [];
  return { enabled: data?.vip_send_enabled === true, allowlist };
}

function vipSendAllowed(settings: { enabled: boolean; allowlist: string[] }, businessId: string) {
  if (settings.allowlist.includes(businessId)) return true;
  return settings.enabled;
}

function anonymousBusinessCard(row: Record<string, unknown>) {
  const internal = String(row.internal_name || "").trim();
  let title = String(row.anon_display_name || "").trim();
  if (!title || title === internal) title = "הזדמנות עסקית";
  const rawNumber = String(row.business_number || "").trim();
  const number = /^BSD-B-/i.test(rawNumber) || !rawNumber ? rawNumber : `BSD-B-${rawNumber}`;
  const price = row.anon_card_show_price === true && row.asking_price != null
    ? Number(row.asking_price).toLocaleString("he-IL") + " ₪"
    : "";
  return {
    number,
    title,
    region: String(row.region || ""),
    priceText: price,
    summary: String(row.anon_summary || "").replace(/\s+/g, " ").trim().slice(0, 400),
    url: `${SUBSCRIBER_SITE}/עסקים-למכירה/${encodeURIComponent(number)}`
  };
}

const BIZ_COLS = "id,business_number,internal_name,anon_display_name,field,category,subcategory,city,region,asking_price,short_description,anon_summary,anon_card_show_price,public_listing_active,anon_card_active,listing_status,is_archived,taxonomy";

function listedBusiness(row: Record<string, unknown>) {
  return row.is_archived !== true && (row.public_listing_active === true || row.anon_card_active === true);
}

async function recomputeMatches(subscriberId?: string) {
  const settings = await matchSettings();
  let subQuery = supabase.from("business_alert_subscribers").select("id,first_name,last_name,interests,categories,subcategories,regions,region,budget_min,budget_max,budget_open,looking_for,manager_notes,legacy_no_consent,consent_general,consent_email,consent_whatsapp,is_test,status");
  if (subscriberId) subQuery = subQuery.eq("id", subscriberId);
  const { data: subscribers, error: subError } = await subQuery;
  if (subError) throw subError;
  const { data: businesses, error: bizError } = await supabase.from("businesses").select(BIZ_COLS).limit(2000);
  if (bizError) throw bizError;
  const listed = (businesses || []).filter(listedBusiness);
  let stored = 0;
  for (const subscriber of subscribers || []) {
    if (subscriber.is_test === true) continue;
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
  if (settings.dryRun) {
    await logDryRun("match", { subscriber_id: row.id, business_id: body.business_id, channel });
    return json({ ok: true, sent: false, dry_run: true, allowed: false }, 200, origin);
  }
  const link = unsubscribeHttpsUrl(supabaseUrl, row.unsubscribe_token, channel);
  const mail = matchAlertEmail({ firstName: row.first_name, addressForm: row.address_form, card: stored.public_card, unsubscribeUrl: link });
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
    .select("id, unsubscribe_token, visit_token, first_name, email, phone, address_form, legacy_no_consent, consent_general, consent_email, consent_whatsapp, status, email_unsubscribed_at, whatsapp_unsubscribed_at, is_test")
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

  const auth = await requireCaller(req);
  if ("error" in auth && auth.error) {
    const status = auth.error === "forbidden" ? 403 : 401;
    return json({ ok: false, error: auth.error }, status, origin);
  }

  try {
    const body = await req.json();
    const action = clean(body.action, 40);
    if (auth.serviceRole && action !== "send_one_alert") {
      return json({ ok: false, error: "test_only" }, 403, origin);
    }

    if (action === "roster") {
      const { data, error } = await supabase.rpc("business_alert_roster");
      if (error) throw error;
      return json({ ok: true, subscribers: data || [] }, 200, origin);
    }

    if (action === "list") {
      const { data, error } = await supabase.rpc("business_alert_crm_list");
      if (error) throw error;
      const { count } = await supabase.from("leads").select("id", { count: "exact", head: true })
        .eq("source", "אתר BSD החדש").eq("type", "buyer").eq("is_archived", false);
      const settings = await matchSettings();
      return json({ ok: true, subscribers: data || [], websiteBuyerLeads: count || 0, from: subscriberFromHeader(), sendingEnabled: settings.sendingEnabled }, 200, origin);
    }

    if (action === "screen") {
      const { data, error } = await supabase.rpc("business_alert_screen_list", {
        p_source: clean(body.source, 20) || null,
        p_sector: clean(body.sector, 80) || null,
        p_region: clean(body.region, 80) || null,
        p_budget_min: numOrNull(body.budget_min),
        p_budget_max: numOrNull(body.budget_max),
        p_status: clean(body.status, 40) || null
      });
      if (error) throw error;
      const { count } = await supabase.from("leads").select("id", { count: "exact", head: true })
        .eq("source", "אתר BSD החדש").eq("type", "buyer").eq("is_archived", false);
      const settings = await matchSettings();
      return json({ ok: true, subscribers: data || [], websiteBuyerLeads: count || 0, from: subscriberFromHeader(), sendingEnabled: settings.sendingEnabled }, 200, origin);
    }

    if (action === "card") {
      const { data, error } = await supabase.rpc("business_alert_screen_card", { p_subscriber_id: body.id });
      if (error) throw error;
      if (!data?.subscriber) return json({ ok: false, error: "not_found" }, 404, origin);
      return json({ ok: true, ...data }, 200, origin);
    }

    if (action === "sends") {
      const { data, error } = await supabase.rpc("business_alert_sends_history", { p_subscriber_id: body.id });
      if (error) throw error;
      return json({ ok: true, sends: data || [] }, 200, origin);
    }

    if (action === "do_not_call") {
      const { data, error } = await supabase.rpc("business_alert_set_do_not_call", {
        p_subscriber_id: body.id,
        p_flag: body.do_not_call === true
      });
      if (error) return json({ ok: false, error: "not_found" }, 404, origin);
      return json({ ok: true, result: data }, 200, origin);
    }

    if (action === "add_subscriber") {
      const { data, error } = await supabase.rpc("business_alert_add_manual", {
        p_first_name: clean(body.first_name, 80),
        p_last_name: clean(body.last_name, 80),
        p_phone: clean(body.phone, 40),
        p_email: clean(body.email, 180) || null,
        p_consent_email: body.consent_email === true,
        p_consent_whatsapp: body.consent_whatsapp === true,
        p_email_method: clean(body.consent_email_method, 40) || null,
        p_whatsapp_method: clean(body.consent_whatsapp_method, 40) || null,
        p_email_note: clean(body.consent_email_note, 500) || null,
        p_whatsapp_note: clean(body.consent_whatsapp_note, 500) || null,
        p_categories: textList(body.categories),
        p_regions: textList(body.regions),
        p_budget_min: numOrNull(body.budget_min),
        p_budget_max: numOrNull(body.budget_max),
        p_budget_open: body.budget_open === true,
        p_consent_by: clean(auth.profile.full_name, 120) || clean(auth.user.email, 180),
        p_address_form: clean(body.address_form, 20) || null
      });
      if (error) return json({ ok: false, error: "add_rejected", message: error.message }, 400, origin);
      return json({ ok: true, card: data }, 200, origin);
    }

    if (action === "set_address_form") {
      const { data, error } = await supabase.rpc("business_alert_set_address_form", {
        p_subscriber_id: body.id,
        p_address_form: clean(body.address_form, 20) || null
      });
      if (error) return json({ ok: false, error: "address_rejected", message: error.message }, 400, origin);
      return json({ ok: true, result: data }, 200, origin);
    }

    if (action === "log_interaction") {
      const { data, error } = await supabase.rpc("business_alert_log_interaction", {
        p_subscriber_id: body.id,
        p_kind: clean(body.kind, 20),
        p_direction: clean(body.direction, 10) || null,
        p_outcome: clean(body.outcome, 40) || null,
        p_note: clean(body.note, 2000) || null,
        p_created_by: clean(auth.profile.full_name, 120) || clean(auth.user.email, 180)
      });
      if (error) return json({ ok: false, error: "log_rejected", message: error.message }, 400, origin);
      return json({ ok: true, interaction: data }, 200, origin);
    }

    if (action === "manual_add") {
      const { data, error } = await supabase.rpc("business_alert_manual_add", {
        p_first_name: clean(body.first_name, 80),
        p_last_name: clean(body.last_name, 80),
        p_phone: clean(body.phone, 40),
        p_email: clean(body.email, 180),
        p_manual_source: clean(body.manual_source, 20),
        p_consent_text: clean(body.consent_text, 2000),
        p_consent_version: clean(body.consent_version, 80),
        p_consent_email: body.consent_email === true,
        p_consent_whatsapp: body.consent_whatsapp === true,
        p_categories: textList(body.categories),
        p_subcategories: textList(body.subcategories),
        p_regions: textList(body.regions),
        p_budget_min: numOrNull(body.budget_min),
        p_budget_max: numOrNull(body.budget_max),
        p_budget_open: body.budget_open === true,
        p_looking_for: clean(body.looking_for, 2000) || null,
        p_region: clean(body.region, 80) || null,
        p_interests: textList(body.interests)
      });
      if (error) return json({ ok: false, error: "manual_add_rejected", message: error.message }, 400, origin);
      return json({ ok: true, card: data }, 200, origin);
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

    if (action === "preview_vip_send" || action === "send_vip") {
      const businessId = clean(body.business_id || body.id, 80);
      const { data: business, error: businessError } = await supabase.from("businesses")
        .select("id, business_number, anon_display_name, internal_name, category, subcategory, region, asking_price, anon_card_show_price, anon_summary")
        .eq("id", businessId)
        .maybeSingle();
      if (businessError) throw businessError;
      if (!business) return json({ ok: false, error: "not_found" }, 404, origin);
      const settings = await vipSendSettings();
      const allowed = vipSendAllowed(settings, businessId);
      const { data: people, error: peopleError } = await supabase.rpc("business_alert_vip_recipients");
      if (peopleError) throw peopleError;
      const recipients = Array.isArray(people) ? people : [];
      const { data: sentRows } = await supabase.from("business_alert_vip_sends")
        .select("lead_id")
        .eq("business_id", businessId);
      const already = new Set((sentRows || []).map(row => String(row.lead_id)));
      const card = anonymousBusinessCard(business);
      const sample = threeBusinessEmail({
        firstName: "לקוח",
        businesses: [{ ...card, detailsUrl: `${supabaseUrl}/functions/v1/business-alert-request-details?business=${encodeURIComponent(card.number)}` }],
        unsubscribeUrl: `${SUBSCRIBER_SITE}/הסרה/`,
        addressForm: null
      });
      if (action === "preview_vip_send" || body.confirm !== true) {
        return json({
          ok: true,
          preview: true,
          sent: false,
          enabled: allowed,
          from: sample.from,
          subject: sample.subject,
          html: sample.html,
          text: sample.text,
          recipients: recipients.map(person => ({
            id: person.id,
            first_name: person.first_name,
            last_name: person.last_name,
            email: person.email,
            agreement_status: person.agreement_status,
            already_sent: already.has(String(person.id))
          }))
        }, 200, origin);
      }
      if (!allowed) return json({ ok: false, error: "vip_send_disabled", enabled: false, sent: false }, 200, origin);
      const delivery = await matchSettings();
      if (delivery.dryRun) {
        await logDryRun("vip", { business_id: businessId, channel: "email", lead_ids: body.lead_ids || [] });
        return json({ ok: true, sent: false, dry_run: true, enabled: true }, 200, origin);
      }
      const chosen = new Set((Array.isArray(body.lead_ids) ? body.lead_ids : []).map(String));
      let sentCount = 0;
      const apiKey = Deno.env.get("RESEND_API_KEY");
      if (!apiKey) return json({ ok: false, error: "missing_email_configuration", sent: false }, 200, origin);
      for (const person of recipients) {
        if (!chosen.has(String(person.id))) continue;
        if (already.has(String(person.id)) && body.resend !== true) continue;
        const mail = threeBusinessEmail({
          firstName: String(person.first_name || ""),
          businesses: [{ ...card, detailsUrl: `${supabaseUrl}/functions/v1/business-alert-request-details?business=${encodeURIComponent(card.number)}&lead=${encodeURIComponent(person.id)}` }],
          unsubscribeUrl: `${SUBSCRIBER_SITE}/הסרה/`,
          addressForm: null
        });
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            from: mail.from,
            reply_to: SUBSCRIBER_REPLY_TO,
            to: [person.email],
            subject: mail.subject,
            html: mail.html,
            text: mail.text
          })
        });
        if (!response.ok) continue;
        await supabase.from("business_alert_vip_sends").upsert({
          business_id: businessId,
          lead_id: person.id,
          sent_at: new Date().toISOString(),
          sent_by: clean(auth.profile.full_name, 120) || clean(auth.user.email, 180)
        }, { onConflict: "business_id,lead_id" });
        sentCount += 1;
      }
      return json({ ok: true, sent: sentCount > 0, sent_count: sentCount }, 200, origin);
    }

    if (action === "send_one_alert") {
      if (Array.isArray(body.ids) || Array.isArray(body.subscribers)) {
        return json({ ok: false, error: "one_subscriber_only" }, 400, origin);
      }
      const id = clean(body.id, 80);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return json({ ok: false, error: "one_subscriber_only" }, 400, origin);
      }
      const row = await loadSecrets(id);
      if (!row?.email) return json({ ok: false, error: "not_found" }, 404, origin);
      const listed = (value: unknown) => value == null || value === "" ? [] : Array.isArray(value) ? value : [value];
      const chosen = selectAlertBusinesses(
        [...listed(body.business_ids), ...listed(body.businesses), ...listed(body.business_numbers)],
        APPROVED_ALERT_BUSINESSES
      );
      if (chosen.error) return json({ ok: false, error: chosen.error }, 400, origin);
      const delivery = await matchSettings();
      const { data: settingsRow } = await supabase.from("business_alert_match_settings")
        .select("alert_send_allowlist")
        .eq("id", true)
        .maybeSingle();
      const decision = oneAlertDecision({
        subscriber: row,
        serviceRole: auth.serviceRole === true,
        allowlist: settingsRow?.alert_send_allowlist || [],
        sendingEnabled: delivery.sendingEnabled,
        dryRun: delivery.dryRun
      });
      if (!decision.ok) return json({ ok: false, error: decision.error, sent: false }, 200, origin);
      const mail = threeBusinessEmail({
        firstName: String(row.first_name || ""),
        businesses: chosen.businesses.map(business => ({
          ...business,
          detailsUrl: `${supabaseUrl}/functions/v1/business-alert-request-details?business=${encodeURIComponent(business.number)}&token=${encodeURIComponent(row.unsubscribe_token || "")}`
        })),
        unsubscribeUrl: unsubscribeHttpsUrl(supabaseUrl, row.unsubscribe_token, "email"),
        addressForm: row.address_form
      });
      if (body.confirm !== true) {
        return json({ ok: true, preview: true, sent: false, from: mail.from, subject: mail.subject, businesses: chosen.businesses.map(item => item.number) }, 200, origin);
      }
      const apiKey = Deno.env.get("RESEND_API_KEY");
      if (!apiKey) return json({ ok: false, error: "missing_email_configuration", sent: false }, 200, origin);
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
          headers: listUnsubscribeHeaders(unsubscribeHttpsUrl(supabaseUrl, row.unsubscribe_token, "email"))
        })
      });
      if (!response.ok) return json({ ok: false, error: "send_failed", sent: false }, 200, origin);
      const payload = await response.json().catch(() => ({}));
      const resendId = payload?.id || null;
      const actor = auth.serviceRole ? "service_role" : clean(auth.profile?.full_name || auth.user?.email, 120);
      for (const business of chosen.businesses) {
        const { error } = await supabase.from("business_alert_sends").upsert({
          subscriber_id: row.id,
          business_number: business.number,
          channel: "email",
          created_by: actor || "admin",
          resend_id: resendId,
          sent_at: new Date().toISOString()
        }, { onConflict: "subscriber_id,business_number" });
        if (error) console.error("alert send row was not stored", error.message);
      }
      return json({
        ok: true,
        sent: true,
        preview: false,
        resend_id: resendId,
        businesses: chosen.businesses.map(item => item.number)
      }, 200, origin);
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
        const text = whatsappMessage(row.first_name, row.address_form);
        return json({ ok: true, allowed: true, text, url: waLink(row.phone || "", text) }, 200, origin);
      }
      const link = unsubscribeHttpsUrl(supabaseUrl, row.unsubscribe_token, "email");
      const catalog = `${SUBSCRIBER_SITE}/עסקים-למכירה/?bat=${encodeURIComponent(row.visit_token)}`;
      const message = `${say(copy.email.warm, row.address_form)}\n${say(copy.form.thanks, row.address_form)}\n${catalog}`;
      const subject = subscriberSubject("עדכון על עסקים למכירה");
      const text = subscriberText({ firstName: row.first_name, body: message, unsubscribeUrl: link, addressForm: row.address_form });
      const html = subscriberHtml({ firstName: row.first_name, body: message, unsubscribeUrl: link, addressForm: row.address_form });
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
