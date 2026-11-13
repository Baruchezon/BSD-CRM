// Baruch, 13.11.2026: notes field, a short phone-friendly new-subscriber alert,
// and the anonymous summary as a PDF attachment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notesOf, NOTES_MAX, validateSignup, planSubscriberUpdate, appendLeadNotes } from "../supabase/functions/business-alert-signup/logic.mjs";
import { internalAlertEmail, INTERNAL_FROM } from "../supabase/functions/business-alert-signup/email.mjs";
import { SUBSCRIBER_FROM } from "../supabase/functions/_shared/business-alert-mail.mjs";
import { attachmentName, fileDetailsCopy, isPdfBytes } from "../supabase/functions/business-alert-request-details/logic.mjs";

const signupBody = {
  first_name: "דנה", last_name: "כהן", phone: "050-000-0799", email: "x@example.com",
  consent_general: true, consent_email: true, consent_whatsapp: false,
  consent_text: "אני מאשר/ת", consent_version: "v1", categories: ["food"], regions: ["center"], looking_for: "מסעדה"
};

test("notes are optional, cleaned and capped at 500", () => {
  assert.equal(notesOf({}), undefined);
  assert.equal(notesOf({ notes: "   " }), null);
  assert.equal(notesOf({ notes: null }), undefined);
  assert.equal(notesOf({ notes: "" }), null);
  assert.equal(notesOf({ notes: "<b></b>" }), undefined);
  assert.equal(notesOf({ notes: "<b>שלום</b>\u0007 עולם<script>x</script>" }), "שלום עולם x");
  assert.equal(notesOf({ notes: "א".repeat(900) }).length, NOTES_MAX);
  const old = validateSignup(signupBody);
  assert.equal(old.ok, true);
  assert.equal(Object.hasOwn(old.row, "notes"), false);
  const withNotes = validateSignup({ ...signupBody, notes: " מעדיף צפון " });
  assert.equal(withNotes.row.notes, "מעדיף צפון");
});

test("update overwrites notes only when the key is sent, and the lead gets them appended", () => {
  const stored = { id: "s", status: "active", crm_lead_id: "lead", notes: "ישן" };
  const without = planSubscriberUpdate({ stored, incoming: validateSignup(signupBody).row, emailMatched: true, now: "n" });
  assert.equal(Object.hasOwn(without.changes, "notes"), false);
  const withNotes = planSubscriberUpdate({ stored, incoming: validateSignup({ ...signupBody, notes: "חדש" }).row, emailMatched: true, now: "n" });
  assert.equal(withNotes.changes.notes, "חדש");
  assert.equal(withNotes.lead.append_notes, "חדש");
  const merged = appendLeadNotes("הערה קיימת", "חדש", new Date("2026-11-13T10:00:00Z"));
  assert.equal(merged, "הערה קיימת\nהערות מטופס ההרשמה (13.11.2026): חדש");
  assert.equal(appendLeadNotes(merged, "חדש", new Date("2026-11-13T10:00:00Z")), merged);
});

test("Baruch's new-subscriber alert is short, with no technical details and no links", () => {
  const mail = internalAlertEmail({
    first_name: "דנה", last_name: "כהן", phone: "050-1234567", email: "d@x.com", categories: ["food"], regions: ["center"],
    looking_for: "מסעדה", budget_min: 500000, budget_max: 1000000, signup_channel: "vip", consent_email: true,
    address_form: "female", consent_at: "2026-11-13T09:40:00Z", signupKind: "new", notes: "<i>להתקשר אחרי 18:00</i>"
  });
  assert.equal(mail.subject, "עדכון מאלדד מנהל המערכת: נרשם חדש – דנה כהן");
  assert.equal(mail.from, INTERNAL_FROM);
  assert.equal(mail.from, '"עדכון מאלדד מנהל המערכת" <info@bsd-bbi.co.il>');
  assert.notEqual(SUBSCRIBER_FROM, INTERNAL_FROM);
  for (const label of ["שם פרטי: דנה", "שם משפחה: כהן", "טלפון: 050-1234567", "תחומי עניין:", "תאריך הרשמה: 13.11.2026 11:40", "תקציב: 500 אלף–1 מיליון", "הערות: <i>להתקשר אחרי 18:00</i>"]) {
    assert.ok(mail.text.includes(label), label);
  }
  assert.ok(mail.html.includes("&lt;i&gt;"));
  for (const banned of ["d@x.com", "VIP", "אימייל", "וואטסאפ", "נקבה", "http", "href", "token", "פרסומת"]) {
    assert.equal(mail.text.includes(banned) || mail.html.includes(banned), false, banned);
  }
  const bare = internalAlertEmail({ first_name: "רון", last_name: "לוי", phone: "050", signupKind: "new", consent_at: "2026-11-13T09:40:00Z", budget_open: false });
  assert.equal(bare.text.includes("תקציב"), false);
  assert.equal(bare.text.includes("הערות"), false);
});

test("request-details sends the PDF as an attachment, no signed link", () => {
  assert.equal(isPdfBytes(new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(isPdfBytes(new TextEncoder().encode("<html>")), false);
  assert.equal(attachmentName("BSD-B-2607-1015"), "BSD-anonymous-summary-1015.pdf");
  const copy = fileDetailsCopy({ firstName: "דנה", addressForm: "female", unsubscribeUrl: "https://u/x", slogan: "ס" });
  assert.equal(copy.subject.includes("פרסומת"), false);
  assert.ok(copy.text.includes("מצורף") && copy.text.includes("https://u/x"));
  const src = readFileSync("supabase/functions/business-alert-request-details/index.ts", "utf8");
  assert.equal(/createSignedUrl/.test(src), false);
  assert.match(src, /attachments/);
});
