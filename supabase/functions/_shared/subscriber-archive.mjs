// Archive keeps the person out of every send. Purge is only from the archive,
// and only after the caller types the confirm word the admin function checks.

export function archivePlan(row, { by, reason, now }) {
  if (!row?.id) return { ok: false, error: "not_found" };
  if (row.archived_at) return { ok: false, error: "already_archived" };
  const at = now || new Date().toISOString();
  return {
    ok: true,
    changes: {
      archived_at: at,
      archived_by: String(by || "baruch").slice(0, 120),
      archive_reason: reason ? String(reason).slice(0, 300) : null,
      prev_status: row.status || null
    },
    history: {
      action: "archive",
      actor: String(by || "baruch").slice(0, 120),
      previous: { status: row.status || null, archived_at: null },
      next: { archived_at: at, prev_status: row.status || null, archive_reason: reason || null }
    }
  };
}

export function restorePlan(row, { by }) {
  if (!row?.id) return { ok: false, error: "not_found" };
  if (!row.archived_at) return { ok: false, error: "not_archived" };
  return {
    ok: true,
    changes: {
      archived_at: null,
      archived_by: null,
      archive_reason: null,
      prev_status: null,
      status: row.prev_status || row.status || "active"
    },
    history: {
      action: "restore",
      actor: String(by || "baruch").slice(0, 120),
      previous: { status: row.status || null, archived_at: row.archived_at, prev_status: row.prev_status || null },
      next: { archived_at: null, status: row.prev_status || row.status || "active" }
    }
  };
}

export function purgePlan(row, confirm) {
  if (!row?.id) return { ok: false, error: "not_found" };
  if (!row.archived_at) return { ok: false, error: "not_archived" };
  if (confirm !== "DELETE") return { ok: false, error: "confirm_required" };
  return { ok: true };
}

export const PURGE_TABLES = [
  "business_alert_send_attempts",
  "business_alert_page_views",
  "business_alert_sends",
  "business_alert_matches",
  "business_alert_interactions",
  "business_alert_detail_requests",
  "business_alert_short_links",
  "business_alert_update_nonces",
  "business_alert_subscriber_history",
  "business_alert_identity_audit"
];
