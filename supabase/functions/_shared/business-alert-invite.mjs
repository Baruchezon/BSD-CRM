import { createHash, randomBytes } from "node:crypto";
import { newShortCode, shortLinkUrl } from "./short-links.mjs";

export const INVITE_LIMIT = 3;
export const INVITE_GAP_MS = 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SIGNUP_PATH = "/הרשמה-לעדכונים/";
export const SIGNUP_ORIGIN = "https://www.bsd-bbi.co.il";
export const LINK_PLACEHOLDER = "הקישור האישי";
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

export function inviteMessage(name) {
  const who = String(name || "").trim();
  return [
    who ? `שלום ${who} 😊` : "שלום 😊",
    "תודה רבה על השיחה ועל האמון.",
    "כדי שאוכל לעדכן אותך ראשון בעסקים שבאמת מתאימים לך, אשמח לצרף אותך לרשימת התפוצה האישית שלנו.",
    "זה לוקח פחות מדקה, הפרטים כבר ממולאים:",
    `👉 ${LINK_PLACEHOLDER}`,
    "נשלח רק הזדמנויות רלוונטיות, בדיסקרטיות מלאה.",
    "אנחנו גם יכולים לעזור במימון רכישת העסק וללוות אותך לאורך כל הדרך.",
    "ברוך, BSD"
  ].join("\n");
}

export function messageWithLink(message, url) {
  const text = String(message || "");
  if (text.includes(LINK_PLACEHOLDER)) return text.replaceAll(LINK_PLACEHOLDER, url);
  return `${text}\n${url}`;
}

export function inviteUrl({ live, token, code }) {
  if (live) return shortLinkUrl(code);
  return `${SIGNUP_ORIGIN}${SIGNUP_PATH}?i=${encodeURIComponent(token)}`;
}

export function signupUrlForCode(code) {
  return `${SIGNUP_ORIGIN}${SIGNUP_PATH}?i=${encodeURIComponent(code)}`;
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
