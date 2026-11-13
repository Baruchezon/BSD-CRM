import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { APPROVED_ALERT_BUSINESSES } from "../supabase/functions/_shared/opportunity-email.mjs";
import { oneAlertDecision, selectAlertBusinesses } from "../supabase/functions/business-alert-admin/one-alert.mjs";
import { resendPlan } from "../scripts/resend-one-alert.mjs";

const testRow = {
  id: "b6272485-0059-4c42-99f7-97650275bf8b",
  is_test: true,
  consent_email: true,
  status: "active",
  email_unsubscribed_at: null
};

test("a test subscriber can be sent while the global switches are off", () => {
  const decision = oneAlertDecision({
    subscriber: testRow,
    serviceRole: true,
    allowlist: [],
    sendingEnabled: false,
    dryRun: true
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.test, true);
});

test("service role cannot target a real subscriber, and consent still blocks a test row", () => {
  const real = { ...testRow, is_test: false };
  assert.equal(oneAlertDecision({
    subscriber: real,
    serviceRole: true,
    allowlist: [real.id],
    sendingEnabled: true,
    dryRun: false
  }).error, "test_only");
  assert.equal(oneAlertDecision({
    subscriber: real,
    serviceRole: false,
    allowlist: [],
    sendingEnabled: true,
    dryRun: false
  }).error, "not_allowed");
  assert.equal(oneAlertDecision({
    subscriber: real,
    serviceRole: false,
    allowlist: [real.id],
    sendingEnabled: false,
    dryRun: true
  }).error, "sending_disabled");
  assert.equal(oneAlertDecision({
    subscriber: { ...testRow, consent_email: false },
    serviceRole: true,
    allowlist: [],
    sendingEnabled: true,
    dryRun: false
  }).error, "no_email_consent");
  assert.equal(oneAlertDecision({
    subscriber: { ...testRow, status: "unsubscribed_email" },
    serviceRole: true,
    allowlist: [],
    sendingEnabled: true,
    dryRun: false
  }).error, "unsubscribed");
});

test("the letter uses the approved businesses, including the short test numbers", () => {
  const chosen = selectAlertBusinesses(["1014", "1015", "1021"], APPROVED_ALERT_BUSINESSES);
  assert.deepEqual(chosen.businesses.map(item => item.number), [
    "BSD-B-2607-1014",
    "BSD-B-2607-1015",
    "BSD-B-2608-1021"
  ]);
  assert.equal(selectAlertBusinesses([], APPROVED_ALERT_BUSINESSES).businesses.length, 3);
  assert.equal(selectAlertBusinesses(["9999"], APPROVED_ALERT_BUSINESSES).error, "unknown_business");
});

test("the resend script can authenticate with the service role key", () => {
  const id = "b6272485-0059-4c42-99f7-97650275bf8b";
  const plan = resendPlan(["node", "resend", id, "--confirm", "--businesses", "1014,1015,1021"], {
    BSD_SERVICE_ROLE_KEY: "service-secret"
  });
  assert.equal(plan.auth, "service_role");
  assert.equal(plan.token, "service-secret");
  assert.equal(plan.body.confirm, true);
  assert.deepEqual(plan.body.businesses, ["1014", "1015", "1021"]);
  const preview = spawnSync(process.execPath, ["scripts/resend-one-alert.mjs", id], { encoding: "utf8" });
  assert.equal(preview.status, 0);
  assert.equal(JSON.parse(preview.stdout).confirm, false);
  assert.equal(preview.stdout.includes("service-secret"), false);
});
