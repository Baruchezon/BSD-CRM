import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isShortCode, newShortCode, shortLinkUrl, buttonLink, TEXT_REMOVAL_LINE } from "../supabase/functions/_shared/short-links.mjs";
import { fileDetailsCopy, missingFileAlert, duplicateRequestPage } from "../supabase/functions/business-alert-request-details/logic.mjs";
import { welcomeBackHtml, welcomeBackSubject, welcomeBackText, thankYouSubject } from "../supabase/functions/business-alert-signup/email.mjs";

const read = path => readFileSync(path, "utf8");

test("short links are short BSD paths", async () => {
  for (let i = 0; i < 200; i += 1) {
    const code = newShortCode();
    assert.equal(code.length, 7);
    assert.ok(isShortCode(code));
    assert.equal(/[IOl01]/.test(code), false);
  }
  assert.equal(shortLinkUrl("Ab3dEf7"), "https://www.bsd-bbi.co.il/s/Ab3dEf7");
  assert.equal(await buttonLink(null, { live: false, kind: "unsubscribe", subscriberId: "x", fallback: "https://www.bsd-bbi.co.il/הסרה/?token=t" }), "https://www.bsd-bbi.co.il/הסרה/?token=t");
});

test("anonymous summary email: buttons only, no URL in text, PDF attached", () => {
  const mail = fileDetailsCopy({ firstName: "דנה", addressForm: "female", unsubscribeUrl: "https://www.bsd-bbi.co.il/s/Ab3dEf7", slogan: "משביחים עסקים, מחברים הזדמנויות, מובילים עסקאות" });
  assert.equal(/https?:\/\//.test(mail.text), false);
  assert.ok(mail.text.includes(TEXT_REMOVAL_LINE));
  const visible = mail.html.replace(/<[^>]+>/g, " ");
  assert.equal(/https?:\/\/|supabase|token=/.test(visible), false);
  assert.equal(/supabase\.co|storage\/v1|token=/.test(mail.html), false);
  assert.ok(mail.html.includes('href="https://www.bsd-bbi.co.il/s/Ab3dEf7"'));
  assert.equal(mail.html.includes("פרסומת") || mail.text.includes("פרסומת"), false);
  const src = read("supabase/functions/business-alert-request-details/index.ts");
  assert.equal(/createSignedUrl|storage\/v1\/object\/sign|הפרטים המורחבים שביקשת/.test(src), false);
  assert.match(src, /content_type: "application\/pdf"/);
});

test("missing-file alert to Baruch shows name, phone and business, no ids", () => {
  const note = missingFileAlert({
    subscriber: { id: "b6272485-0059-4c42-99f7-97650275bf8b", first_name: "דנה", last_name: "לוי", phone: "050-1234567" },
    business: { id: "9d9d6033-7a2d-4c73-8676-8e3bcc91d668", internal_name: "חברת השכרת רכב", business_number: "BSD-B-2607-1014" },
    businessNumber: "BSD-B-2607-1014"
  });
  const all = `${note.subject}\n${note.text}\n${note.html}`;
  assert.ok(note.subject.startsWith("עדכון מאלדד מנהל המערכת:"));
  assert.ok(all.includes("דנה לוי") && all.includes("050-1234567") && all.includes("חברת השכרת רכב") && all.includes("BSD-B-2607-1014"));
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(all), false);
  assert.ok(duplicateRequestPage().includes("כבר שלחנו"));
});

test("request-details claims the row before sending (one email per day)", () => {
  const src = read("supabase/functions/business-alert-request-details/index.ts");
  const claim = src.indexOf("await claimRequest(");
  assert.ok(claim > 0 && claim < src.indexOf("await sendMail(subscriber.email"));
  const migration = read("supabase/migrations/20261113320000_business_alert_dedupe_links.sql");
  assert.match(migration, /business_alert_detail_requests_one_per_day/);
});

test("signup: one thank-you ever, distinct short welcome-back", () => {
  const src = read("supabase/functions/business-alert-signup/index.ts");
  const fresh = src.slice(src.indexOf("const saved = await writeSubscriber("));
  assert.ok(fresh.indexOf("claimWelcome(") < fresh.indexOf("thankYouSubject("));
  const resub = src.slice(src.indexOf("async function resubscribe("), src.indexOf("Deno.serve("));
  assert.ok(resub.indexOf("claimWelcomeBack(") > 0 && resub.indexOf("claimWelcomeBack(") < resub.indexOf("sendEmail("));
  assert.equal(resub.includes("thankYouEmailHtml("), false);
  assert.notEqual(welcomeBackSubject(), thankYouSubject(null));
  for (const form of [null, "male", "female"]) {
    const text = welcomeBackText({ firstName: "רון", addressForm: form });
    assert.equal(/https?:\/\//.test(text), false);
    assert.equal(text.includes("פרסומת"), false);
    assert.ok(welcomeBackHtml({ firstName: "רון", unsubscribeLink: "https://www.bsd-bbi.co.il/s/Ab3dEf7", addressForm: form }).includes("שמחים שחזרת, רון"));
  }
  const already = src.slice(src.indexOf("const plan = alreadyRegisteredPlan("), src.indexOf("const saved = await writeSubscriber("));
  assert.equal(already.includes("sendEmail("), false);
});

test("alerts: reserve before send, no VIP resend override", () => {
  const admin = read("supabase/functions/business-alert-admin/index.ts");
  assert.equal(admin.includes("body.resend"), false);
  const vip = admin.slice(admin.indexOf('action === "preview_vip_send"'), admin.indexOf('action === "send_one_alert"'));
  assert.ok(vip.indexOf("claimVipSend(") < vip.indexOf("https://api.resend.com/emails"));
  const match = admin.slice(admin.indexOf("async function matchAction("), admin.indexOf("async function loadSecrets("));
  assert.ok(match.indexOf("claimAlertSends(") < match.indexOf("https://api.resend.com/emails"));
});
