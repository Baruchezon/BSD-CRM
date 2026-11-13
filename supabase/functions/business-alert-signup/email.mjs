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
  subscriberSubject
} from "../_shared/business-alert-mail.mjs";
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

function footerHtml() {
  return `<div dir="rtl" style="margin-top:28px;padding-top:14px;border-top:1px solid #e3d9bf;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#1f2d3d;text-align:right"><b>BSD - עסקים למכירה</b><br><span style="color:#8a6d1f">${BSD_SLOGAN}</span><br>${phonesHtml()}<br><span dir="ltr"><a href="mailto:info@bsd-bbi.co.il" style="color:#0f5ea8;text-decoration:none">info@bsd-bbi.co.il</a> | <a href="https://www.bsd-bbi.co.il/" style="color:#0f5ea8;text-decoration:none">www.bsd-bbi.co.il</a></span></div>`;
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
    "פרסומת",
    greeting,
    "",
    say(copy.email.signupBody, addressForm),
    "",
    say(copy.email.signupKeep, addressForm),
    "",
    `${say(copy.email.signupRemove, addressForm)} ${unsubscribeLink || ""}`,
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
      <p style="margin:0 0 8px;font-size:13px;color:#8a6d1f">פרסומת</p>
      <h1 style="margin:0 0 12px;font-size:26px;line-height:1.35;color:#0a1d42">${thanks}${name ? `, ${name}` : ""}</h1>
      <p style="margin:0 0 12px;font-size:17px">${escapeHtml(say(copy.email.signupBody, addressForm))}</p>
      <p style="margin:0 0 12px;font-size:17px">${escapeHtml(say(copy.email.signupKeep, addressForm))}</p>
      <p style="margin:0;font-size:15px;color:#3d4c63">${escapeHtml(say(copy.email.signupRemove, addressForm))}<br><a href="${link}" style="color:#1d67c8">${escapeHtml(say(copy.email.unsubscribe, addressForm))}</a></p>
      ${quietNoteHtml(addressForm)}
      ${baruchSignatureHtml()}
    </div>
  </div>
</body></html>`;
}

function shown(value) {
  if (value == null || value === "") return "לא צוין";
  if (typeof value === "boolean") return value ? "כן" : "לא";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "לא צוין";
  return String(value);
}

function fieldRow(label, value) {
  return `<tr>
    <th style="width:34%;padding:10px 12px;border-bottom:1px solid #e6edf5;background:#f7f3e8;color:#7a5612;font-size:14px;font-weight:700;text-align:right;vertical-align:top">${escapeHtml(label)}</th>
    <td style="padding:10px 12px;border-bottom:1px solid #e6edf5;color:#102844;font-size:16px;text-align:right;vertical-align:top">${escapeHtml(shown(value))}</td>
  </tr>`;
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
    ["הזהות נשמרה", row.identityKept === true ? "כן — לא דרסנו שם או אימייל קיימים" : ""],
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
    ["גרסת ההסכמה", row.consent_version],
    ["גרסת נוסח ההסכמה", row.consent_text_version],
    ["פנייה", row.address_form === "female" ? "אישה" : row.address_form === "male" ? "גבר" : ""],
    ["הסכמה ישנה בלי אישור שיווקי", row.legacy_no_consent === true],
    ["מועד ההסכמה", formatConsentTime(row.consent_at)],
    ["ערוץ", row.signup_channel],
    ["סימונים", row.flags],
    ["גרסת טקסונומיה", row.taxonomy_version],
    ["עמוד", row.source_url],
    ["utm_source", row.utm_source],
    ["utm_medium", row.utm_medium],
    ["utm_campaign", row.utm_campaign],
    ["utm_content", row.utm_content],
    ["utm_term", row.utm_term]
  ].map(([label, value]) => fieldRow(label, value)).join("");
  const heading = row.signupKind === "new" ? "נרשם חדש לעדכוני עסקים" : "נרשם מחדש לעדכוני עסקים";
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f7fb">
  <div dir="rtl" lang="he" style="max-width:640px;margin:0 auto;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#102844">
    <div style="background:#06142f;padding:22px 28px;text-align:right">
      <img src="${LOGO_URL}" alt="BSD Business Brokers Israel" width="72" height="72" style="display:block;width:72px;height:72px;border:0">
      <div style="margin-top:12px;font-size:13px;letter-spacing:.08em;color:#f0d48a">BSD BUSINESS BROKERS ISRAEL</div>
    </div>
    <div style="height:4px;background:linear-gradient(90deg,#b98520,#f0d48a,#b98520)"></div>
    <div style="padding:28px 28px 8px;text-align:right">
      <h1 style="margin:0 0 8px;font-size:26px;line-height:1.35;color:#0a1d42">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3d4c63">${escapeHtml(kind)}. הפרטים המלאים של הנרשם:</p>
      <table dir="rtl" role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #ead9b0">${rows}</table>
      ${footerHtml()}
    </div>
  </div>
</body></html>`;
}
