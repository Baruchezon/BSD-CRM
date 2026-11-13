import copy from "../../../copy/he.json" with { type: "json" };

// One sender for every subscriber email these functions send:
// signup confirmation, future alert mailings, and any unsubscribe mail.
// The display name is quoted because it contains a hyphen and non-ASCII text.

export const BSD_SLOGAN = "משביחים עסקים, מחברים הזדמנויות, מובילים עסקאות";
export const SUBSCRIBER_FROM_NAME = "BSD - עסקים למכירה";
export const SUBSCRIBER_FROM_ADDRESS = "info@bsd-bbi.co.il";
export const SUBSCRIBER_REPLY_TO = "info@bsd-bbi.co.il";
export const SUBSCRIBER_SITE = "https://www.bsd-bbi.co.il";
export const SUBSCRIBER_PHONES = copy.footer.phones;
export const SUBSCRIBER_PHONE = SUBSCRIBER_PHONES[0].display;
export const SUBSCRIBER_ADDRESS = "מגדל BSR 3, רח׳ מצדה 9, בני ברק";

export function phonesText(phones = SUBSCRIBER_PHONES) {
  return phones.map(phone => `${phone.label}: ${phone.display}`).join("\n");
}

export function phonesHtml(linkStyle = "color:#0f5ea8;text-decoration:none", phones = SUBSCRIBER_PHONES) {
  return phones.map(phone =>
    `${escapeHtml(phone.label)}: <a href="${escapeHtml(phone.tel)}" style="${linkStyle}" dir="ltr">${escapeHtml(phone.display)}</a>`
  ).join("<br>");
}

export function subscriberFromHeader(name = SUBSCRIBER_FROM_NAME, address = SUBSCRIBER_FROM_ADDRESS) {
  const quoted = String(name).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${quoted}" <${address}>`;
}

export const SUBSCRIBER_FROM = subscriberFromHeader();

// Stored values are male or female. m and f are accepted and normalized.
// Anything else, including null, is the neutral singular.
export function addressKey(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "m" || raw === "male") return "male";
  if (raw === "f" || raw === "female") return "female";
  return "neutral";
}

export function say(entry, addressForm) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const key = addressKey(addressForm);
    return String(entry[key] ?? entry.neutral ?? "");
  }
  return String(entry ?? "");
}

export function signOffLines() {
  return [
    SUBSCRIBER_FROM_NAME,
    BSD_SLOGAN,
    SUBSCRIBER_ADDRESS,
    `${SUBSCRIBER_FROM_ADDRESS} | ${SUBSCRIBER_SITE.replace("https://", "")}`,
    ...SUBSCRIBER_PHONES.map(phone => `${phone.label}: ${phone.display}`)
  ];
}

export function signOffText() {
  return signOffLines().join("\n");
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

export function signOffHtml() {
  const [name, slogan, address, contacts] = signOffLines();
  return `<div dir="rtl" style="margin-top:28px;padding-top:14px;border-top:1px solid #e3d9bf;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#1f2d3d;text-align:right"><b>${escapeHtml(name)}</b><br>${escapeHtml(slogan)}<br>${escapeHtml(address)}<br><span dir="ltr">${escapeHtml(contacts)}</span><br>${phonesHtml()}</div>`;
}

export function unsubscribeHttpsUrl(supabaseUrl, token, channel = "all") {
  const base = String(supabaseUrl || "https://zcdlegcvfirwzitfxjcs.supabase.co").replace(/\/$/, "");
  const params = new URLSearchParams({ token: String(token || ""), channel });
  return `${base}/functions/v1/business-alert-unsubscribe?${params.toString()}`;
}

// https one-click URL plus a mailto on the same domain. No other domain.
export function listUnsubscribeHeaders(httpsUrl, address = SUBSCRIBER_FROM_ADDRESS) {
  const mailto = `mailto:${address}?subject=unsubscribe`;
  return {
    "List-Unsubscribe": `<${httpsUrl}>, <${mailto}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
  };
}

export function quietNoteText(addressForm) {
  return [
    say(copy.pendingApproval.financing, addressForm),
    say(copy.pendingApproval.newcomer, addressForm)
  ].join("\n");
}

export function quietNoteHtml(addressForm) {
  return `<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#647087;">${escapeHtml(quietNoteText(addressForm)).replace(/\n/g, "<br>")}</p>`;
}

export function whatsappMessage(firstName, addressForm) {
  const name = String(firstName || "").trim();
  const body = say(copy.whatsapp.prefill, addressForm);
  const greeting = name ? body.replace("שלום,", `שלום ${name},`) : body;
  const lines = greeting.split("\n");
  const removal = lines.pop();
  return ["פרסומת", ...lines, "", quietNoteText(addressForm), removal].join("\n");
}

// Baruch, 13.11.2026: these are personal emails. No «פרסומת» label anywhere.
export function subscriberSubject(topic) {
  return String(topic || "").replace(/^\s*פרסומת\s*:?\s*/, "").trim();
}

export function subscriberText({ firstName, body, unsubscribeUrl, addressForm, textLinks = true }) {
  const name = String(firstName || "").trim();
  const hello = name ? `שלום ${name},` : "שלום,";
  return [
    hello,
    "",
    String(body || "").trim(),
    "",
    quietNoteText(addressForm),
    "",
    textLinks ? (unsubscribeUrl ? `להסרה: ${unsubscribeUrl}` : "") : "להסרה מרשימת העדכונים אפשר להשיב למייל הזה במילה «הסרה».",
    "",
    signOffText()
  ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n");
}

export function subscriberHtml({ firstName, body, unsubscribeUrl, addressForm, button = null }) {
  const name = escapeHtml(String(firstName || "").trim());
  const hello = name ? `שלום ${name},` : "שלום,";
  const link = unsubscribeUrl
    ? `<p style="margin:16px 0 0;font-size:14px"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#1d67c8">${escapeHtml(say(copy.email.unsubscribe, addressForm))}</a></p>`
    : "";
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f7fb"><div dir="rtl" lang="he" style="max-width:640px;margin:0 auto;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#102844;text-align:right"><div style="background:#0e1b34;color:#f0d48a;padding:18px 24px;font-size:18px;font-weight:700">${escapeHtml(SUBSCRIBER_FROM_NAME)}</div><div style="padding:24px;line-height:1.7;font-size:16px"><p style="margin:0 0 12px">${hello}</p><p style="margin:0">${escapeHtml(body || "").replace(/\n/g, "<br>")}</p>${button?.href ? `<p style="margin:16px 0 0"><a href="${escapeHtml(button.href)}" target="_blank" rel="noreferrer" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#102d61;color:#ffffff;font-weight:700;text-decoration:none">${escapeHtml(button.label || "לעסקים למכירה")}</a></p>` : ""}${link}${quietNoteHtml(addressForm)}${signOffHtml()}</div></div></body></html>`;
}
