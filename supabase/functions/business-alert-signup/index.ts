// Business-alert signup for www.bsd-bbi.co.il.
// Deploy as business-alert-signup on zcdlegcvfirwzitfxjcs with verify_jwt
// enabled, after 20261113120000_business_alert_compliance.sql.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
// Every email this function sends uses the subscriber From constant.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createHmac } from "node:crypto";
import {
  RATE_LIMITS,
  alreadyRegisteredPlan,
  cleanText,
  isUnsubscribeToken,
  consentWritePayload,
  newUpdateNonce,
  appendLeadNotes,
  planSubscriberUpdate,
  planSubscriberWrite,
  validateSignup,
  verifyUpdateToken
} from "./logic.mjs";
import {
  INTERNAL_TO,
  MAIL_FROM,
  MAIL_REPLY_TO,
  internalAlertEmail,
  thankYouEmailHtml,
  thankYouEmailText,
  thankYouSubject,
  unsubscribeUrl
} from "./email.mjs";
import { listUnsubscribeHeaders, unsubscribeHttpsUrl } from "../_shared/business-alert-mail.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is missing");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const TABLE = "business_alert_subscribers";
const ATTEMPTS = "business_alert_signup_attempts";
const LOOKUP = "id, first_name, last_name, email, phone, phone9, unsubscribe_token, status, unsubscribed_at, unsubscribed_by, unsubscribe_reason, email_unsubscribed_at, whatsapp_unsubscribed_at, status_history, resubscribed_at, categories, subcategories, flags, budget_min, budget_max, budget_open, regions, looking_for, consent_email, consent_whatsapp, address_form, crm_lead_id, region, interests, notes";

const allowedOrigins = new Set([
  "https://bsd-bbi.co.il",
  "https://www.bsd-bbi.co.il",
  "https://lively-wood-e2c6.baruch-ezon.workers.dev",
  "https://cursor-alerts-consent-unsubscribe-afca-lively-wood-e2c6.baruch-ezon.workers.dev"
]);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://www.bsd-bbi.co.il",
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

function clientIp(req: Request) {
  const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "";
  return cleanText(forwarded.split(",")[0], 64);
}

async function sendEmail(to: string, subject: string, html: string, text?: string, headers?: Record<string, string>, from: string = MAIL_FROM) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("Alert email failed: missing Resend API key");
    return { sent: false, error: "missing_email_configuration" };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        reply_to: MAIL_REPLY_TO,
        to: [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(headers ? { headers } : {})
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error("Alert email failed", response.status, detail);
      return { sent: false, error: `resend_${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    console.error("Alert email failed", error instanceof Error ? error.message : String(error));
    return { sent: false, error: "email_request_failed" };
  }
}

async function countAttempts(kind: string, column: "ip" | "email", value: string, windowMs: number) {
  if (!value) return 0;
  const since = new Date(Date.now() - windowMs).toISOString();
  let query = supabase.from(ATTEMPTS).select("id", { count: "exact", head: true }).eq("kind", kind).gte("created_at", since);
  query = column === "email" ? query.ilike("email", value) : query.eq("ip", value);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function recordAttempt(kind: string, email: string, ip: string, subscriberId?: string) {
  const { error } = await supabase.from(ATTEMPTS).insert({
    kind,
    email: email || null,
    ip: ip || null,
    ...(subscriberId ? { subscriber_id: subscriberId } : {})
  });
  if (error) console.error("Alert attempt log failed", error.message);
}

async function countSubscriberUpdates(subscriberId: string, windowMs: number) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await supabase.from(ATTEMPTS).select("id", { count: "exact", head: true })
    .eq("kind", "update").eq("subscriber_id", subscriberId).gte("created_at", since);
  if (error) throw error;
  return count || 0;
}

async function findByEmail(email: string) {
  const { data, error } = await supabase.from(TABLE).select(LOOKUP).ilike("email", email).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function findByPhone9(phone9: string) {
  const { data, error } = await supabase.from(TABLE).select(LOOKUP).eq("phone9", phone9).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

function writePayload(row: Record<string, unknown>, previous: Record<string, unknown> | null, now: string, consentIp: string, consentUserAgent: string) {
  const payload = consentWritePayload(row, previous, now);
  if (payload.identity_kept) return payload;
  if (payload.consent_at) {
    payload.consent_ip = consentIp || null;
    payload.consent_user_agent = consentUserAgent || null;
  }
  return payload;
}

async function recordIdentityAudit(subscriberId: string, audit: { previous: unknown; incoming: unknown }) {
  const { error } = await supabase.from("business_alert_identity_audit").insert({
    subscriber_id: subscriberId,
    previous: audit.previous,
    incoming: audit.incoming
  });
  if (error) console.error("identity audit was not stored", error.message);
  else console.log("business-alert signup kept the existing name and email", subscriberId);
}

async function writeSubscriber(row: Record<string, unknown>, consentIp: string, consentUserAgent: string) {
  const now = new Date().toISOString();
  const emailRow = await findByEmail(String(row.email));
  const phoneRow = row.phone9 ? await findByPhone9(String(row.phone9)) : null;
  const plan = planSubscriberWrite({ emailRow, phoneRow });
  const target = [emailRow, phoneRow].find(item => item?.id && item.id === plan.targetId) || null;
  const payload = writePayload(row, target, now, consentIp, consentUserAgent);
  if (payload.identity_kept && plan.targetId) {
    await recordIdentityAudit(String(plan.targetId), payload.identity_audit);
    return {
      id: plan.targetId,
      unsubscribe_token: target?.unsubscribe_token,
      signupKind: "identity_kept",
      previousStatus: target?.status || null,
      consentAt: target?.consent_at || null,
      identityKept: true,
      identityAudit: payload.identity_audit
    };
  }
  if (plan.detachPhoneId) {
    const { error } = await supabase.from(TABLE).update({ phone: null, phone9: null }).eq("id", plan.detachPhoneId);
    if (error) throw error;
  }
  if (plan.action === "update" && plan.targetId) {
    const { data, error } = await supabase.from(TABLE).update(payload).eq("id", plan.targetId).select("id, unsubscribe_token").single();
    if (error) throw error;
    return { ...data, signupKind: "returning", previousStatus: target?.status || null, consentAt: payload.consent_at || target?.consent_at || null };
  }
  const { data, error } = await supabase.from(TABLE).insert(payload).select("id, unsubscribe_token").single();
  if (error?.code === "23505") {
    const again = (await findByEmail(String(row.email))) || (row.phone9 ? await findByPhone9(String(row.phone9)) : null);
    if (!again?.id) throw error;
    const retry = writePayload(row, again, now, consentIp, consentUserAgent);
    if (retry.identity_kept) {
      await recordIdentityAudit(String(again.id), retry.identity_audit);
      return {
        id: again.id,
        unsubscribe_token: again.unsubscribe_token,
        signupKind: "identity_kept",
        previousStatus: again.status || null,
        consentAt: null,
        identityKept: true,
        identityAudit: retry.identity_audit
      };
    }
    const { data: updated, error: updateError } = await supabase.from(TABLE).update(retry).eq("id", again.id).select("id, unsubscribe_token").single();
    if (updateError) throw updateError;
    return { ...updated, signupKind: "returning", previousStatus: again.status || null, consentAt: retry.consent_at || null };
  }
  if (error || !data?.id) throw error ?? new Error("subscriber_not_created");
  return { ...data, signupKind: "new", previousStatus: null, consentAt: now };
}

// UPDATE_TOKEN_SECRET wins when set. Otherwise the key is derived from the service
// role key (always present in the edge runtime). Neither value is ever logged.
let derivedUpdateTokenKey = "";
function updateTokenSecret() {
  const explicit = Deno.env.get("UPDATE_TOKEN_SECRET") || "";
  if (explicit) return explicit;
  if (!derivedUpdateTokenKey && serviceRoleKey) {
    derivedUpdateTokenKey = createHmac("sha256", serviceRoleKey).update("bsd-update-token-v1").digest("base64url");
  }
  return derivedUpdateTokenKey;
}

async function applyProfileUpdate(body: Record<string, unknown>, origin: string | null, ip: string) {
  const secret = updateTokenSecret();
  if (!secret) return json({ ok: false, error: "token_unavailable" }, 500, origin);
  const ipAttempts = await countAttempts("update", "ip", ip, RATE_LIMITS.updatePerIp.windowMs);
  if (ipAttempts >= RATE_LIMITS.updatePerIp.limit) return json({ ok: false, error: "rate_limited" }, 429, origin);
  const verified = verifyUpdateToken(body.update_token, secret, Date.now());
  if (!verified.ok) return json({ ok: false, error: verified.error }, 400, origin);
  const subAttempts = await countSubscriberUpdates(verified.subscriberId, RATE_LIMITS.updatePerSubscriber.windowMs);
  if (subAttempts >= RATE_LIMITS.updatePerSubscriber.limit) return json({ ok: false, error: "rate_limited" }, 429, origin);
  await recordAttempt("update", "", ip, verified.subscriberId);

  const { data: nonceRow, error: nonceError } = await supabase.from("business_alert_update_nonces")
    .select("nonce, subscriber_id, email_matched, expires_at, used_at")
    .eq("nonce", verified.nonce)
    .maybeSingle();
  if (nonceError) throw nonceError;
  if (!nonceRow || nonceRow.used_at || nonceRow.subscriber_id !== verified.subscriberId || new Date(nonceRow.expires_at).getTime() <= Date.now()) {
    return json({ ok: false, error: "invalid_token" }, 400, origin);
  }

  const { data: stored, error: storedError } = await supabase.from(TABLE).select(LOOKUP).eq("id", verified.subscriberId).maybeSingle();
  if (storedError) throw storedError;
  if (!stored) return json({ ok: false, error: "invalid_token" }, 400, origin);

  let incoming: Record<string, unknown> = { all_good: body.all_good === true };
  if (incoming.all_good !== true) {
    const signup = validateSignup(body);
    if (!signup.ok) return json({ ok: false, error: signup.error }, 400, origin);
    incoming = signup.row;
  }
  const now = new Date().toISOString();
  const plan = planSubscriberUpdate({
    stored,
    incoming,
    emailMatched: verified.emailMatched === true && nonceRow.email_matched === true,
    now
  });
  const { data: claimed, error: claimError } = await supabase.from("business_alert_update_nonces")
    .update({ used_at: now })
    .eq("nonce", verified.nonce)
    .is("used_at", null)
    .select("nonce");
  if (claimError) throw claimError;
  if (!claimed?.length) return json({ ok: false, error: "invalid_token" }, 400, origin);

  if (Object.keys(plan.changes).length) {
    const { error } = await supabase.from(TABLE).update(plan.changes).eq("id", stored.id);
    if (error) {
      await supabase.from("business_alert_update_nonces").update({ used_at: null }).eq("nonce", verified.nonce);
      throw error;
    }
  }
  if (plan.lead?.id) {
    const leadPatch: Record<string, unknown> = {};
    if (plan.lead.requested_area !== undefined) leadPatch.requested_area = plan.lead.requested_area;
    if (Object.hasOwn(plan.lead, "budget")) leadPatch.budget = plan.lead.budget;
    if (plan.lead.append_notes) {
      const { data: leadRow } = await supabase.from("leads").select("notes").eq("id", plan.lead.id).maybeSingle();
      leadPatch.notes = appendLeadNotes(leadRow?.notes, plan.lead.append_notes);
    }
    if (Object.keys(leadPatch).length) {
      const { error } = await supabase.from("leads").update(leadPatch).eq("id", plan.lead.id);
      if (error) console.error("lead update was not stored", error.message);
    }
  }
  const closed = ["unsubscribed", "unsubscribed_all", "unsubscribed_email", "unsubscribed_whatsapp"].includes(stored.status);
  const { error: historyError } = await supabase.from("business_alert_subscriber_history").insert({
    subscriber_id: stored.id,
    action: plan.changes.status === "active" && closed ? "reactivate" : plan.action,
    actor: "self_update",
    previous: plan.history.previous,
    next: plan.history.next
  });
  if (historyError) console.error("subscriber history was not stored", historyError.message);
  return json({ ok: true, status: "updated" }, 200, origin);
}

async function unsubscribe(token: string, origin: string | null, ip: string) {
  const attempts = await countAttempts("unsubscribe", "ip", ip, RATE_LIMITS.unsubscribePerIp.windowMs);
  if (attempts >= RATE_LIMITS.unsubscribePerIp.limit) return json({ ok: false, error: "rate_limited" }, 429, origin);
  await recordAttempt("unsubscribe", "", ip);
  const { data, error } = await supabase.rpc("business_alert_unsubscribe_by_token", {
    p_token: token,
    p_channel: "all"
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.found) return json({ ok: false, error: "not_found" }, 404, origin);
  if (row.already) return json({ ok: true, already: true }, 200, origin);
  return json({ ok: true }, 200, origin);
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ ok: false, error: "origin_not_allowed" }, 403, origin);
  if (Number(req.headers.get("content-length") || 0) > 20000) return json({ ok: false, error: "payload_too_large" }, 413, origin);

  try {
    const raw = await req.text();
    if (raw.length > 20000) return json({ ok: false, error: "payload_too_large" }, 413, origin);
    const body = JSON.parse(raw);
    const ip = clientIp(req);
    if (body?.action === "unsubscribe") {
      const token = cleanText(body.token, 200);
      if (!isUnsubscribeToken(token)) return json({ ok: false, error: "invalid_token" }, 400, origin);
      return await unsubscribe(token, origin, ip);
    }

    if (cleanText(body?.website, 200)) return json({ ok: true }, 200, origin);
    if (body?.mode === "update") return await applyProfileUpdate(body, origin, ip);

    const signup = validateSignup(body);
    const emailForLimit = cleanText(body?.email, 180).toLowerCase();
    const ipAttempts = await countAttempts("signup", "ip", ip, RATE_LIMITS.signupPerIp.windowMs);
    const emailAttempts = emailForLimit.includes("@")
      ? await countAttempts("signup", "email", emailForLimit, RATE_LIMITS.signupPerEmail.windowMs)
      : 0;
    if (ipAttempts >= RATE_LIMITS.signupPerIp.limit || emailAttempts >= RATE_LIMITS.signupPerEmail.limit) {
      return json({ ok: false, error: "rate_limited" }, 429, origin);
    }
    await recordAttempt("signup", emailForLimit, ip);
    if (!signup.ok) return json({ ok: false, error: signup.error }, 400, origin);

    const secret = updateTokenSecret();
    const phoneRow = signup.row.phone9 ? await findByPhone9(String(signup.row.phone9)) : null;
    const emailRow = await findByEmail(String(signup.row.email));
    const existing = phoneRow || emailRow;
    if (existing?.id) {
      if (!secret) return json({ ok: false, error: "token_unavailable" }, 500, origin);
      const nonce = newUpdateNonce();
      const plan = alreadyRegisteredPlan(existing, signup.row.email, { nonce, nowMs: Date.now(), secret });
      const { error } = await supabase.from("business_alert_update_nonces").insert({
        nonce,
        subscriber_id: existing.id,
        email_matched: plan.emailMatched,
        expires_at: plan.expiresAt
      });
      if (error) throw error;
      return json({
        ok: true,
        status: plan.status,
        update_token: plan.update_token,
        ...(plan.prefill ? { prefill: plan.prefill } : {})
      }, 200, origin);
    }

    const saved = await writeSubscriber(signup.row, ip, cleanText(req.headers.get("user-agent"), 300));
    const pageLink = saved.identityKept ? "" : unsubscribeUrl(saved.unsubscribe_token, "all");
    const oneClick = unsubscribeHttpsUrl(supabaseUrl, saved.unsubscribe_token, "all");
    const thankYou = await sendEmail(
      signup.row.email,
      thankYouSubject(signup.row.address_form),
      thankYouEmailHtml({ firstName: signup.row.first_name, unsubscribeLink: pageLink, addressForm: signup.row.address_form }),
      thankYouEmailText({ firstName: signup.row.first_name, unsubscribeLink: pageLink, addressForm: signup.row.address_form }),
      listUnsubscribeHeaders(oneClick)
    );
    const alert = internalAlertEmail({
      ...signup.row,
      signupKind: saved.signupKind,
      previousStatus: saved.previousStatus,
      consent_at: saved.consentAt,
      identityKept: saved.identityKept === true
    });
    const internal = await sendEmail(INTERNAL_TO, alert.subject, alert.html, alert.text, undefined, alert.from);
    if (!internal.sent) console.error("Internal alert email was not sent", internal.error || "");

    return json({ ok: true, emailSent: thankYou.sent, emailError: thankYou.error ?? null }, 200, origin);
  } catch (error) {
    console.error("business-alert-signup failed", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "save_failed" }, 500, origin);
  }
});
