// Re-signup after unsubscribe reactivates (Roman's E2E, 13.11.2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { reactivationPlan, signupPrefill, validateSignup, nationalPhone } from "../supabase/functions/business-alert-signup/logic.mjs";
import { internalAlertEmail } from "../supabase/functions/business-alert-signup/email.mjs";

const body = {
  first_name: "דנה", last_name: "כהן", phone: "+972-50-000-0721", email: "Dana@Example.com",
  consent_general: true, consent_email: true, consent_whatsapp: false, consent_text: "אני מאשר/ת", consent_version: "v1",
  categories: ["food"], regions: ["center"]
};
const gone = {
  id: "s", email: "dana@example.com", status: "unsubscribed_all", consent_email: true, consent_whatsapp: false,
  unsubscribed_at: "2026-11-13T09:18:58Z", email_unsubscribed_at: "2026-11-13T09:18:58Z", whatsapp_unsubscribed_at: "2026-11-13T09:18:58Z", unsubscribed_by: "self_link"
};
const now = "2026-11-13T09:45:00Z";

test("new rows store the phone as national digits", () => {
  const row = validateSignup(body).row;
  assert.equal(row.phone, "0500000721");
  assert.equal(row.phone9, "500000721");
  assert.equal(nationalPhone("050-000-0721"), "0500000721");
});

test("fresh email consent reactivates only the email channel, matching the status constraint", () => {
  const plan = reactivationPlan(gone, validateSignup(body).row, now);
  assert.equal(plan.status, "resubscribed");
  assert.equal(plan.changes.status, "unsubscribed_whatsapp");
  assert.equal(plan.changes.email_unsubscribed_at, null);
  assert.equal(plan.changes.whatsapp_unsubscribed_at, gone.whatsapp_unsubscribed_at);
  assert.equal(plan.changes.consent_email, true);
  assert.equal(plan.changes.consent_whatsapp, false);
  assert.equal(plan.history.action, "reactivate");
  assert.equal(plan.history.previous.status, "unsubscribed_all");
});

test("fresh consent on both channels makes the row active again", () => {
  const plan = reactivationPlan(gone, validateSignup({ ...body, consent_whatsapp: true }).row, now);
  assert.equal(plan.changes.status, "active");
  assert.equal(plan.changes.unsubscribed_at, null);
  assert.equal(plan.changes.unsubscribed_by, null);
  assert.equal(plan.changes.email_unsubscribed_at, null);
  assert.equal(plan.changes.whatsapp_unsubscribed_at, null);
});

test("email-only unsubscribe plus fresh email consent -> active", () => {
  const emailGone = { ...gone, status: "unsubscribed_email", whatsapp_unsubscribed_at: null, consent_whatsapp: false };
  const plan = reactivationPlan(emailGone, validateSignup(body).row, now);
  assert.equal(plan.changes.status, "active");
});

test("no reactivation without fresh consent, with another email, or for an active row", () => {
  assert.equal(reactivationPlan(gone, validateSignup({ ...body, email: "other@example.com" }).row, now), null);
  assert.equal(reactivationPlan({ ...gone, status: "active", unsubscribed_at: null, email_unsubscribed_at: null, whatsapp_unsubscribed_at: null }, validateSignup(body).row, now), null);
  const legacy = { ...body };
  delete legacy.consent_general; delete legacy.consent_text; delete legacy.consent_version;
  const legacyRow = validateSignup({ ...legacy, consent_text_version: "x" });
  if (legacyRow.ok) assert.equal(reactivationPlan(gone, legacyRow.row, now), null);
});

test("prefill shows the real consent state", () => {
  const prefill = signupPrefill(gone, "dana@example.com");
  assert.equal(prefill.consent_email, false);
  assert.equal(prefill.consent_whatsapp, false);
  const active = signupPrefill({ ...gone, status: "active", email_unsubscribed_at: null, whatsapp_unsubscribed_at: null, unsubscribed_at: null }, "dana@example.com");
  assert.equal(active.consent_email, true);
  assert.equal(active.consent_whatsapp, false);
});

test("Baruch's alert says נרשם מחדש for a re-signup", () => {
  assert.equal(internalAlertEmail({ first_name: "דנה", last_name: "כהן", signupKind: "resubscribe" }).subject, "עדכון מאלדד מנהל המערכת: נרשם מחדש – דנה כהן");
  assert.equal(internalAlertEmail({ first_name: "דנה", last_name: "כהן", signupKind: "new" }).subject, "עדכון מאלדד מנהל המערכת: נרשם חדש – דנה כהן");
});
