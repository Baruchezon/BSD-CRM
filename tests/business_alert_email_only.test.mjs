// 15.11 (Baruch): subscriber updates go out by email only; WhatsApp is "future".
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSignup, errorMessage, signupPrefill, planSubscriberUpdate, DELIVERY_CHANNELS } from "../supabase/functions/business-alert-signup/logic.mjs";
import { publicPrefill } from "../supabase/functions/_shared/business-alert-invite.mjs";
import { readFileSync } from "node:fs";

const body = {
  first_name: "דנה", last_name: "כהן", phone: "0500000831", email: "baruch.ezon+test@gmail.com",
  consent_general: true, consent_email: true, consent_text: "אני מאשר/ת", consent_version: "v1"
};

test("delivery channel is email only", () => {
  assert.deepEqual(DELIVERY_CHANNELS, ["email"]);
});

test("WhatsApp in the payload is ignored and stored as email only", () => {
  for (const extra of [
    { consent_whatsapp: true },
    { consent_whatsapp: true, consent_email: false },
    { whatsapp: true, channel: "whatsapp", channels: ["whatsapp"], preferred_channel: "whatsapp" }
  ]) {
    const result = validateSignup({ ...body, ...extra });
    assert.equal(result.ok, true, JSON.stringify(extra));
    assert.equal(result.row.consent_whatsapp, false);
    assert.equal(result.row.consent_email, true);
    for (const key of ["whatsapp", "channel", "channels", "preferred_channel"]) assert.equal(key in result.row, false);
  }
  const legacy = { ...body, consent_whatsapp: true, consent_text_version: "alerts-consent-2026-11-12" };
  delete legacy.consent_general; delete legacy.consent_text; delete legacy.consent_version;
  const old = validateSignup(legacy);
  assert.equal(old.ok, true);
  assert.equal(old.row.consent_whatsapp, false);
});

test("general consent alone means email (the form may drop the email tick)", () => {
  const noTick = { ...body }; delete noTick.consent_email;
  assert.equal(validateSignup(noTick).row.consent_email, true);
  assert.equal(validateSignup({ ...body, consent_email: false, consent_whatsapp: false }).row.consent_email, true);
  assert.equal(validateSignup({ ...body, consent_general: false }).error, "consent_required");
});

test("a signup without a valid email is rejected with email_required and a Hebrew message", () => {
  for (const email of [undefined, "", "   ", "not-an-email", "a@b"]) {
    const result = validateSignup({ ...body, email, consent_whatsapp: true });
    assert.equal(result.error, "email_required", String(email));
  }
  assert.match(errorMessage("email_required"), /אימייל/);
  assert.equal(validateSignup({ ...body, phone: "" }).error, "missing_required_fields");
});

test("a resubmitted profile update turns WhatsApp off and never on", () => {
  const stored = { id: "s", status: "active", consent_email: true, consent_whatsapp: true };
  const incoming = validateSignup({ ...body, consent_whatsapp: true }).row;
  const plan = planSubscriberUpdate({ stored, incoming, emailMatched: true, now: "2026-11-15T05:00:00Z" });
  assert.equal(plan.changes.consent_whatsapp, false);
  assert.equal(plan.changes.consent_whatsapp_method, undefined);
});

test("signup and invite prefill never offer a WhatsApp channel", () => {
  const stored = { status: "active", email: "baruch.ezon+test@gmail.com", consent_email: true, consent_whatsapp: true };
  assert.equal("consent_whatsapp" in signupPrefill(stored, stored.email), false);
  const shown = publicPrefill({ prefill: { first_name: "a", requested_categories: "קמעונאות", consent_whatsapp: true, channel: "whatsapp" } });
  assert.equal(Object.keys(shown).some(key => /whatsapp|channel/i.test(key)), false);
  assert.deepEqual(shown.categories, ["retail"]);
});

test("signup error responses carry the Hebrew message", () => {
  const source = readFileSync(new URL("../supabase/functions/business-alert-signup/index.ts", import.meta.url), "utf8");
  assert.match(source, /error: signup\.error, message: errorMessage\(signup\.error\)/);
});
