// Signup rules for business-alert-signup.
// A request that does not send the new consent fields keeps the live form's
// checks and is stored as legacy_no_consent. A request that sends them must
// pass consent_general and at least one channel.

export const CONSENT_TEXT_VERSION = "alerts-consent-2026-11-12";
export const CONSENT_EMAIL_TEXT = "אני מאשר/ת לקבל מ-BSD עדכונים על עסקים למכירה באימייל";
export const CONSENT_WHATSAPP_TEXT = "אני מאשר/ת לקבל מ-BSD עדכונים על עסקים למכירה גם בוואטסאפ";
export const CONSENT_GENERAL_TEXT = "אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה";
export const SOURCE = "website-catalog";
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
  unsubscribePerIp: { limit: 30, windowMs: 15 * 60 * 1000 }
};

import { formInterestFromPhrase, formRegionFromText, parseAlertBudget } from "../_shared/alert-match.mjs";
import { categorySlugs, regionSlugs, subcategorySlugs } from "../_shared/taxonomy.mjs";

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
  return raw === "our_link" ? "our_link" : "website";
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function slugList(value, allowed, error) {
  if (value == null || value === "") return { ok: true, slugs: [] };
  if (!Array.isArray(value)) return { ok: false, error };
  const slugs = [];
  const known = new Set(allowed);
  for (const item of value) {
    const slug = cleanText(item, 60);
    if (!slug) continue;
    if (!known.has(slug)) return { ok: false, error };
    if (!slugs.includes(slug)) slugs.push(slug);
  }
  return { ok: true, slugs };
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
  const categories = slugList(body?.categories, categorySlugs(), "invalid_category");
  if (!categories.ok) return categories;
  const subcategories = slugList(body?.subcategories, subcategorySlugs(), "invalid_subcategory");
  if (!subcategories.ok) return subcategories;
  const regions = slugList(body?.regions, regionSlugs(), "invalid_region");
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
      regions: regions.slugs,
      budget_min: budget.budget_min,
      budget_max: budget.budget_max,
      budget_open: budget.budget_open,
      region: region.region,
      source: SOURCE,
      signup_channel: signupChannelOf(body),
      source_url: normalizeSourceUrl(body?.source_url).ok ? normalizeSourceUrl(body?.source_url).source_url : null,
      looking_for: lookingOf(body, [interests.extra, region.extra].filter(Boolean).join("\n")),
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
  const consentVersion = cleanText(body?.consent_version, 80);
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
      consent_text_version: consentVersion,
      consent_general: true,
      consent_text: consentText,
      consent_version: consentVersion,
      source_url: source.source_url,
      legacy_no_consent: false
    }
  };
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
