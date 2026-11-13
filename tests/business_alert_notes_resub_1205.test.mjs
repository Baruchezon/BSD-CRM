// Roman's live E2E 13.11 12:00: notes kept on update, notes in prefill, resubscribe replaces profile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSignup, planSubscriberUpdate, reactivationPlan, alreadyRegisteredPlan, signupPrefill } from "../supabase/functions/business-alert-signup/logic.mjs";
import { internalAlertEmail } from "../supabase/functions/business-alert-signup/email.mjs";

const body = {
  first_name: "רון", last_name: "חדש", phone: "050-000-0761", email: "r@example.com",
  consent_general: true, consent_email: true, consent_whatsapp: false, consent_text: "מאשר", consent_version: "v1",
  categories: ["food"], regions: ["center"], looking_for: "מסעדה", budget_min: 500000, budget_max: 1000000
};
const stored = { id: "s", status: "active", email: "r@example.com", notes: "להתקשר בערב", crm_lead_id: null, consent_email: true, consent_whatsapp: false };

test("update with notes null or absent keeps notes; only \"\" clears", () => {
  for (const incoming of [body, { ...body, notes: null }]) {
    const plan = planSubscriberUpdate({ stored, incoming: validateSignup(incoming).row, emailMatched: true, now: "n" });
    assert.equal(Object.hasOwn(plan.changes, "notes"), false);
  }
  const cleared = planSubscriberUpdate({ stored, incoming: validateSignup({ ...body, notes: "" }).row, emailMatched: true, now: "n" });
  assert.equal(Object.hasOwn(cleared.changes, "notes"), true);
  assert.equal(cleared.changes.notes, null);
  assert.equal(cleared.lead, null);
});

test("prefill includes notes on email match only", () => {
  assert.equal(signupPrefill(stored, "R@example.com").notes, "להתקשר בערב");
  assert.equal(signupPrefill(stored, "other@example.com"), null);
  const plan = alreadyRegisteredPlan(stored, "other@example.com", { nonce: "n", nowMs: 0, secret: "x".repeat(32) });
  assert.equal(plan.prefill, undefined);
  const matched = alreadyRegisteredPlan(stored, "r@example.com", { nonce: "n", nowMs: 0, secret: "x".repeat(32) });
  assert.equal(matched.prefill.notes, "להתקשר בערב");
});

test("resubscribe replaces the profile and keeps the old values in history", () => {
  const gone = {
    ...stored, status: "unsubscribed_email", categories: ["industry"], regions: ["north"], looking_for: "מפעל",
    budget_min: 100000, budget_max: 200000, budget_open: false, first_name: "רון", last_name: "ישן",
    unsubscribed_at: "t", email_unsubscribed_at: "t", unsubscribed_by: "self_link"
  };
  const plan = reactivationPlan(gone, validateSignup({ ...body, notes: null }).row, "now");
  assert.deepEqual(plan.changes.categories, ["food"]);
  assert.deepEqual(plan.changes.regions, ["center"]);
  assert.equal(plan.changes.looking_for, "מסעדה");
  assert.equal(plan.changes.budget_max, 1000000);
  assert.equal(plan.changes.last_name, "חדש");
  assert.equal(Object.hasOwn(plan.changes, "notes"), false, "null notes do not erase");
  assert.deepEqual(plan.history.previous.old_values.categories, ["industry"]);
  assert.equal(plan.history.previous.old_values.looking_for, "מפעל");
  assert.equal(plan.history.previous.old_values.last_name, "ישן");
  const withNotes = reactivationPlan(gone, validateSignup({ ...body, notes: "חדש" }).row, "now");
  assert.equal(withNotes.changes.notes, "חדש");
  assert.equal(withNotes.history.previous.old_values.notes, "להתקשר בערב");
  const alert = internalAlertEmail({ ...gone, ...plan.changes, signupKind: "resubscribe", consent_at: "2026-11-13T10:00:00Z" });
  assert.match(alert.subject, /נרשם מחדש – רון חדש/);
  assert.match(alert.text, /מזון/);
  assert.doesNotMatch(alert.text, /תעשי/);
});
