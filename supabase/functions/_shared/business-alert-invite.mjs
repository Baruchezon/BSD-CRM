import { createHash, randomBytes } from "node:crypto";
import { newShortCode, shortLinkUrl } from "./short-links.mjs";

export const INVITE_LIMIT = 3;
export const INVITE_GAP_MS = 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SIGNUP_PATH = "/הרשמה-לעדכונים/";
export const SIGNUP_ORIGIN = "https://www.bsd-bbi.co.il";
export const NAME_PLACEHOLDER = "{שם}";
export const LINK_PLACEHOLDER = "{לינק}";
// Baruch's wording. Stored on business_alert_match_settings so it can change without a deploy.
export const DEFAULT_INVITE_TEMPLATE = [
  "שלום {שם} 😊",
  "תודה רבה על השיחה ועל האמון.",
  "כדי שאוכל לעדכן אותך ראשון בעסקים שבאמת מתאימים לך, אשמח שתצטרף/י לרשימת התפוצה האישית שלנו. זה לוקח פחות מדקה:",
  "👉 {לינק}",
  "יישלחו אליך עסקים רלוונטיים להגדרות שלך, בדיסקרטיות מלאה. אנחנו גם יכולים לעזור במימון רכישת העסק וללוות אותך לאורך כל הדרך.",
  "בברכה,",
  "ברוך איזון | BSD"
].join("\n");
const CLOSED = new Set(["unsubscribed", "unsubscribed_all", "unsubscribed_email", "unsubscribed_whatsapp"]);

export function newInviteToken() {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function waNumber(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("972")) return digits.length >= 11 ? digits : "";
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return digits.startsWith("972") && digits.length >= 11 ? digits : "";
}

export function phone9(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}

export function storedTemplate(value) {
  const text = String(value || "").trim();
  return text || DEFAULT_INVITE_TEMPLATE;
}

export function fillName(template, name) {
  const who = String(name || "").trim();
  const text = storedTemplate(template);
  if (!who) return text.replaceAll(NAME_PLACEHOLDER, "").replace(/שלום\s+😊/g, "שלום 😊");
  return text.replaceAll(NAME_PLACEHOLDER, who);
}

export function inviteMessage(name) {
  return fillName(DEFAULT_INVITE_TEMPLATE, name);
}

export function messageWithLink(message, url) {
  const text = String(message || "");
  const link = String(url || "");
  if (text.includes(LINK_PLACEHOLDER)) return text.replaceAll(LINK_PLACEHOLDER, link);
  if (link && text.includes(link)) return text;
  return link ? `${text}\n${link}` : text;
}

// Email shows the same wording. The link is a button, never a visible address.
export function emailBody(message) {
  return String(message || "")
    .replace(/^[ \t]*👉[ \t]*\{לינק\}[ \t]*$/gm, "")
    .replaceAll(LINK_PLACEHOLDER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Roman's signup page. The percent-encoding is the Hebrew path /הרשמה-לעדכונים/.
export function longInviteUrl(token) {
  const path = encodeURIComponent(SIGNUP_PATH.replace(/^\/|\/$/g, ""));
  return `${SIGNUP_ORIGIN}/${path}/?i=${encodeURIComponent(token)}&src=invite`;
}

// Invite links ignore short_links_live. invite_short_links (default true) chooses
// /s/<code>; false falls back to the long signup URL.
export function inviteUrl({ short, token, code }) {
  if (short && code) return shortLinkUrl(code);
  return longInviteUrl(token);
}

export function prefillFromCard(card) {
  const categories = String(card?.requested_categories || card?.requested_field || "")
    .split(/[,،]/).map(item => item.trim()).filter(Boolean);
  const region = String(card?.requested_area || "").trim();
  return {
    first_name: String(card?.first_name || "").trim(),
    last_name: String(card?.last_name || "").trim(),
    phone: String(card?.phone || "").trim(),
    email: String(card?.email || "").trim(),
    categories,
    regions: region ? [region] : [],
    budget: card?.budget == null || card.budget === "" ? null : Number(card.budget)
  };
}

export function publicPrefill(row) {
  const stored = row?.prefill || {};
  return {
    first_name: stored.first_name || "",
    last_name: stored.last_name || "",
    phone: stored.phone || "",
    email: stored.email || "",
    categories: Array.isArray(stored.categories) ? stored.categories : [],
    regions: Array.isArray(stored.regions) ? stored.regions : [],
    budget: stored.budget ?? null
  };
}

export function inviteGuard({ card, channel, invites, subscribers, now }) {
  if (card?.do_not_call === true) return { ok: false, error: "do_not_call" };
  const blocked = (subscribers || []).some(person =>
    person.do_not_call === true || CLOSED.has(person.status) || person.email_unsubscribed_at || person.whatsapp_unsubscribed_at
  );
  if (blocked) return { ok: false, error: "do_not_contact" };
  if (channel === "whatsapp" && !waNumber(card?.phone)) return { ok: false, error: "no_phone" };
  if (channel === "email" && !String(card?.email || "").includes("@")) return { ok: false, error: "no_email" };
  const sent = invites || [];
  if (sent.length >= INVITE_LIMIT) return { ok: false, error: "invite_limit" };
  const latest = sent.map(item => Date.parse(item.sent_at || item.created_at || 0)).sort((a, b) => b - a)[0];
  if (latest && now - latest < INVITE_GAP_MS) return { ok: false, error: "too_soon" };
  return {
    ok: true,
    supersede: sent.filter(item => item.status === "sent" || item.status === "opened").map(item => item.id)
  };
}

export function inviteOpen(invite, now) {
  if (!invite) return { ok: false, error: "invalid_invite" };
  if (invite.status === "superseded" || invite.status === "expired") return { ok: false, error: "invalid_invite" };
  if (Date.parse(invite.expires_at || 0) <= now) return { ok: false, error: "expired" };
  return { ok: true, firstOpen: !invite.opened_at && invite.status === "sent" };
}
