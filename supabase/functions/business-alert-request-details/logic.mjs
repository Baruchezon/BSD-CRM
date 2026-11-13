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

export function fileDetailsCopy({ firstName, addressForm, unsubscribeUrl, slogan }) {
  const female = addressForm === "female" || addressForm === "f";
  const name = String(firstName || "").trim();
  const hello = name ? `שלום ${name},` : "שלום,";
  const body = female ? "מצורף התקציר האנונימי של העסק שביקשת. אם תרצי לשמוע עוד, השיבי למייל הזה." : "מצורף התקציר האנונימי של העסק שביקשת. אם תרצה לשמוע עוד, השב למייל הזה.";
  const removal = "להסרה מרשימת העדכונים";
  const text = [hello, "", body, "", slogan || "", "", unsubscribeUrl ? `${removal}: ${unsubscribeUrl}` : ""].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim();
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;color:#102844;direction:rtl;text-align:right"><div dir="rtl" style="max-width:600px;text-align:right"><p style="margin:0 0 12px;font-size:17px">${escapeHtml(hello)}</p><p style="margin:0 0 12px;font-size:17px">${escapeHtml(body)}</p><p style="margin:0 0 16px;font-size:14px;color:#8a6d1f">${escapeHtml(slogan || "")}</p>${unsubscribeUrl ? `<p style="margin:0;font-size:13px"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#647087">${removal}</a></p>` : ""}</div></body></html>`;
  return { subject: "התקציר האנונימי שביקשת", text, html };
}
