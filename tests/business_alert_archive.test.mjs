import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { archiveSignupPlan } from "../supabase/functions/business-alert-signup/logic.mjs";
import { gateDecision } from "../supabase/functions/_shared/business-alert-rules.mjs";
import { oneAlertDecision } from "../supabase/functions/business-alert-admin/one-alert.mjs";
import { scoreAlert } from "../supabase/functions/_shared/alert-match.mjs";
import { detailAccess } from "../supabase/functions/business-alert-request-details/logic.mjs";
import { inviteGuard } from "../supabase/functions/_shared/business-alert-invite.mjs";
import { archivePlan, purgePlan, restorePlan } from "../supabase/functions/_shared/subscriber-archive.mjs";

const row = {
  id: "sub-1",
  status: "active",
  email: "dana@example.com",
  consent_email: true,
  consent_whatsapp: false,
  consent_general: true,
  legacy_no_consent: false
};

test("archive hides a subscriber from every send, and restore brings the previous status back", () => {
  const archived = archivePlan(row, { by: "ברוך", reason: "ביקש הפסקה", now: "2026-11-15T05:00:00Z" });
  assert.equal(archived.ok, true);
  assert.equal(archived.changes.prev_status, "active");
  assert.equal(archived.history.action, "archive");
  assert.equal(archivePlan({ ...row, archived_at: "2026-11-15T05:00:00Z" }, { by: "ברוך" }).error, "already_archived");
  const back = restorePlan({ ...row, archived_at: "2026-11-15T05:00:00Z", prev_status: "active" }, { by: "ברוך" });
  assert.equal(back.changes.archived_at, null);
  assert.equal(back.changes.status, "active");
  assert.equal(purgePlan(row, "DELETE").error, "not_archived");
  assert.equal(purgePlan({ ...row, archived_at: "2026-11-15T05:00:00Z" }, "delete").error, "confirm_required");
  assert.equal(purgePlan({ ...row, archived_at: "2026-11-15T05:00:00Z" }, "DELETE").ok, true);

  const closed = { ...row, archived_at: "2026-11-15T05:00:00Z" };
  assert.equal(gateDecision(closed, "email").reason, "archived");
  assert.equal(oneAlertDecision({ subscriber: closed, serviceRole: true, allowlist: [], sendingEnabled: false, dryRun: true }).error, "archived");
  assert.equal(detailAccess({ enabled: true, allowlist: [], subscriber: { ...closed, is_test: true } }), false);
  const scored = scoreAlert({ ...row, archived_at: "2026-11-15T05:00:00Z", interests: ["מזון"], region: "חיפה", budget_open: true, legacy_no_consent: false, consent_general: true }, {
    id: "biz", internal_name: "x", anon_display_name: "מאפייה", business_number: "440", field: "מאפייה", city: "חיפה", region: "חיפה והקריות", asking_price: 1000000, anon_summary: "מאפייה", public_listing_active: true
  });
  assert.equal(scored.block_reason, "archived");
  assert.equal(scored.sendable, false);
  assert.equal(inviteGuard({
    card: { phone: "0501234567", email: "dana@example.com" },
    channel: "email",
    invites: [],
    subscribers: [{ archived_at: "2026-11-15T05:00:00Z", status: "active" }],
    now: Date.parse("2026-11-15T12:00:00Z")
  }).error, "archived");
});

test("an archived subscriber who signs up again with the same email is a resubscribe", () => {
  const stored = {
    ...row,
    archived_at: "2026-11-01T00:00:00Z",
    prev_status: "active",
    status: "active"
  };
  const form = {
    email: "dana@example.com",
    first_name: "דנה",
    consent_email: true,
    consent_whatsapp: false,
    consent_general: true,
    consent_text: "כן",
    consent_version: "v1"
  };
  const plan = archiveSignupPlan(stored, form, "2026-11-15T05:00:00Z");
  assert.equal(plan.status, "resubscribed");
  assert.equal(plan.changes.archived_at, null);
  assert.equal(plan.changes.archive_reason, null);
  assert.equal(plan.history.previous.archived_at, stored.archived_at);
  assert.equal(archiveSignupPlan(stored, { ...form, email: "other@example.com" }, "2026-11-15T05:00:00Z"), null);
  assert.equal(archiveSignupPlan({ ...row }, form, "2026-11-15T05:00:00Z"), null);
});

test("the screen, the admin actions, and the migration match the archive contract", () => {
  const admin = readFileSync("supabase/functions/business-alert-admin/index.ts", "utf8");
  assert.match(admin, /action === "archive"/);
  assert.match(admin, /action === "restore"/);
  assert.match(admin, /purgePlan\(person, body\.confirm\)/);
  assert.match(admin, /business_alert_subscriber_purges/);
  assert.match(admin, /\.is\("archived_at", null\)/);
  const signup = readFileSync("supabase/functions/business-alert-signup/index.ts", "utf8");
  assert.match(signup, /archiveSignupPlan/);
  const migration = readFileSync("supabase/migrations/20261115080000_business_alert_subscriber_archive.sql", "utf8");
  assert.match(migration, /archived_at timestamptz/);
  assert.match(migration, /business_alert_subscriber_purges/);
  assert.match(migration, /s\.archived_at is not null/);
  assert.equal(/create policy/i.test(migration), false);
  const screen = readFileSync("site-buyers.html", "utf8");
  assert.match(screen, /העבר לארכיון/);
  assert.match(screen, /ארכיון/);
  assert.match(screen, /שחזר/);
  assert.match(screen, /מחק לצמיתות/);
  assert.match(screen, /מחק/);
  assert.match(screen, /confirm: 'DELETE'/);
  assert.match(screen, /site-buyers\.js\?v=202611150730/);
  assert.match(screen, /data-kind="\$\{kind\}"/);
});
