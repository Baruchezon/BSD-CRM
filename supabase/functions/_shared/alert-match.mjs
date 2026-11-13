// Alert matching on top of the smart-match engine.
// Sector families, exclusions («לא מזון»), league (מאפייה / מסעדה / בית קפה)
// and neighbouring regions come from match-suggestions-report/engine.js.
// The alert score itself is sector, then budget, then location.
// A price outside the configurable band is not sent. Open budget is not a fail.

import { profileBusiness, profileBuyer, scorePair } from "../match-suggestions-report/engine.js";
import { businessTaxonomy, locationRelation, sectorRelation, subscriberTaxonomy } from "./taxonomy.mjs";
import copy from "../../../copy/he.json" with { type: "json" };
import {
  SUBSCRIBER_FROM_NAME,
  SUBSCRIBER_SITE,
  signOffText,
  subscriberFromHeader,
  subscriberSubject,
  escapeHtml,
  signOffHtml
} from "./business-alert-mail.mjs";

export const DEFAULT_MATCH_CONFIG = {
  budgetLow: 0.7,
  budgetHigh: 1.3,
  minScore: 60,
  sectorWeight: 50,
  budgetWeight: 30,
  locationWeight: 20,
  sendingEnabled: false
};

const SECTOR_ENGINE_MAX = 58;
const LOCATION_ENGINE_MAX = 10;

const FORM_REGION = {
  north: "צפון",
  haifa: "חיפה והקריות",
  sharon: "שרון",
  center: "מרכז",
  shfela: "שפלה",
  jerusalem: "ירושלים",
  south: "דרום"
};

const INTEREST_BY_GROUP = {
  food: "מזון",
  retail_food: "מזון",
  industry: "תעשייה",
  services: "שירותים",
  retail: "קמעונאות",
  trade: "קמעונאות",
  health: "בריאות ואסתטיקה",
  transport: "הסעות ותיירות",
  hospitality: "הסעות ותיירות",
  tech: "טכנולוגיה ואונליין",
  leisure: "פנאי וילדים",
  build: "תעשייה"
};

export function normalizeMatchConfig(raw = {}) {
  const low = Number(raw.budgetLow ?? raw.budget_low_ratio ?? DEFAULT_MATCH_CONFIG.budgetLow);
  const high = Number(raw.budgetHigh ?? raw.budget_high_ratio ?? DEFAULT_MATCH_CONFIG.budgetHigh);
  return {
    budgetLow: low > 0 && low <= 1 ? low : DEFAULT_MATCH_CONFIG.budgetLow,
    budgetHigh: high >= 1 && high <= 3 ? high : DEFAULT_MATCH_CONFIG.budgetHigh,
    minScore: clampInt(raw.minScore ?? raw.min_score, 1, 100, DEFAULT_MATCH_CONFIG.minScore),
    sectorWeight: clampInt(raw.sectorWeight ?? raw.sector_weight, 1, 80, DEFAULT_MATCH_CONFIG.sectorWeight),
    budgetWeight: clampInt(raw.budgetWeight ?? raw.budget_weight, 1, 80, DEFAULT_MATCH_CONFIG.budgetWeight),
    locationWeight: clampInt(raw.locationWeight ?? raw.location_weight, 1, 80, DEFAULT_MATCH_CONFIG.locationWeight),
    sendingEnabled: raw.sendingEnabled === true || raw.sending_enabled === true
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// «מיליון», «1.5 מ׳», «עד 800 אלף», «500-700 אלף».
export function parseAlertBudget(text) {
  let raw = String(text || "")
    .replace(/מ׳|מ״|מ"|מ'/g, " מיליון ")
    .replace(/(^|[^\u05d0-\u05ea])מ(?![א-ת])/g, "$1 מיליון ");
  if (!/\d/.test(raw) && /מיליון|מליון/.test(raw)) raw = raw.replace(/מיליון|מליון/, "1 מיליון");
  const until = raw.match(/עד\s*(\d+(?:[.,]\d+)?)\s*(מיליון|מליון|אלף|אלפים)?/);
  if (until) {
    const mult = /מיליון|מליון/.test(until[2] || "") ? 1e6 : /אלף|אלפים/.test(until[2] || "") ? 1e3 : 1;
    const hi = parseFloat(until[1].replace(",", ".")) * mult;
    if (hi >= 50000 && hi <= 200e6) return { lo: hi, hi, raw: until[0].trim() };
  }
  const profile = profileBuyer({ notes: `תקציב ${raw}` });
  if (profile.budget) return { lo: profile.budget.lo, hi: profile.budget.hi, raw: profile.budget.quote || raw.trim() };
  return null;
}

export function formRegionFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (/כל הארץ/.test(raw)) return "כל הארץ";
  if (/תל אביב|גוש דן/.test(raw)) return "תל אביב וגוש דן";
  const profile = profileBuyer({ requested_area: raw, notes: raw });
  if (profile.nationwide) return "כל הארץ";
  const id = profile.area?.region || profile.areas?.[0]?.region;
  if (id === "center" && /תל אביב|גוש דן/.test(raw)) return "תל אביב וגוש דן";
  return FORM_REGION[id] || null;
}

export function formInterestFromPhrase(phrase) {
  const profile = profileBuyer({ requested_field: phrase, notes: "" });
  const id = [...profile.wanted.keys()][0];
  if (!id) return null;
  const group = profile.wanted.get(id) && sectorGroup(id);
  return group ? INTEREST_BY_GROUP[group] || null : null;
}

function sectorGroup(id) {
  const known = {
    food_general: "food", restaurant: "food", cafe: "food", bakery: "food", catering: "food", food_prod: "food", pub: "food",
    grocery: "retail_food", produce: "retail_food",
    fashion: "retail", retail: "retail",
    building_supply: "trade", import: "trade",
    ecommerce: "tech", tv_tech: "tech",
    factory: "industry", judaica: "industry",
    transport: "transport",
    maintenance: "services", laundry: "services",
    construction: "build", engineering: "build",
    kids: "leisure", sport: "leisure",
    beauty: "health", medical: "health",
    hotel: "hospitality", events: "hospitality"
  };
  return known[id] || null;
}

export function subscriberToLead(sub) {
  const interests = Array.isArray(sub.interests) ? sub.interests.filter(item => item && item !== "אחר") : [];
  const open = interests.includes("כל התחומים");
  const notes = [sub.looking_for, sub.manager_notes].filter(Boolean).join("\n");
  return {
    id: sub.id,
    full_name: [sub.first_name, sub.last_name].filter(Boolean).join(" "),
    requested_field: open ? "פתוח לכל תחום" : interests.join(" / "),
    requested_area: sub.region || "",
    notes,
    budget: null
  };
}

export function budgetWindow(sub, config = DEFAULT_MATCH_CONFIG) {
  const cfg = normalizeMatchConfig(config);
  if (sub.budget_open === true) return { kind: "open" };
  let lo = num(sub.budget_min);
  let hi = num(sub.budget_max);
  if (lo == null && hi == null) {
    const parsed = parseAlertBudget(sub.looking_for || "");
    if (!parsed) return { kind: "missing" };
    lo = parsed.lo;
    hi = parsed.hi;
  }
  if (lo === 0) lo = null;
  if (hi == null && lo != null) return { kind: "at_least", floor: Math.round(lo * cfg.budgetLow), reference: lo };
  if (lo == null) lo = hi;
  if (hi == null) hi = lo;
  return {
    kind: "range",
    low: Math.round(lo * cfg.budgetLow),
    high: Math.round(hi * cfg.budgetHigh),
    referenceLow: lo,
    referenceHigh: hi
  };
}

function howPoints(pair, label) {
  const row = (pair?.how || []).find(item => item.label === label);
  return row ? Number(row.pts) || 0 : 0;
}

function moneyLabel(n) {
  if (n == null) return "";
  if (n >= 1e6) {
    const m = Math.round(n / 1e5) / 10;
    return `${m} מיליון ₪`;
  }
  if (n >= 1e3) return `${Math.round(n / 1e3)} אלף ₪`;
  return `${Math.round(n)} ₪`;
}

export function publicCard(business) {
  const internal = String(business.internal_name || "").trim();
  let title = String(business.anon_display_name || "").trim();
  if (!title || (internal && title === internal)) title = "הזדמנות עסקית";
  const price = business.anon_card_show_price && num(business.asking_price) ? num(business.asking_price) : null;
  const number = String(business.business_number || "").trim();
  const path = number ? `/עסקים-למכירה/${encodeURIComponent(number)}` : "/עסקים-למכירה/";
  return {
    title,
    field: [business.field, business.category].filter(Boolean).join(" · "),
    region: business.region || "",
    summary: String(business.anon_summary || business.short_description || "").replace(/\s+/g, " ").trim().slice(0, 400),
    price,
    priceText: price ? moneyLabel(price) : "",
    url: `${SUBSCRIBER_SITE}${path}`
  };
}

export function scoreAlert(subscriber, business, config = DEFAULT_MATCH_CONFIG) {
  const cfg = normalizeMatchConfig(config);
  const buyer = profileBuyer(subscriberToLead(subscriber));
  const biz = profileBusiness(business);
  const pair = scorePair(buyer, biz);
  const subTax = subscriberTaxonomy(subscriber);
  const bizTax = businessTaxonomy(business);
  const sectorFit = sectorRelation(subTax, bizTax);
  const placeFit = locationRelation(subTax.regions, bizTax.regions);
  const excluded = pair.rejected === true || sectorFit.kind === "excluded";
  const sectorEngine = !pair || pair.rejected ? 0 : howPoints(pair, "התאמת תחום");
  const locationEngine = !pair || pair.rejected ? 0 : howPoints(pair, "מיקום");
  const sectorFromTaxonomy = sectorFit.kind !== "none" && sectorFit.kind !== "excluded";
  const sectorPoints = excluded ? 0 : sectorFromTaxonomy
    ? Math.round(cfg.sectorWeight * sectorFit.ratio)
    : Math.max(0, Math.round(sectorEngine / SECTOR_ENGINE_MAX * cfg.sectorWeight));
  const locationPoints = subTax.regions.length || bizTax.regions.length
    ? Math.round(cfg.locationWeight * placeFit.ratio)
    : (pair ? Math.max(0, Math.round(Math.min(locationEngine, LOCATION_ENGINE_MAX) / LOCATION_ENGINE_MAX * cfg.locationWeight)) : 0);
  if (!pair && !excluded && !sectorFromTaxonomy) return null;

  const window = budgetWindow(subscriber, cfg);
  const price = num(business.asking_price);
  let budgetPoints = 0;
  let budgetOk = true;
  let budgetText = "";
  if (window.kind === "open") {
    budgetPoints = Math.round(cfg.budgetWeight * 0.6);
    budgetText = "פתוח להצעות — התקציב לא פוסל.";
  } else if (window.kind === "missing" || !price) {
    budgetPoints = Math.round(cfg.budgetWeight * 0.6);
    budgetText = !price ? "לעסק אין מחיר מבוקש — לא נפסל." : "לא צוין תקציב — לא נפסל.";
  } else if (window.kind === "at_least") {
    budgetOk = price >= window.floor;
    budgetPoints = budgetOk ? cfg.budgetWeight : 0;
    budgetText = budgetOk
      ? `המחיר ${moneyLabel(price)} מעל ${moneyLabel(window.floor)}.`
      : `המחיר ${moneyLabel(price)} מתחת ל-${moneyLabel(window.floor)}.`;
  } else if (price >= window.low && price <= window.high) {
    budgetPoints = cfg.budgetWeight;
    budgetText = `המחיר ${moneyLabel(price)} בתוך ${moneyLabel(window.low)}–${moneyLabel(window.high)}.`;
  } else {
    budgetOk = false;
    budgetPoints = 0;
    budgetText = `המחיר ${moneyLabel(price)} מחוץ ל-${moneyLabel(window.low)}–${moneyLabel(window.high)}.`;
  }

  const score = sectorPoints + budgetPoints + locationPoints;
  const legacy = subscriber.legacy_no_consent === true || subscriber.consent_general !== true;
  let block = null;
  if (excluded) block = "sector_excluded";
  else if (!budgetOk) block = "budget_out_of_range";
  else if (score < cfg.minScore) block = "below_threshold";
  else if (legacy) block = "legacy_no_consent";

  const card = publicCard(business);
  const sectorText = excluded
    ? "נפסל: התחום שולל במפורש."
    : `תחום: ${biz.label || "לא צוין"} מול מה שביקש הנרשם.`;
  const locationText = `אזור: ${card.region || biz.city || "לא צוין"}.`;

  return {
    subscriber_id: subscriber.id,
    business_id: business.id,
    score,
    sector_points: sectorPoints,
    budget_points: budgetPoints,
    location_points: locationPoints,
    eligible: !excluded && budgetOk,
    sendable: block == null,
    block_reason: block,
    breakdown: {
      sector: { points: sectorPoints, max: cfg.sectorWeight, text: sectorText },
      budget: { points: budgetPoints, max: cfg.budgetWeight, text: budgetText, kind: window.kind },
      location: { points: locationPoints, max: cfg.locationWeight, text: locationText }
    },
    public_card: card
  };
}

export function sendGate(settings, match) {
  const cfg = normalizeMatchConfig(settings || {});
  if (!cfg.sendingEnabled) return "sending_disabled";
  if (!match?.sendable) return match?.block_reason || "not_sendable";
  if (!match?.public_card?.url) return "no_public_card";
  return null;
}

export function matchAlertEmail({ firstName, card, unsubscribeUrl }) {
  const subject = subscriberSubject(copy.email.subject);
  const headline = copy.email.headline;
  const lines = [
    headline,
    copy.email.warm,
    "",
    card.title || "הזדמנות עסקית",
    card.field || "",
    card.region ? `אזור: ${card.region}` : "",
    card.priceText ? `מחיר: ${card.priceText}` : "",
    card.summary || "",
    "",
    card.url || "",
    "",
    unsubscribeUrl ? `להסרה: ${unsubscribeUrl}` : "",
    "",
    signOffText()
  ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));
  const text = lines.join("\n");
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f7fb"><div dir="rtl" style="max-width:640px;margin:0 auto;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#102844;text-align:right"><div style="background:#0e1b34;color:#f0d48a;padding:18px 24px;font-weight:700">${escapeHtml(SUBSCRIBER_FROM_NAME)}</div><div style="padding:24px;line-height:1.7"><p style="margin:0 0 8px;color:#8a6d1f;font-size:13px">פרסומת</p><p style="margin:0 0 16px;font-size:18px">${escapeHtml(headline)}</p><p style="margin:0 0 16px">${escapeHtml(copy.email.warm)}</p><h2 style="margin:0 0 8px;font-size:22px">${escapeHtml(card.title || "הזדמנות עסקית")}</h2><p style="margin:0">${escapeHtml([card.field, card.region ? `אזור: ${card.region}` : "", card.priceText ? `מחיר: ${card.priceText}` : "", card.summary || ""].filter(Boolean).join("\n")).replace(/\n/g, "<br>")}</p>${card.url ? `<p><a href="${escapeHtml(card.url)}">לעמוד האנונימי</a></p>` : ""}${unsubscribeUrl ? `<p><a href="${escapeHtml(unsubscribeUrl)}">הסרה מרשימת העדכונים</a></p>` : ""}${signOffHtml()}</div></div></body></html>`;
  return { from: subscriberFromHeader(), subject, text, html };
}
