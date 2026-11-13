// Business-alert signup for www.bsd-bbi.co.il.
// Deploy as business-alert-signup on zcdlegcvfirwzitfxjcs with verify_jwt
// enabled, after 20261113120000_business_alert_compliance.sql.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
// Every email this function sends uses the subscriber From constant.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  RATE_LIMITS,
  cleanText,
  isUnsubscribeToken,
  consentWritePayload,
  planSubscriberWrite,
  validateSignup
} from "./logic.mjs";
import {
  INTERNAL_TO,
  MAIL_FROM,
  MAIL_REPLY_TO,
  internalAlertEmailHtml,
  internalAlertSubject,
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
const LOOKUP = "id, first_name, last_name, email, phone, phone9, unsubscribe_token, status, unsubscribed_at, unsubscribed_by, unsubscribe_reason, email_unsubscribed_at, whatsapp_unsubscribed_at, status_history, resubscribed_at";

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

async function sendEmail(to: string, subject: string, html: string, text?: string, headers?: Record<string, string>) {
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
        from: MAIL_FROM,
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

async function recordAttempt(kind: string, email: string, ip: string) {
  const { error } = await supabase.from(ATTEMPTS).insert({ kind, email: email || null, ip: ip || null });
  if (error) console.error("Alert attempt log failed", error.message);
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
    const internal = await sendEmail(
      INTERNAL_TO,
      internalAlertSubject({
        firstName: signup.row.first_name,
        lastName: signup.row.last_name,
        signupKind: saved.signupKind
      }),
      internalAlertEmailHtml({
        ...signup.row,
        signupKind: saved.signupKind,
        previousStatus: saved.previousStatus,
        consent_at: saved.consentAt,
        identityKept: saved.identityKept === true
      })
    );
    if (!internal.sent) console.error("Internal alert email was not sent", internal.error || "");

    return json({ ok: true, emailSent: thankYou.sent, emailError: thankYou.error ?? null }, 200, origin);
  } catch (error) {
    console.error("business-alert-signup failed", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "save_failed" }, 500, origin);
  }
});
