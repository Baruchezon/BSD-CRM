export const DETAIL_WINDOW_MS = 10 * 60 * 1000;

export function chooseAnonymousFile(files) {
  const flagged = (files || []).filter(file =>
    file?.document_type === "anonymous_summary" &&
    file?.status === "active" &&
    !file?.deleted_at &&
    file?.storage_path
  );
  flagged.sort((left, right) => {
    const version = Number(right.version_number || 0) - Number(left.version_number || 0);
    if (version) return version;
    return String(right.created_at || "").localeCompare(String(left.created_at || ""));
  });
  return flagged[0] || null;
}

export function detailAccess({ enabled, allowlist, subscriber }) {
  if (subscriber?.is_test === true) return true;
  if (enabled === true) return true;
  return Array.isArray(allowlist) && allowlist.map(String).includes(String(subscriber?.id || ""));
}

export function recentDetailRequest(rows, nowMs) {
  return (rows || []).some(row => nowMs - Date.parse(row.created_at || 0) < DETAIL_WINDOW_MS);
}

export function gentleDetailsCopy(addressForm) {
  const key = addressForm === "female" || addressForm === "f" ? "female" : addressForm === "male" || addressForm === "m" ? "male" : "neutral";
  const line = {
    male: "קיבלנו את הבקשה. נחזור אליך בהקדם.",
    female: "קיבלנו את הבקשה. נחזור אלייך בהקדם.",
    neutral: "קיבלנו את הבקשה. נחזור אליך בהקדם."
  }[key];
  return { subject: "קיבלנו את הבקשה לפרטים", text: line };
}

export function isPdfBytes(bytes) {
  return !!bytes && bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function attachmentName(businessNumber) {
  const tail = String(businessNumber || "").match(/(\d{3,6})$/)?.[1] || "BSD";
  return `BSD-anonymous-summary-${tail}.pdf`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
}

// Baruch, 13.11 12:43: the email shows only text buttons, no exposed URLs. The PDF is
// attached. The text part has no URL at all: removal by reply.
export const TEXT_REMOVAL_LINE = "להסרה מרשימת העדכונים אפשר להשיב למייל הזה במילה «הסרה».";

function textButton(label, href, background, color) {
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer" style="display:inline-block;padding:10px 18px;border-radius:8px;background:${background};color:${color};font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(label)}</a>`;
}

export function fileDetailsCopy({ firstName, addressForm, unsubscribeUrl, slogan, replyTo = "info@bsd-bbi.co.il" }) {
  const female = addressForm === "female" || addressForm === "f";
  const name = String(firstName || "").trim();
  const hello = name ? `שלום ${name},` : "שלום,";
  const body = female ? "מצורף התקציר האנונימי של העסק שביקשת. אם תרצי לשמוע עוד, השיבי למייל הזה." : "מצורף התקציר האנונימי של העסק שביקשת. אם תרצה לשמוע עוד, השב למייל הזה.";
  const removal = "להסרה מרשימת העדכונים";
  const text = [hello, "", body, "", "התקציר מצורף כקובץ PDF.", "", slogan || "", "", TEXT_REMOVAL_LINE]
    .filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim();
  const reply = textButton(female ? "להשיב לנו" : "להשיב לנו", `mailto:${replyTo}?subject=${encodeURIComponent("התקציר האנונימי")}`, "#d4a941", "#0a1d42");
  const remove = unsubscribeUrl
    ? `<p style="margin:20px 0 0;font-size:13px"><a href="${escapeHtml(unsubscribeUrl)}" target="_blank" rel="noreferrer" style="display:inline-block;padding:6px 12px;border:1px solid #c9d3e0;border-radius:6px;color:#647087;text-decoration:none">${removal}</a></p>`
    : `<p style="margin:20px 0 0;font-size:13px;color:#647087">${escapeHtml(TEXT_REMOVAL_LINE)}</p>`;
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f7fb"><div dir="rtl" lang="he" style="max-width:600px;margin:0 auto;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#102844;text-align:right"><div style="background:#0e1b34;color:#f0d48a;padding:18px 24px;font-size:18px;font-weight:700">BSD - עסקים למכירה</div><div style="height:4px;background:linear-gradient(90deg,#b98520,#f0d48a,#b98520)"></div><div style="padding:24px;line-height:1.7"><p style="margin:0 0 12px;font-size:17px">${escapeHtml(hello)}</p><p style="margin:0 0 12px;font-size:17px">${escapeHtml(body)}</p><p style="margin:0 0 18px;font-size:15px;color:#3d4c63">📎 התקציר מצורף כקובץ PDF.</p><p style="margin:0 0 18px">${reply}</p><p style="margin:0;font-size:14px;color:#8a6d1f">${escapeHtml(slogan || "")}</p>${remove}</div></div></body></html>`;
  return { subject: "התקציר האנונימי שביקשת", text, html };
}

// Internal note to Baruch when no anonymous summary is flagged. No technical ids:
// the subscriber's name and phone, and the business by name with its number.
export function missingFileAlert({ subscriber, business, businessNumber }) {
  const person = [subscriber?.first_name, subscriber?.last_name].map(v => String(v || "").trim()).filter(Boolean).join(" ") || "נרשם ללא שם";
  const phone = String(subscriber?.phone || "").trim();
  const title = String(business?.internal_name || business?.anon_display_name || business?.category || "").trim();
  const label = title ? `${title} (מספר עסק ${businessNumber})` : `עסק מספר ${businessNumber}`;
  const subject = `עדכון מאלדד מנהל המערכת: אין תקציר אנונימי – ${title || businessNumber}`;
  const lines = [
    `${person}${phone ? `, טלפון ${phone}` : ""}, ביקש פרטים מורחבים על ${label}.`,
    "לעסק הזה עדיין אין תקציר אנונימי מסומן, ולכן נשלחה אליו הודעה קצרה שנחזור אליו.",
    "כדאי להעלות תקציר אנונימי לעסק או לחזור אליו בטלפון."
  ];
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="font-family:Arial,Helvetica,sans-serif;direction:rtl;text-align:right;color:#102844;font-size:16px;line-height:1.7">${lines.map(line => `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`).join("")}</body></html>`;
  return { subject, text: lines.join("\n"), html };
}

export function duplicateRequestPage() {
  return "כבר שלחנו אליך היום את התקציר של העסק הזה. אפשר לחפש אותו בתיבת המייל, או להשיב למייל ונחזור אליך.";
}
