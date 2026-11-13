const CLOSED = new Set(["unsubscribed", "unsubscribed_all", "unsubscribed_email"]);

export function oneAlertDecision({ subscriber, serviceRole, allowlist, sendingEnabled, dryRun }) {
  if (!subscriber?.id) return { ok: false, error: "not_found" };
  const test = subscriber.is_test === true;
  const listed = (allowlist || []).map(String).includes(String(subscriber.id));
  if (serviceRole && !test) return { ok: false, error: "test_only" };
  if (!test && !listed) return { ok: false, error: "not_allowed" };
  if (subscriber.consent_email !== true) return { ok: false, error: "no_email_consent" };
  if (CLOSED.has(subscriber.status) || subscriber.email_unsubscribed_at) return { ok: false, error: "unsubscribed" };
  if (!test && (sendingEnabled !== true || dryRun !== false)) {
    return { ok: false, error: sendingEnabled !== true ? "sending_disabled" : "dry_run", sent: false };
  }
  return { ok: true, test };
}

export const MANUAL_MATCH_PCT = 0;

export function alertSendRows({ subscriberId, businesses, resendId, sender, sentAt, matchPct }) {
  const score = Number.isFinite(matchPct) ? matchPct : MANUAL_MATCH_PCT;
  return (businesses || []).map(business => ({
    subscriber_id: subscriberId,
    business_number: business.number,
    match_pct: score,
    channel: "email",
    created_by: sender || "admin",
    resend_id: resendId,
    sent_at: sentAt
  }));
}

export function selectAlertBusinesses(requested, catalog) {
  const list = Array.isArray(requested) ? requested : [];
  if (!list.length) return { businesses: catalog.slice() };
  const picked = [];
  for (const raw of list) {
    const value = String(raw || "").trim();
    const matches = catalog.filter(item => item.number === value || item.number.endsWith(`-${value}`));
    if (matches.length !== 1) return { error: "unknown_business", value };
    picked.push(matches[0]);
  }
  return { businesses: picked };
}
