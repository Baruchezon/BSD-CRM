import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_INVITE_TEMPLATE,
  applyAddressForm,
  emailBody,
  hashInviteToken,
  knownAddressForm,
  inviteGuard,
  inviteMessage,
  inviteUrl,
  longInviteUrl,
  messageWithLink,
  newInviteToken,
  prefillFromCard,
  publicPrefill,
  waNumber
} from "../supabase/functions/_shared/business-alert-invite.mjs";

const card = {
  first_name: "דנה",
  last_name: "לוי",
  phone: "050-1234567",
  email: "dana@example.com",
  requested_categories: "מזון, קמעונאות",
  requested_area: "מרכז",
  budget: 500000
};

test("an Israeli mobile becomes a wa.me number and the message is Baruch's wording", () => {
  assert.equal(waNumber("050-1234567"), "972501234567");
  assert.equal(waNumber(""), "");
  const text = inviteMessage("דנה");
  assert.equal(text, DEFAULT_INVITE_TEMPLATE.replaceAll("{שם}", "דנה"));
  assert.match(text, /מוזמן\/ת להצטרף/);
  assert.match(text, /תודה על השיחה!/);
  assert.match(text, /ברוך איזון \| BSD/);
  assert.equal(inviteMessage("דנה", "m").includes("מוזמן/ת"), false);
  assert.match(inviteMessage("דנה", "male"), /מוזמן להצטרף/);
  assert.match(inviteMessage("דנה", "f"), /מוזמנת להצטרף/);
  assert.equal(knownAddressForm([{ address_form: "male" }, { address_form: "female" }]), "");
  assert.equal(applyAddressForm("מוזמן/ת", ""), "מוזמן/ת");
  assert.equal(text.includes("פרסומת"), false);
  const link = "https://www.bsd-bbi.co.il/הרשמה-לעדכונים/?i=abc";
  const sent = messageWithLink(text, link);
  assert.equal(sent.includes("{לינק}"), false);
  assert.equal(sent.includes("/s/"), false);
  assert.match(sent, /i=abc/);
  const mail = emailBody(text);
  assert.equal(mail.includes("http"), false);
  assert.equal(mail.includes("{לינק}"), false);
  assert.equal(mail.includes("ברוך איזון | BSD"), false);
  assert.match(mail, /תודה על השיחה!/);
});

test("guards block do-not-contact, a recent invite, and a fourth invite", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  assert.equal(inviteGuard({ card: { ...card, do_not_call: true }, channel: "email", invites: [], subscribers: [], now }).error, "do_not_call");
  assert.equal(inviteGuard({
    card, channel: "whatsapp", invites: [], subscribers: [{ status: "unsubscribed_email" }], now
  }).error, "do_not_contact");
  assert.equal(inviteGuard({ card: { ...card, phone: "" }, channel: "whatsapp", invites: [], subscribers: [], now }).error, "no_phone");
  assert.equal(inviteGuard({
    card, channel: "email", invites: [{ id: "a", status: "sent", sent_at: "2026-11-14T10:00:00Z" }], subscribers: [], now
  }).error, "too_soon");
  const old = [{ id: "1", status: "joined", sent_at: "2026-10-01T00:00:00Z" }, { id: "2", status: "expired", sent_at: "2026-10-02T00:00:00Z" }, { id: "3", status: "superseded", sent_at: "2026-10-03T00:00:00Z" }];
  assert.equal(inviteGuard({ card, channel: "email", invites: old, subscribers: [], now }).error, "invite_limit");
  const ready = inviteGuard({
    card, channel: "email", invites: [{ id: "old", status: "opened", sent_at: "2026-11-01T00:00:00Z" }], subscribers: [], now
  });
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.supersede, ["old"]);
});

test("prefill is Roman's shape, and the invite link is /s/<code> unless invite_short_links is off", () => {
  const prefill = prefillFromCard(card);
  assert.deepEqual(prefill.categories, ["מזון", "קמעונאות"]);
  assert.equal(prefill.budget, 500000);
  const shown = publicPrefill({ prefill, id: "secret", token: "secret-token", lead_id: "secret" });
  assert.deepEqual(Object.keys(shown).sort(), ["budget", "categories", "email", "first_name", "last_name", "phone", "regions"]);
  assert.deepEqual(shown.regions, ["מרכז"]);
  const token = newInviteToken();
  assert.equal(hashInviteToken(token).length, 64);
  assert.equal(
    longInviteUrl(token),
    `https://www.bsd-bbi.co.il/%D7%94%D7%A8%D7%A9%D7%9E%D7%94-%D7%9C%D7%A2%D7%93%D7%9B%D7%95%D7%A0%D7%99%D7%9D/?i=${encodeURIComponent(token)}&src=invite`
  );
  const quiet = inviteUrl({ short: false, token, code: "Ab12Cd3" });
  assert.equal(quiet, longInviteUrl(token));
  assert.equal(quiet.includes("/s/"), false);
  const unset = inviteUrl({ short: true, token, code: "" });
  assert.equal(unset, longInviteUrl(token));
  const live = inviteUrl({ short: true, token, code: "Ab12Cd3" });
  assert.equal(live, "https://www.bsd-bbi.co.il/s/Ab12Cd3");
  assert.equal(live.includes(token), false);
});

test("signup still claims one thank-you and marks an invite as joined", () => {
  const src = readFileSync("supabase/functions/business-alert-signup/index.ts", "utf8");
  const inviteAt = src.indexOf("invite_token");
  const claimAt = src.indexOf("claimWelcome", inviteAt);
  assert.ok(inviteAt > 0 && claimAt > inviteAt);
  assert.match(src, /status: "joined"/);
  assert.match(src, /invited_by_baruch/);
  assert.match(readFileSync("supabase/functions/business-alert-signup/email.mjs", "utf8"), /הוזמן ע״י ברוך/);
  assert.match(readFileSync("leads.html", "utf8"), /רשימת תפוצת עסקים|businessAlertInvite/);
  assert.match(readFileSync("js/business-alert-invite.js", "utf8"), /wa_url/);
  const inviteFn = readFileSync("supabase/functions/business-alert-invite/index.ts", "utf8");
  assert.match(inviteFn, /invite_whatsapp_template/);
  assert.match(inviteFn, /settings\.short \? newShortCode\(\) : null/);
  assert.equal(inviteFn.includes("short_links_live"), false);
  assert.match(inviteFn, /signOffHtml\(\)/);
  assert.match(inviteFn, /emailBody\(named\)/);
  assert.match(inviteFn, /applyAddressForm/);
  assert.match(inviteFn, />להצטרפות</);
  const go = readFileSync("supabase/functions/business-alert-go/index.ts", "utf8");
  assert.match(go, /longInviteUrl\(invite\.token\)/);
  const resolve = readFileSync("supabase/functions/business-alert-invite-resolve/index.ts", "utf8");
  assert.match(resolve, /prefill: publicPrefill/);
  assert.match(resolve, /\.select\("id, status, expires_at, opened_at, prefill, short_code"\)/);
  const migration = readFileSync("supabase/migrations/20261113330000_business_alert_invites.sql", "utf8");
  assert.match(migration, /invite_whatsapp_template/);
  assert.match(migration, /invite_email_template/);
  assert.match(migration, /invite_short_links boolean not null default true/);
  assert.match(migration, /short_code text unique/);
  assert.equal(/short_code text not null/.test(migration), false);
  const modal = readFileSync("js/business-alert-invite.js", "utf8");
  for (const line of DEFAULT_INVITE_TEMPLATE.split("\n")) {
    assert.ok(migration.includes(line), line);
    assert.ok(modal.includes(line), line);
  }
});
