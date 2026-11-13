import copy from "../../../copy/he.json" with { type: "json" };
import { say, signOffHtml } from "./business-alert-mail.mjs";

// Shared decisions for the alert signup, the public unsubscribe function,
// and the CRM screen. The SQL functions in
// supabase/migrations/20261113120000_business_alert_compliance.sql follow
// the same channel, consent, and stop-word rules.

export const STOP_TEXTS = ["הסר", "הסירו", "stop"];
export const CHANNELS = ["email", "whatsapp", "all"];

export function isStopText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return STOP_TEXTS.includes(text);
}

export function normalizeChannel(value) {
  const channel = String(value ?? "").trim().toLowerCase();
  if (!channel) return "all";
  return CHANNELS.includes(channel) ? channel : "";
}

// Email and WhatsApp are tracked separately. Asking to leave one channel
// leaves the other in place. Asking for both, or for the channel that is
// still open, becomes unsubscribed_all. The legacy word "unsubscribed"
// means both channels.
export function mergeUnsubscribe(status, channel) {
  const current = status === "unsubscribed" ? "unsubscribed_all" : (status || "active");
  const emailOff = current === "unsubscribed_email" || current === "unsubscribed_all";
  const whatsappOff = current === "unsubscribed_whatsapp" || current === "unsubscribed_all";
  const nextEmail = emailOff || channel === "email" || channel === "all";
  const nextWhatsapp = whatsappOff || channel === "whatsapp" || channel === "all";
  if (nextEmail && nextWhatsapp) return "unsubscribed_all";
  if (nextEmail) return "unsubscribed_email";
  if (nextWhatsapp) return "unsubscribed_whatsapp";
  return "active";
}

export function gateDecision(row, channel) {
  if (!row) return { allowed: false, reason: "not_found" };
  if (channel !== "email" && channel !== "whatsapp") return { allowed: false, reason: "invalid_channel" };
  if (row.is_test === true) return { allowed: false, reason: "is_test" };
  if (row.status === "pending_consent") return { allowed: false, reason: "pending_consent" };
  if (row.legacy_no_consent === true) return { allowed: false, reason: "legacy_no_consent" };
  if (row.consent_general !== true) return { allowed: false, reason: "no_general_consent" };
  const status = row.status === "unsubscribed" ? "unsubscribed_all" : row.status;
  if (channel === "email") {
    if (status === "unsubscribed_all" || status === "unsubscribed_email" || row.email_unsubscribed_at) {
      return { allowed: false, reason: "unsubscribed_email" };
    }
    if (row.consent_email !== true) return { allowed: false, reason: "no_email_consent" };
  } else {
    if (status === "unsubscribed_all" || status === "unsubscribed_whatsapp" || row.whatsapp_unsubscribed_at) {
      return { allowed: false, reason: "unsubscribed_whatsapp" };
    }
    if (row.consent_whatsapp !== true) return { allowed: false, reason: "no_whatsapp_consent" };
  }
  return { allowed: true, reason: null };
}

export function normalizeListingPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 240) return "";
  if (/[\u0000-\u001F\u007F]/.test(raw)) return "";
  let path = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (!["www.bsd-bbi.co.il", "bsd-bbi.co.il"].includes(url.hostname)) return "";
      path = url.pathname;
    }
  } catch {
    return "";
  }
  try { path = decodeURIComponent(path); } catch { return ""; }
  path = path.split("?")[0].split("#")[0];
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("..")) return "";
  return path.slice(0, 240);
}

export function generatedTokenShape(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ""));
}

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Sunday 00:00 in Asia/Jerusalem, returned as a UTC instant.
export function startOfWeekJerusalem(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value;
  const weekday = WEEKDAY[get("weekday")] ?? 0;
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  const utcGuess = Date.UTC(y, m - 1, d, hour, minute, second);
  const offset = utcGuess - now.getTime();
  const localMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(localMidnight - offset - weekday * 86400000);
}

export function isUnsubscribedStatus(status) {
  return ["unsubscribed", "unsubscribed_email", "unsubscribed_whatsapp", "unsubscribed_all"].includes(status);
}

export function summarizeSubscribers(rows, now = new Date()) {
  const week = startOfWeekJerusalem(now).getTime();
  const regions = {};
  const sectors = {};
  const summary = {
    total: rows.length,
    newThisWeek: 0,
    active: 0,
    unsubscribed: 0,
    emailConsent: 0,
    whatsappConsent: 0,
    doNotCall: 0,
    awaitingConsent: 0,
    regions,
    sectors
  };
  for (const row of rows) {
    if (row.created_at && new Date(row.created_at).getTime() >= week) summary.newThisWeek += 1;
    if (row.status === "active") summary.active += 1;
    if (isUnsubscribedStatus(row.status)) summary.unsubscribed += 1;
    if (row.do_not_call === true) summary.doNotCall += 1;
    const marketed = row.legacy_no_consent !== true && row.consent_general === true;
    if (!marketed) summary.awaitingConsent += 1;
    const emailClosed = row.status === "unsubscribed_email" || row.status === "unsubscribed_all" || row.status === "unsubscribed" || !!row.email_unsubscribed_at;
    const whatsappClosed = row.status === "unsubscribed_whatsapp" || row.status === "unsubscribed_all" || row.status === "unsubscribed" || !!row.whatsapp_unsubscribed_at;
    if (marketed && row.consent_email === true && !emailClosed) summary.emailConsent += 1;
    if (marketed && row.consent_whatsapp === true && !whatsappClosed) summary.whatsappConsent += 1;
    const region = row.region || "לא צוין";
    regions[region] = (regions[region] || 0) + 1;
    const interests = Array.isArray(row.interests) && row.interests.length ? row.interests : ["לא צוין"];
    for (const interest of interests) sectors[interest] = (sectors[interest] || 0) + 1;
  }
  return summary;
}

export function filterSubscribers(rows, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return rows.slice();
  return rows.filter(row => {
    const hay = [
      row.first_name, row.last_name, row.phone, row.email, row.region,
      ...(Array.isArray(row.interests) ? row.interests : []),
      row.manager_notes, row.status, row.source_url, row.consent_text
    ].join(" ").toLowerCase();
    return hay.includes(needle);
  });
}

export function channelLabel(channel) {
  if (channel === "email") return "אימייל";
  if (channel === "whatsapp") return "וואטסאפ";
  return "כל הערוצים";
}

export function unsubscribePage({ ok, channel, addressForm }) {
  const title = say(ok ? copy.unsubscribe.successTitle : copy.unsubscribe.invalidTitle, addressForm);
  const success = channel === "email"
    ? copy.unsubscribe.successEmail
    : channel === "whatsapp"
      ? copy.unsubscribe.successWhatsapp
      : copy.unsubscribe.successAll;
  const detail = say(ok ? success : copy.unsubscribe.invalidDetail, addressForm);
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="margin:0;background:#f4f7fb;font-family:Arial,Heebo,sans-serif;color:#102844"><main style="max-width:520px;margin:12vh auto;background:#fff;border-radius:18px;padding:32px;text-align:right;border-top:8px solid #c9a24b;box-shadow:0 16px 40px rgba(14,27,52,.12)"><p style="margin:0 0 8px;color:#8a6d1f;font-weight:700">BSD - עסקים למכירה</p><h1 style="margin:0 0 12px;font-size:32px">${title}</h1><p style="margin:0;font-size:18px;line-height:1.6">${detail}</p>${signOffHtml()}</main></body></html>`;
}
