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
  return { subject: "פרסומת: קיבלנו את הבקשה לפרטים", text: line };
}
