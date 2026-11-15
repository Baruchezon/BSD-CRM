import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const sheet = require("../js/meetingPrepSheet.js");
const template = readFileSync("meeting-prep-sheet.template.html", "utf8");

test("a sample card renders both pages, with לבירור for fields that have no column", () => {
  const data = sheet.buildMeetingSheet({
    business: {
      id: "biz-1",
      owner_name: "אלי כהן",
      owner_phone: "052-3950967",
      owner_email: "eli.c.nadlan@gmail.com",
      business_number: "BSD-B-2611-1118",
      address: "הסבוראים 7",
      city: "תל אביב",
      field: "מספרה וקוסמטיקה",
      years_active: 20,
      annual_revenue: 500000,
      agreement_status: "אין הסכם",
      sale_reason: "רילוקיישן",
      public_listing_active: false,
      listing_status: "active",
      notes: "11.11 — נקבעה פגישה."
    },
    lead: { type: "seller", client_number: "BSD-SEL-20261110-002", full_name: "אלי כהן" },
    meetings: [],
    now: new Date("2026-11-15T06:00:00Z")
  });
  const html = sheet.renderHtml(template, data);
  assert.equal(html.includes("{{"), false);
  assert.equal((html.match(/<div class="page"/g) || []).length, 1);
  assert.equal((html.match(/<div class="page p2"/g) || []).length, 1);
  assert.match(html, /משביחים עסקים, מחברים הזדמנויות, מובילים עסקאות/);
  assert.match(html, /052-3950967/);
  assert.match(html, /500,000 ₪/);
  assert.match(html, /שכירות[\s\S]{0,120}לבירור/);
  assert.match(html, /עמלה[\s\S]{0,120}לבירור/);
  assert.match(html, /לקוחות[\s\S]{0,120}לבירור/);
  assert.match(html, /פתיחת תיק[\s\S]{0,120}לבירור/);
  assert.match(html, /מטרת הפגישה:[\s\S]{0,80}לבירור/);
  assert.match(html, /מקום הפגישה[\s\S]{0,160}לבירור/);
  assert.equal(data.facts.find(item => item.label === "מחיר מבוקש").unknown, true);
  assert.equal(data.facts.find(item => item.label === "עובדים").unknown, true);
  assert.equal(data.facts.find(item => item.label === "שם משפטי / ח.פ.").unknown, true);
});

test("the print buttons are on the business card and the seller card, and the old form stays", () => {
  const businesses = readFileSync("businesses.html", "utf8");
  const leads = readFileSync("leads.html", "utf8");
  assert.match(businesses, /meetingPrepSheet\.js\?v=202611150830/);
  assert.match(leads, /meetingPrepSheet\.js\?v=202611150830/);
  assert.match(businesses, /דף הכנה לפגישה \(הדפסה\)/);
  assert.match(leads, /דף הכנה לפגישה \(הדפסה\)/);
  assert.match(businesses, /BSDMeetingPrep\.open/);
  assert.match(businesses, /openFromBusiness/);
  assert.match(leads, /openFromSeller/);
});
