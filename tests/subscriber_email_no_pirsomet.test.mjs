// Baruch, 13.11.2026: emails to subscribers are personal. The word «פרסומת»
// must not appear in any subject, text or html. The removal link stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { thankYouSubject, thankYouEmailText, thankYouEmailHtml } from "../supabase/functions/business-alert-signup/email.mjs";
import { subscriberSubject, subscriberText, subscriberHtml } from "../supabase/functions/_shared/business-alert-mail.mjs";
import { APPROVED_ALERT_BUSINESSES, threeBusinessEmail } from "../supabase/functions/_shared/opportunity-email.mjs";
import { matchAlertEmail } from "../supabase/functions/_shared/alert-match.mjs";
import { gentleDetailsCopy } from "../supabase/functions/business-alert-request-details/logic.mjs";
import { unsubscribePage } from "../supabase/functions/_shared/business-alert-rules.mjs";

const WORD = "פרסומת";
const unsub = "https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/business-alert-unsubscribe?token=abc&channel=email";
const forms = [null, "male", "female"];

test("signup thank-you has no «פרסומת» and keeps the removal link", () => {
  for (const f of forms) {
    const parts = [thankYouSubject(f), thankYouEmailText({ firstName: "דנה", unsubscribeLink: unsub, addressForm: f }), thankYouEmailHtml({ firstName: "דנה", unsubscribeLink: unsub, addressForm: f })];
    for (const part of parts) assert.equal(part.includes(WORD), false);
    assert.equal(parts[1].includes(unsub), false);
    assert.ok(parts[1].includes("במילה «הסרה»"));
    assert.ok(parts[2].includes(unsub.replace(/&/g, "&amp;")) || parts[2].includes(unsub));
  }
});

test("generic subscriber mail, 3-business letter (also VIP) and single alert have no «פרסומת»", () => {
  for (const f of forms) {
    const generic = [subscriberSubject("עדכון"), subscriberText({ firstName: "דנה", body: "x", unsubscribeUrl: unsub, addressForm: f }), subscriberHtml({ firstName: "דנה", body: "x", unsubscribeUrl: unsub, addressForm: f })];
    const three = threeBusinessEmail({ firstName: "דנה", businesses: APPROVED_ALERT_BUSINESSES.map(b => ({ ...b, detailsUrl: "https://x/d" })), unsubscribeUrl: unsub, addressForm: f });
    const one = matchAlertEmail({ firstName: "דנה", card: { title: "עסק", url: "https://www.bsd-bbi.co.il/x/" }, unsubscribeUrl: unsub, addressForm: f });
    for (const part of [...generic, three.subject, three.text, three.html, one.subject, one.text, one.html]) assert.equal(part.includes(WORD), false);
    assert.ok(three.html.includes(unsub.replace(/&/g, "&amp;")) && one.text.includes(unsub));
    assert.equal(three.text.includes(unsub), false);
    const oneMail = matchAlertEmail({ firstName: "דנה", card: { title: "עסק", url: "https://www.bsd-bbi.co.il/x/" }, unsubscribeUrl: unsub, addressForm: f, textLinks: false });
    assert.equal(/https?:\/\//.test(oneMail.text), false);
  }
});

test("request-details emails and the unsubscribe page have no «פרסומת»", () => {
  for (const f of forms) {
    const g = gentleDetailsCopy(f);
    assert.equal(g.subject.includes(WORD) || g.text.includes(WORD), false);
    assert.equal(unsubscribePage({ ok: true, channel: "email", addressForm: f }).includes(WORD), false);
  }
  const src = readFileSync("supabase/functions/business-alert-request-details/index.ts", "utf8");
  assert.equal(src.includes(WORD), false);
});
