// Signup rules for business-alert-signup.
// A request that does not send the new consent fields keeps the live form's
// checks and is stored as legacy_no_consent. A request that sends them must
// pass consent_general and at least one channel.

export const CONSENT_TEXT_VERSION = "alerts-consent-2026-11-12";
export const CONSENT_EMAIL_TEXT = "אני מאשר/ת לקבל מ-BSD עדכונים על עסקים למכירה באימייל";
export const CONSENT_WHATSAPP_TEXT = "אני מאשר/ת לקבל מ-BSD עדכונים על עסקים למכירה גם בוואטסאפ";
export const CONSENT_GENERAL_TEXT = "אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה";
export const NEW_CONSENT_KEYS = ["consent_general", "consent_text", "consent_version", "source_url"];

export const INTERESTS = [
  "מזון",
  "תעשייה",
  "שירותים",
  "קמעונאות",
  "בריאות ואסתטיקה",
  "הסעות ותיירות",
  "טכנולוגיה ואונליין",
  "פנאי וילדים",
  "אחר",
  "כל התחומים"
];

export const REGIONS = [
  "צפון",
  "חיפה והקריות",
  "שרון",
  "מרכז",
  "תל אביב וגוש דן",
  "שפלה",
  "ירושלים",
  "דרום",
  "כל הארץ"
];

export const BUDGET_OPTIONS = [
  { value: "up-to-250", label: "עד 250 אלף", min: 0, max: 250000, open: false },
  { value: "250-500", label: "250–500 אלף", min: 250000, max: 500000, open: false },
  { value: "500-1000", label: "500 אלף–1 מיליון", min: 500000, max: 1000000, open: false },
  { value: "1000-3000", label: "1–3 מיליון", min: 1000000, max: 3000000, open: false },
  { value: "over-3000", label: "מעל 3 מיליון", min: 3000000, max: null, open: false },
  { value: "open", label: "פתוח להצעות", min: null, max: null, open: true }
];

export const RATE_LIMITS = {
  signupPerIp: { limit: 8, windowMs: 15 * 60 * 1000 },
  signupPerEmail: { limit: 4, windowMs: 60 * 60 * 1000 },
  unsubscribePerIp: { limit: 30, windowMs: 15 * 60 * 1000 },
  updatePerIp: { limit: 10, windowMs: 15 * 60 * 1000 },
  updatePerSubscriber: { limit: 6, windowMs: 15 * 60 * 1000 }
};

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { formInterestFromPhrase, formRegionFromText, parseAlertBudget } from "../_shared/alert-match.mjs";
import { categorySlugs, flagSlugs, regionSlugs, subcategorySlugs } from "../_shared/taxonomy.mjs";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

export function cleanText(value, max = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .trim()
    .slice(0, max);
}

export function cleanMultiline(value, max = 2000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function phone9FromRaw(value) {
  const digits = digitsOnly(value);
  if (digits.length < 9) return "";
  return digits.slice(-9);
}

export function isIsraeliPhone(value) {
  const trimmed = cleanText(value, 40);
  if (!trimmed || !/^[0-9+\-\s()]+$/.test(trimmed)) return false;
  let national = digitsOnly(trimmed);
  if (national.startsWith("00972")) national = `0${national.slice(5)}`;
  else if (national.startsWith("972")) national = `0${national.slice(3)}`;
  if (!/^05\d{8}$/.test(national) && !/^0[23489]\d{7}$/.test(national) && !/^07\d{8}$/.test(national)) {
    return false;
  }
  return phone9FromRaw(trimmed).length === 9;
}

export function usesNewConsentContract(body) {
  return !!body && NEW_CONSENT_KEYS.some(key => Object.prototype.hasOwnProperty.call(body, key));
}

export function isUnsubscribeToken(value) {
  const token = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)
    || /^[A-Za-z0-9_-]{43,128}$/.test(token);
}

function budgetFromKey(value) {
  const key = cleanText(value, 80);
  if (!key) return { budget_min: null, budget_max: null, budget_open: false };
  const option = BUDGET_OPTIONS.find(item => item.value === key);
  if (option) return { budget_min: option.min, budget_max: option.max, budget_open: option.open };
  const parsed = parseAlertBudget(key);
  if (!parsed) return null;
  return { budget_min: parsed.lo, budget_max: parsed.hi, budget_open: false };
}

function normalizeInterests(value) {
  if (value == null || value === "") return { interests: [], extra: "" };
  if (!Array.isArray(value)) return null;
  const seen = [];
  const extra = [];
  for (const item of value) {
    const label = cleanText(item, 40);
    if (!label) continue;
    if (INTERESTS.includes(label)) {
      if (!seen.includes(label)) seen.push(label);
      continue;
    }
    const mapped = formInterestFromPhrase(label);
    if (!mapped) return null;
    if (!seen.includes(mapped)) seen.push(mapped);
    extra.push(label);
  }
  return { interests: seen, extra: extra.join(", ") };
}

function normalizeRegion(value) {
  const region = cleanText(value, 80);
  if (!region) return { ok: true, region: null, extra: "" };
  if (REGIONS.includes(region)) return { ok: true, region, extra: "" };
  const mapped = formRegionFromText(region);
  if (mapped) return { ok: true, region: mapped, extra: region === mapped ? "" : region };
  return { ok: true, region: null, extra: region };
}

function signupChannelOf(body) {
  const raw = cleanText(body?.signup_channel, 40).toLowerCase();
  const src = cleanText(body?.src, 40).toLowerCase();
  if (raw === "vip" || src === "vip") return "vip";
  return raw === "our_link" ? "our_link" : "website";
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function slugList(value, allowed, field) {
  if (value == null || value === "") return { ok: true, slugs: [] };
  if (!Array.isArray(value)) return { ok: false, error: `invalid_${field}` };
  const slugs = [];
  const known = new Set(allowed);
  for (const item of value) {
    const slug = cleanText(item, 60);
    if (!slug) continue;
    if (!known.has(slug)) {
      console.warn(`business-alert signup: unknown ${field} slug kept: ${slug}`);
    }
    if (!slugs.includes(slug)) slugs.push(slug);
  }
  return { ok: true, slugs };
}

function regionsOf(body) {
  const parsed = slugList(body?.regions, regionSlugs(), "region");
  if (!parsed.ok) return parsed;
  if (parsed.slugs.includes("all")) return { ok: true, slugs: ["all"] };
  return parsed;
}

function addressFormOf(body) {
  const value = cleanText(body?.address_form, 20).toLowerCase();
  if (value === "m" || value === "male") return "male";
  if (value === "f" || value === "female") return "female";
  return null;
}

function lookingOf(body, extra) {
  const text = cleanMultiline([body?.looking_for, extra].filter(Boolean).join("\n"), 2000);
  return text || null;
}

function normalizeUtm(body) {
  const utm = {};
  for (const key of UTM_KEYS) {
    const value = cleanText(body?.[key], 120);
    utm[key] = value || null;
  }
  return utm;
}

function sharedFields(body) {
  const firstName = cleanText(body?.first_name, 80);
  const lastName = cleanText(body?.last_name, 80);
  const phone = cleanText(body?.phone, 40);
  const email = cleanText(body?.email, 180).toLowerCase();
  if (!firstName || !lastName || !phone || !email) return { ok: false, error: "missing_required_fields" };
  if (!isIsraeliPhone(phone)) return { ok: false, error: "invalid_phone" };
  if (!/^[^\s@%]+@[^\s@%]+\.[^\s@%]+$/.test(email)) return { ok: false, error: "invalid_email" };
  const interests = normalizeInterests(body?.interests);
  if (!interests) return { ok: false, error: "invalid_interests" };
  const region = normalizeRegion(body?.region);
  const categories = slugList(body?.categories, categorySlugs(), "category");
  if (!categories.ok) return categories;
  const subcategories = slugList(body?.subcategories, subcategorySlugs(), "subcategory");
  if (!subcategories.ok) return subcategories;
  const flags = slugList(body?.flags, flagSlugs(), "flag");
  if (!flags.ok) return flags;
  const regions = regionsOf(body);
  if (!regions.ok) return regions;
  let budget = budgetFromKey(body?.budget);
  if (body?.budget_open === true) budget = { budget_min: null, budget_max: null, budget_open: true };
  else if (body?.budget_min != null || body?.budget_max != null) {
    const budgetMin = numberOrNull(body.budget_min);
    const budgetMax = numberOrNull(body.budget_max);
    if (body.budget_min != null && budgetMin == null) return { ok: false, error: "invalid_budget" };
    if (body.budget_max != null && budgetMax == null) return { ok: false, error: "invalid_budget" };
    budget = { budget_min: budgetMin, budget_max: budgetMax, budget_open: false };
  }
  if (!budget) return { ok: false, error: "invalid_budget" };
  return {
    ok: true,
    base: {
      first_name: firstName,
      last_name: lastName,
      phone,
      phone9: phone9FromRaw(phone),
      email,
      interests: interests.interests,
      categories: categories.slugs,
      subcategories: subcategories.slugs,
      flags: flags.slugs,
      regions: regions.slugs,
      budget_min: budget.budget_min,
      budget_max: budget.budget_max,
      budget_open: budget.budget_open,
      region: region.region,
      taxonomy_version: cleanText(body?.taxonomy_version, 40) || null,
      signup_channel: signupChannelOf(body),
      source_url: normalizeSourceUrl(body?.source_url).ok ? normalizeSourceUrl(body?.source_url).source_url : null,
      looking_for: lookingOf(body, [interests.extra, region.extra].filter(Boolean).join("\n")),
      address_form: addressFormOf(body),
      ...normalizeUtm(body)
    }
  };
}

function normalizeSourceUrl(value) {
  if (value == null || value === "") return { ok: true, source_url: null };
  if (typeof value !== "string") return { ok: false };
  const url = cleanText(value, 300);
  if (!url || /^(javascript|data):/i.test(url)) return { ok: false };
  return { ok: true, source_url: url };
}

export function validateSignup(body) {
  const shared = sharedFields(body);
  if (!shared.ok) return shared;

  if (!usesNewConsentContract(body)) {
    if (body?.consent_email !== true) return { ok: false, error: "consent_required" };
    if (cleanText(body?.consent_text_version, 80) !== CONSENT_TEXT_VERSION) {
      return { ok: false, error: "consent_version" };
    }
    return {
      ok: true,
      contract: "legacy",
      row: {
        ...shared.base,
        consent_email: true,
        consent_whatsapp: body?.consent_whatsapp === true,
        consent_text_version: CONSENT_TEXT_VERSION,
        consent_general: null,
        consent_text: null,
        consent_version: null,
        legacy_no_consent: true
      }
    };
  }

  if (body?.consent_general !== true) return { ok: false, error: "consent_required" };
  const consentEmail = body?.consent_email === true;
  const consentWhatsapp = body?.consent_whatsapp === true;
  if (!consentEmail && !consentWhatsapp) return { ok: false, error: "no_channel" };
  const consentText = cleanMultiline(body?.consent_text, 2000);
  if (!consentText) return { ok: false, error: "consent_required" };
  const namedVersion = cleanText(body?.consent_version, 80);
  const textVersion = cleanText(body?.consent_text_version, 80);
  const consentVersion = namedVersion || textVersion;
  if (!/^[\w.:-]{1,80}$/.test(consentVersion)) return { ok: false, error: "consent_version" };
  const source = normalizeSourceUrl(body?.source_url);
  if (!source.ok) return { ok: false, error: "invalid_source_url" };

  return {
    ok: true,
    contract: "current",
    row: {
      ...shared.base,
      consent_email: consentEmail,
      consent_whatsapp: consentWhatsapp,
      consent_text_version: textVersion || consentVersion,
      consent_general: true,
      consent_text: consentText,
      consent_version: namedVersion || consentVersion,
      source_url: source.source_url,
      legacy_no_consent: false
    }
  };
}

const CLOSED_STATUSES = ["unsubscribed", "unsubscribed_all", "unsubscribed_email", "unsubscribed_whatsapp"];
const CONSENT_KEYS = [
  "consent_general", "consent_text", "consent_version", "consent_text_version",
  "legacy_no_consent", "consent_email", "consent_whatsapp", "consent_at"
];

export function hasFreshConsent(row) {
  return row?.consent_general === true && (row?.consent_email === true || row?.consent_whatsapp === true);
}

const IDENTITY_FIELDS = ["first_name", "last_name", "email", "phone", "phone9"];

function sameIdentityValue(key, before, incoming) {
  const left = before == null ? "" : String(before).trim();
  const right = incoming == null ? "" : String(incoming).trim();
  if (!right) return true;
  if (key === "email") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

// A later signup on the same phone or email must not replace the stored person.
// The caller writes the incoming values to the audit table and leaves the row.
export function identityAudit(previous, row) {
  if (!previous) return null;
  const previousValues = {};
  const incomingValues = {};
  for (const key of IDENTITY_FIELDS) {
    if (!Object.hasOwn(previous, key)) continue;
    const before = previous[key] == null ? "" : String(previous[key]).trim();
    if (!before) continue;
    if (sameIdentityValue(key, previous[key], row?.[key])) continue;
    previousValues[key] = previous[key] ?? null;
    incomingValues[key] = row?.[key] ?? null;
  }
  if (!Object.keys(incomingValues).length) return null;
  return { previous: previousValues, incoming: incomingValues };
}

// A repeat signup must not clear an unsubscribe by itself. The row becomes
// reachable again only when this request has consent_general and a channel.
// The previous status is appended. Nothing is removed from status_history.
export function consentWritePayload(row, previous, now) {
  const prevStatus = previous?.status || null;
  const closed = CLOSED_STATUSES.includes(prevStatus);
  const fresh = hasFreshConsent(row);
  const history = Array.isArray(previous?.status_history) ? previous.status_history.slice() : [];
  const audit = identityAudit(previous, row);
  if (audit) {
    return {
      identity_kept: true,
      identity_audit: audit,
      status: prevStatus
    };
  }
  const payload = { ...row };

  if (!previous) {
    return {
      ...payload,
      status: "active",
      unsubscribed_at: null,
      unsubscribed_by: null,
      unsubscribe_reason: null,
      email_unsubscribed_at: null,
      whatsapp_unsubscribed_at: null,
      consent_at: now,
      status_history: history
    };
  }

  if (closed && !fresh) {
    for (const key of CONSENT_KEYS) delete payload[key];
    delete payload.resubscribed_at;
    return {
      ...payload,
      status: prevStatus,
      unsubscribed_at: previous.unsubscribed_at,
      unsubscribed_by: previous.unsubscribed_by,
      unsubscribe_reason: previous.unsubscribe_reason ?? null,
      email_unsubscribed_at: previous.email_unsubscribed_at,
      whatsapp_unsubscribed_at: previous.whatsapp_unsubscribed_at,
      status_history: history
    };
  }

  const emailOff = row.consent_email !== true && !!previous.email_unsubscribed_at;
  const whatsappOff = row.consent_whatsapp !== true && !!previous.whatsapp_unsubscribed_at;
  let status = "active";
  if (emailOff && whatsappOff) status = "unsubscribed_all";
  else if (emailOff) status = "unsubscribed_email";
  else if (whatsappOff) status = "unsubscribed_whatsapp";
  const reopened = closed && status !== prevStatus;
  if (reopened) {
    history.push({
      status: prevStatus,
      at: now,
      unsubscribed_at: previous.unsubscribed_at || null
    });
  }
  return {
    ...payload,
    status,
    unsubscribed_at: status === "active" ? null : (previous.unsubscribed_at || now),
    unsubscribed_by: status === "active" ? null : (previous.unsubscribed_by || "self_link"),
    unsubscribe_reason: status === "active" ? null : (previous.unsubscribe_reason ?? null),
    email_unsubscribed_at: emailOff ? previous.email_unsubscribed_at : null,
    whatsapp_unsubscribed_at: whatsappOff ? previous.whatsapp_unsubscribed_at : null,
    consent_at: now,
    ...(reopened ? { resubscribed_at: now } : {}),
    status_history: history
  };
}

export const UPDATE_TOKEN_TTL_MS = 30 * 60 * 1000;
const PREFILL_KEYS = [
  "categories", "subcategories", "flags", "budget_min", "budget_max", "budget_open",
  "regions", "looking_for", "consent_email", "consent_whatsapp", "address_form"
];
const PROFILE_KEYS = [
  ...PREFILL_KEYS, "interests", "region"
];
const IDENTITY_KEYS = ["first_name", "last_name", "email", "phone", "phone9"];

export function emailsMatch(stored, submitted) {
  const left = String(stored ?? "").trim().toLowerCase();
  const right = String(submitted ?? "").trim().toLowerCase();
  return Boolean(left && right && left === right);
}

export function newUpdateNonce() {
  return randomBytes(32).toString("base64url");
}

export function signUpdateToken({ subscriberId, nonce, emailMatched, expiresAt, secret }) {
  const payload = Buffer.from(JSON.stringify({
    sub: subscriberId,
    nonce,
    exp: expiresAt,
    email_match: emailMatched === true
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyUpdateToken(token, secret, nowMs) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || String(token).split(".").length !== 2) return { ok: false, error: "invalid_token" };
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false, error: "invalid_token" };
  let body;
  try { body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { return { ok: false, error: "invalid_token" }; }
  if (!body?.sub || !body?.nonce || typeof body.exp !== "number") return { ok: false, error: "invalid_token" };
  if (body.exp <= nowMs) return { ok: false, error: "expired" };
  return { ok: true, subscriberId: body.sub, nonce: body.nonce, emailMatched: body.email_match === true, expiresAt: body.exp };
}

export function signupPrefill(stored, submittedEmail) {
  if (!emailsMatch(stored?.email, submittedEmail)) return null;
  const prefill = {};
  for (const key of PREFILL_KEYS) prefill[key] = stored?.[key] ?? null;
  return prefill;
}

export function alreadyRegisteredPlan(stored, submittedEmail, { nonce, nowMs, secret }) {
  const emailMatched = emailsMatch(stored?.email, submittedEmail);
  const expiresAt = nowMs + UPDATE_TOKEN_TTL_MS;
  const plan = {
    status: "already_registered",
    update_token: signUpdateToken({
      subscriberId: stored.id,
      nonce,
      emailMatched,
      expiresAt,
      secret
    }),
    nonce,
    expiresAt: new Date(expiresAt).toISOString(),
    emailMatched
  };
  const prefill = signupPrefill(stored, submittedEmail);
  if (prefill) plan.prefill = prefill;
  return plan;
}

function definedProfile(body) {
  const next = {};
  for (const key of PROFILE_KEYS) {
    if (Object.hasOwn(body || {}, key)) next[key] = body[key];
  }
  return next;
}

export function planSubscriberUpdate({ stored, incoming, emailMatched, now }) {
  if (incoming?.all_good === true) {
    return { action: "confirm", changes: {}, lead: null, history: { previous: {}, next: { all_good: true } } };
  }
  const changes = definedProfile(incoming);
  if (emailMatched) {
    for (const key of IDENTITY_KEYS) {
      if (incoming?.[key]) changes[key] = incoming[key];
    }
  }
  const closed = CLOSED_STATUSES.includes(stored?.status);
  const fresh = hasFreshConsent(incoming);
  if (closed && fresh) {
    changes.status = "active";
    changes.resubscribed_at = now;
    changes.unsubscribed_at = null;
    changes.unsubscribed_by = null;
    changes.unsubscribe_reason = null;
    changes.email_unsubscribed_at = incoming.consent_email === true ? null : stored.email_unsubscribed_at;
    changes.whatsapp_unsubscribed_at = incoming.consent_whatsapp === true ? null : stored.whatsapp_unsubscribed_at;
    changes.consent_general = true;
    changes.consent_at = now;
    changes.consent_method = "self_update";
  } else if (closed) {
    delete changes.status;
  }
  if (Object.hasOwn(changes, "consent_email") || Object.hasOwn(changes, "consent_whatsapp") || fresh) {
    changes.consent_method = "self_update";
    if (changes.consent_email === true) changes.consent_email_method = "self_update";
    if (changes.consent_whatsapp === true) changes.consent_whatsapp_method = "self_update";
  }
  const previous = {};
  const next = {};
  for (const key of Object.keys(changes)) {
    previous[key] = stored?.[key] ?? null;
    next[key] = changes[key];
  }
  const lead = stored?.crm_lead_id && (Object.hasOwn(changes, "region") || Object.hasOwn(changes, "regions") || Object.hasOwn(changes, "budget_max"))
    ? {
      id: stored.crm_lead_id,
      ...(Object.hasOwn(changes, "region") || Object.hasOwn(changes, "regions")
        ? { requested_area: changes.region || (Array.isArray(changes.regions) ? changes.regions.join(", ") : null) }
        : {}),
      ...(Object.hasOwn(changes, "budget_max") ? { budget: changes.budget_max } : {})
    }
    : null;
  return { action: Object.keys(changes).length ? "update" : "confirm", changes, lead, history: { previous, next } };
}

export function planSubscriberWrite({ emailRow, phoneRow }) {
  const emailId = emailRow?.id || null;
  const phoneId = phoneRow?.id || null;
  const detachPhoneId = emailId && phoneId && emailId !== phoneId ? phoneId : null;
  const targetId = emailId || phoneId || null;
  return {
    action: targetId ? "update" : "insert",
    targetId,
    detachPhoneId,
    keepToken: Boolean(targetId)
  };
}
