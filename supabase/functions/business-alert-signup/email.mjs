// Signup mail, based on the deployed business-alert-signup v3 template:
// logo header, Baruch's signature on the thank-you, and the shared phone footer.
// The From header stays the one quoted subscriber sender.
// The two phone links come from copy/he.json.

import {
  BSD_SLOGAN,
  SUBSCRIBER_FROM,
  SUBSCRIBER_REPLY_TO,
  phonesHtml,
  phonesText,
  quietNoteHtml,
  quietNoteText,
  say,
  subscriberFromHeader,
  subscriberSubject
} from "../_shared/business-alert-mail.mjs";
import { categoryBySlug, flagLabel, regionLabel, subcategoryBySlug } from "../_shared/taxonomy.mjs";
import { TEXT_REMOVAL_LINE } from "../_shared/short-links.mjs";
import copy from "../../../copy/he.json" with { type: "json" };

export const MAIL_FROM = SUBSCRIBER_FROM;
export const MAIL_REPLY_TO = SUBSCRIBER_REPLY_TO;
export const INTERNAL_TO = "baruch.ezon@gmail.com";
export const LOGO_URL = "https://www.bsd-bbi.co.il/assets/bsd-asset-01-logo.png";
const SITE_ORIGIN = "https://www.bsd-bbi.co.il";

export function unsubscribeUrl(token, channel = "all") {
  const path = encodeURIComponent("הסרה");
  return `${SITE_ORIGIN}/${path}/?token=${encodeURIComponent(token)}&channel=${encodeURIComponent(channel)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

export function baruchSignatureHtml() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" dir="rtl" style="border-top:1px solid #d9e2ed;margin-top:18px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;text-align:right"><tbody><tr><td style="vertical-align:middle;padding:16px 0 6px 16px"><img src="${LOGO_URL}" alt="BSD מתווכי עסקים ישראל" width="130" style="width:130px;height:auto;display:block;border:0"></td><td style="vertical-align:middle;padding:16px 0 6px 0;font-size:12px;line-height:1.65;color:#243449;text-align:right"><strong style="font-size:15px;color:#143b64">ברוך איזון</strong><br><strong>מנכ״ל | BSD מתווכי עסקים ישראל</strong><br>מגדל BSR 3, רח׳ מצדה 9, בני ברק<br>${phonesHtml("color:#0B2A5B;text-decoration:none")}<br><a href="mailto:baruch@bsd-bbi.co.il" style="color:#0B2A5B;text-decoration:none">baruch@bsd-bbi.co.il</a><br><a href="https://www.bsd-bbi.co.il/" style="color:#185a9d;text-decoration:none">www.bsd-bbi.co.il</a></td></tr></tbody></table>`;
}

export const BARUCH_SIGNATURE_TEXT = [
  "ברוך איזון",
  "מנכ״ל | BSD מתווכי עסקים ישראל",
  "מגדל BSR 3, רח׳ מצדה 9, בני ברק",
  phonesText()
].join("\n");

export function thankYouSubject(addressForm) {
  return subscriberSubject(say(copy.email.signupSubject, addressForm));
}

export function thankYouEmailText({ firstName, unsubscribeLink, addressForm }) {
  const thanks = say(copy.email.signupThanks, addressForm);
  const greeting = firstName ? `${thanks}, ${firstName}` : thanks;
  return [
    greeting,
    "",
    say(copy.email.signupBody, addressForm),
    "",
    say(copy.email.signupKeep, addressForm),
    "",
    `${say(copy.email.signupRemove, addressForm)} ${TEXT_REMOVAL_LINE}`,
    "",
    quietNoteText(addressForm),
    "",
    BARUCH_SIGNATURE_TEXT
  ].join("\n");
}

export function thankYouEmailHtml({ firstName, unsubscribeLink, addressForm }) {
  const name = escapeHtml(firstName || "");
  const link = escapeHtml(unsubscribeLink || "");
  const thanks = escapeHtml(say(copy.email.signupThanks, addressForm));
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f7fb">
  <div dir="rtl" lang="he" style="max-width:640px;margin:0 auto;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#102844">
    <div style="background:#06142f;padding:22px 28px;text-align:right">
      <img src="${LOGO_URL}" alt="BSD Business Brokers Israel" width="72" height="72" style="display:block;width:72px;height:72px;border:0">
      <div style="margin-top:12px;font-size:13px;letter-spacing:.08em;color:#f0d48a">BSD BUSINESS BROKERS ISRAEL</div>
    </div>
    <div style="height:4px;background:linear-gradient(90deg,#b98520,#f0d48a,#b98520)"></div>
    <div style="padding:28px;text-align:right;line-height:1.7">
      <h1 style="margin:0 0 12px;font-size:26px;line-height:1.35;color:#0a1d42">${thanks}${name ? `, ${name}` : ""}</h1>
      <p style="margin:0 0 12px;font-size:17px">${escapeHtml(say(copy.email.signupBody, addressForm))}</p>
      <p style="margin:0 0 12px;font-size:17px">${escapeHtml(say(copy.email.signupKeep, addressForm))}</p>
      <p style="margin:0;font-size:15px;color:#3d4c63">${escapeHtml(say(copy.email.signupRemove, addressForm))}<br>${link ? `<a href="${link}" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:6px;padding:6px 12px;border:1px solid #c9d3e0;border-radius:6px;color:#3d4c63;text-decoration:none">${escapeHtml(say(copy.email.unsubscribe, addressForm))}</a>` : escapeHtml(TEXT_REMOVAL_LINE)}</p>
      ${quietNoteHtml(addressForm)}
      ${baruchSignatureHtml()}
    </div>
  </div>
</body></html>`;
}

// Welcome back after an unsubscribe (Baruch, 13.11 12:43): one short email, clearly
// different from the first thank-you.
export function welcomeBackSubject() {
  return "שמחים שחזרת לעדכונים של BSD";
}

function welcomeBackLines(firstName, addressForm) {
  const name = String(firstName || "").trim();
  return {
    hello: name ? `שמחים שחזרת, ${name}` : "שמחים שחזרת",
    body: "מעכשיו נמשיך לשלוח לך רק עסקים שמתאימים למה שבחרת.",
    remove: say(copy.email.signupRemove, addressForm)
  };
}

export function welcomeBackText({ firstName, addressForm }) {
  const lines = welcomeBackLines(firstName, addressForm);
  return [lines.hello, "", lines.body, "", `${lines.remove} ${TEXT_REMOVAL_LINE}`, "", BSD_SLOGAN, "", BARUCH_SIGNATURE_TEXT].join("\n");
}

export function welcomeBackHtml({ firstName, unsubscribeLink, addressForm }) {
  const lines = welcomeBackLines(firstName, addressForm);
  const link = escapeHtml(unsubscribeLink || "");
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f7fb"><div dir="rtl" lang="he" style="max-width:600px;margin:0 auto;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#102844;text-align:right"><div style="background:#06142f;color:#f0d48a;padding:18px 24px;font-size:18px;font-weight:700">BSD - עסקים למכירה</div><div style="height:4px;background:linear-gradient(90deg,#b98520,#f0d48a,#b98520)"></div><div style="padding:24px;line-height:1.7"><h1 style="margin:0 0 10px;font-size:22px;color:#0a1d42">${escapeHtml(lines.hello)}</h1><p style="margin:0 0 12px;font-size:17px">${escapeHtml(lines.body)}</p><p style="margin:0 0 14px;font-size:14px;color:#8a6d1f">${escapeHtml(BSD_SLOGAN)}</p><p style="margin:0;font-size:14px;color:#3d4c63">${escapeHtml(lines.remove)}<br>${link ? `<a href="${link}" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:6px;padding:6px 12px;border:1px solid #c9d3e0;border-radius:6px;color:#3d4c63;text-decoration:none">${escapeHtml(say(copy.email.unsubscribe, addressForm))}</a>` : escapeHtml(TEXT_REMOVAL_LINE)}</p>${baruchSignatureHtml()}</div></div></body></html>`;
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

// Internal "new subscriber" alert to Baruch (Baruch, 13.11 11:32 + 11:35): only first
// name, last name, phone, interests, signup date and budget if given. No technical
// details and no links. Short RTL list with a plain-text part, readable on a phone.
export const INTERNAL_FROM_NAME = "עדכון מאלדד מנהל המערכת";
export const INTERNAL_FROM = subscriberFromHeader(INTERNAL_FROM_NAME);
export const INTERNAL_SUBJECT_PREFIX = "עדכון מאלדד מנהל המערכת:";

function listOf(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

export function signupDateLabel(value) {
  const date = value ? new Date(value) : new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

function budgetText(row) {
  const money = value => Number(value).toLocaleString("he-IL");
  const label = budgetLabel(row);
  if (label) return label;
  if (row.budget_min != null && row.budget_max != null) return `${money(row.budget_min)}–${money(row.budget_max)} ₪`;
  if (row.budget_max != null) return `עד ${money(row.budget_max)} ₪`;
  if (row.budget_min != null) return `מעל ${money(row.budget_min)} ₪`;
  return "";
}

export function internalAlertFields(row) {
  const interests = [
    ...listOf(row.categories).map(slug => categoryBySlug(slug)?.label || slug),
    ...listOf(row.subcategories).map(slug => subcategoryBySlug(slug)?.label || slug),
    ...listOf(row.interests),
    ...listOf(row.regions).map(regionLabel),
    ...listOf(row.region)
  ];
  const looking = String(row.looking_for || "").trim();
  const interestText = [interests.join(", "), looking].filter(Boolean).join(" · ");
  return [
    ["שם פרטי", row.first_name || ""],
    ["שם משפחה", row.last_name || ""],
    ["טלפון", row.phone || ""],
    ["תחומי עניין", interestText],
    ["תאריך הרשמה", signupDateLabel(row.consent_at)],
    ["תקציב", budgetText(row)],
    ["הערות", String(row.notes || "").trim()]
  ].filter(([, value]) => String(value).trim() !== "");
}

export function internalAlertEmail(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "ללא שם";
  const title = !row.signupKind || row.signupKind === "new" ? "נרשם חדש" : "נרשם מחדש";
  const subject = `${INTERNAL_SUBJECT_PREFIX} ${title} – ${name}`;
  const fields = internalAlertFields(row);
  const text = fields.map(([label, value]) => `${label}: ${value}`).join("\n");
  const lines = fields.map(([label, value]) =>
    `<p style="margin:0 0 10px;font-size:18px;line-height:1.5"><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</p>`).join("");
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#102844;direction:rtl;text-align:right">
<div dir="rtl" style="max-width:600px;text-align:right">${lines}</div></body></html>`;
  return { from: INTERNAL_FROM, subject, text, html };
}
