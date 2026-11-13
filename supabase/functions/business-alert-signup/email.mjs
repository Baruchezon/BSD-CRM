// Subscriber mail for the alerts signup. The From header and the sign-off
// both come from the one subscriber sender constant.

import {
  SUBSCRIBER_FROM,
  SUBSCRIBER_REPLY_TO,
  signOffHtml,
  signOffText,
  subscriberHtml,
  subscriberSubject,
  subscriberText,
  escapeHtml
} from "../_shared/business-alert-mail.mjs";
import copy from "../../../copy/he.json" with { type: "json" };

export const MAIL_FROM = SUBSCRIBER_FROM;
export const MAIL_REPLY_TO = SUBSCRIBER_REPLY_TO;
export const INTERNAL_TO = "baruch.ezon@gmail.com";

export function thankYouSubject() {
  return subscriberSubject(copy.email.signupSubject);
}

export function thankYouEmailText({ firstName, unsubscribeLink }) {
  return subscriberText({
    firstName,
    unsubscribeUrl: unsubscribeLink,
    body: copy.email.signupBody
  });
}

export function thankYouEmailHtml({ firstName, unsubscribeLink }) {
  return subscriberHtml({
    firstName,
    unsubscribeUrl: unsubscribeLink,
    body: copy.email.signupBody
  });
}

function shown(value) {
  if (value == null || value === "") return "לא צוין";
  if (typeof value === "boolean") return value ? "כן" : "לא";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "לא צוין";
  return String(value);
}

function fieldRow(label, value) {
  return `<tr><th style="width:34%;padding:10px 12px;border-bottom:1px solid #e6edf5;background:#f7f3e8;color:#7a5612;font-size:14px;font-weight:700;text-align:right;vertical-align:top">${escapeHtml(label)}</th><td style="padding:10px 12px;border-bottom:1px solid #e6edf5;color:#102844;font-size:16px;text-align:right;vertical-align:top">${escapeHtml(shown(value))}</td></tr>`;
}

export function budgetLabel(row) {
  if (row?.budget_open) return "פתוח להצעות";
  const min = row?.budget_min ?? null;
  const max = row?.budget_max ?? null;
  if (min === 0 && max === 250000) return "עד 250 אלף";
  if (min === 250000 && max === 500000) return "250–500 אלף";
  if (min === 500000 && max === 1000000) return "500 אלף–1 מיליון";
  if (min === 1000000 && max === 3000000) return "1–3 מיליון";
  if (min === 3000000 && max == null) return "מעל 3 מיליון";
  return "";
}

export function formatConsentTime(value) {
  const date = value ? new Date(value) : new Date();
  const formatted = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
  return `${formatted} (שעון ישראל)`;
}

export function signupKindLabel(kind, previousStatus) {
  if (kind === "new") return "הרשמה חדשה";
  if (previousStatus === "unsubscribed" || previousStatus === "unsubscribed_all") return "הרשמה מחדש — הופעל מחדש אחרי הסרה";
  return "הרשמה מחדש";
}

export function internalAlertSubject({ firstName, lastName, signupKind }) {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  const title = signupKind === "new" ? "נרשם חדש לעדכוני עסקים" : "נרשם מחדש לעדכוני עסקים";
  return `${title}: ${name}`;
}

export function internalAlertEmailHtml(row) {
  const kind = signupKindLabel(row.signupKind, row.previousStatus);
  const rows = [
    ["סוג הרשמה", kind],
    ["שם פרטי", row.first_name],
    ["שם משפחה", row.last_name],
    ["טלפון", row.phone],
    ["אימייל", row.email],
    ["תחומי עניין", row.interests],
    ["תקציב", budgetLabel(row)],
    ["אזור", row.region],
    ["הסכמה כללית", row.consent_general],
    ["הסכמה לאימייל", row.consent_email],
    ["הסכמה לוואטסאפ", row.consent_whatsapp],
    ["נוסח ההסכמה", row.consent_text],
    ["גרסת ההסכמה", row.consent_version || row.consent_text_version],
    ["הסכמה ישנה בלי אישור שיווקי", row.legacy_no_consent === true],
    ["מועד ההסכמה", formatConsentTime(row.consent_at)],
    ["ערוץ", row.signup_channel],
    ["סימונים", row.flags],
    ["גרסת טקסונומיה", row.taxonomy_version],
    ["עמוד", row.source_url],
    ["utm_source", row.utm_source],
    ["utm_medium", row.utm_medium],
    ["utm_campaign", row.utm_campaign],
    ["utm_content", row.utm_content]
  ].map(([label, value]) => fieldRow(label, value)).join("");
  const heading = row.signupKind === "new" ? "נרשם חדש לעדכוני עסקים" : "נרשם מחדש לעדכוני עסקים";
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f7fb"><div dir="rtl" lang="he" style="max-width:640px;margin:0 auto;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#102844;padding:28px;text-align:right"><h1 style="margin:0 0 8px;font-size:24px">${escapeHtml(heading)}</h1><p style="margin:0 0 16px">${escapeHtml(kind)}. הפרטים המלאים של הנרשם:</p><table dir="rtl" role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #ead9b0">${rows}</table>${signOffHtml()}</div></body></html>`;
}

export function internalAlertEmailText(row) {
  return `${internalAlertSubject(row)}\n\n${signOffText()}`;
}
