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
      short_description: "מספרה משפחתית ברמת אביב הירוקה.",
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
  assert.match(html, /font-size:14\.25pt/);
  assert.match(html, /font-size:16pt/);
  assert.equal((html.match(/<div class="q">/g) || []).length, 7);
  assert.equal((html.match(/<div class="ln"><\/div>/g) || []).length, 7);
  assert.match(html, /052-3950967/);
  assert.match(html, /נתונים שנמסרו בשיחה/);
  assert.match(html, /כמה מילים על העסק/);
  assert.match(html, /נוכחות ברשת/);
  assert.match(html, /חקר שוק קצר/);
  assert.match(html, /מספרה משפחתית ברמת אביב הירוקה/);
  assert.match(html, /11\.11 — נקבעה פגישה/);
  assert.match(html, /לבירור:[\s\S]{0,200}עמלה/);
  assert.match(html, /חוזה שכירות/);
  assert.match(html, /פתיחת תיק[\s\S]{0,80}לבירור/);
  assert.match(html, /מטרת הפגישה:[\s\S]{0,80}רילוקיישן/);
  assert.match(html, /נוכחות ברשת[\s\S]{0,280}לבירור/);
  assert.match(html, /חקר שוק קצר[\s\S]{0,280}לבירור/);
  assert.equal(html.includes('class="src"'), false);
  assert.equal(data.facts.find(item => item.label === "מחיר מבוקש").unknown, true);
});

function cutIsAtBoundary(source, shown) {
  if (!shown || !shown.includes("…")) return true;
  const head = shown.slice(0, shown.indexOf("…")).trimEnd();
  const normalized = String(source).replace(/\s+/g, " ");
  if (!normalized.startsWith(head)) return false;
  const next = normalized.charAt(head.length);
  return next === "" || /\s/.test(next) || /[.!?]/.test(head.slice(-1));
}

test("a card like 1104 prints price, employees and company number without cutting a word", () => {
  const longWord = "מספרהמשפחתיתברמתאביבהירוקהעםלקוחותקבועיםוקוסמטיקה";
  const description = "מספרה משפחתית ברמת אביב. " + longWord + " המשך שלא ייכנס באמצע מילה. " + "מילה ".repeat(80);
  const research = "מכפיל 1.5 עד 2.5, ראו https://example.com/report. מודעה של 300,000 ₪. תחרות בטאגור. סיכון לקוחות נאמנים.";
  const business = {
    id: "biz-1104",
    business_number: "BSD-B-2610-1104",
    owner_name: "בעל העסק",
    asking_price: 4000000,
    employees_count: 10,
    id_number: "516000110",
    sale_reason: "רילוקיישן",
    short_description: description,
    pre_research: research,
    agreement_status: "אין הסכם",
    notes: "שיחה קצרה עם ברוך."
  };
  const data = sheet.buildMeetingSheet({
    business,
    meetings: [{ meeting_date: "2026-11-20", start_time: "10:00", meeting_type: "פגישת היכרות", notes: "לאשר נתונים", deleted_at: null }],
    now: new Date("2026-11-15T06:00:00Z")
  });
  const html = sheet.renderHtml(template, data);
  assert.equal(html.includes("{{"), false);
  assert.match(html, /4,000,000 ₪/);
  assert.match(html, />10</);
  assert.match(html, /516000110/);
  assert.match(html, /סיבת מכירה: רילוקיישן/);
  assert.equal(cutIsAtBoundary(description, data.business_blurb.split("\n").slice(1).join("\n")), true);
  assert.equal(data.business_blurb.includes(longWord + "ה"), false);
  data.market_research.forEach(line => assert.equal(cutIsAtBoundary(research, line.replace(/…$/, "")), true));
  assert.ok(data.market_research.length >= 3 && data.market_research.length <= 4);
  assert.match(html, /<bdi dir="ltr">https:\/\/example.com\/report<\/bdi>/);
  assert.equal(html.includes('class="src"'), true);
  assert.equal(data.purpose, "פגישת היכרות");
  const quiet = sheet.buildMeetingSheet({ business: { id: "x", owner_name: "א", sale_reason: "פרישה" }, meetings: [], now: new Date("2026-11-15T06:00:00Z") });
  const quietHtml = sheet.renderHtml(template, quiet);
  assert.equal(quietHtml.includes('class="src"'), false);
  assert.equal(quiet.purpose, "פרישה");
  const lead = { id: "lead-1104", type: "seller", full_name: "בעל העסק", phone: "052-0000000" };
  const linked = sheet.findLinkedBusiness(lead, [{ id: "other" }, { id: "biz-1104", seller_id: "lead-1104", ...business }]);
  const sellerSheet = sheet.buildMeetingSheet({ business: linked, lead, meetings: [], now: new Date("2026-11-15T06:00:00Z") });
  assert.equal(sellerSheet.business_code, "BSD-B-2610-1104");
  assert.match(sheet.renderHtml(template, sellerSheet), /4,000,000 ₪/);
  assert.match(readFileSync("js/meetingPrepSheet.js", "utf8"), /document\.fonts\.ready/);
  assert.match(readFileSync("js/meetingPrepSheet.js", "utf8"), /seller_id/);
});

test("the print buttons are on the business card and the seller card, and the old form stays", () => {
  const businesses = readFileSync("businesses.html", "utf8");
  const leads = readFileSync("leads.html", "utf8");
  assert.match(businesses, /meetingPrepSheet\.js\?v=202611151010/);
  assert.match(leads, /meetingPrepSheet\.js\?v=202611151010/);
  assert.match(businesses, /דף הכנה לפגישה \(הדפסה\)/);
  assert.match(leads, /דף הכנה לפגישה \(הדפסה\)/);
  assert.match(businesses, /BSDMeetingPrep\.open/);
  assert.match(businesses, /openFromBusiness/);
  assert.match(leads, /openFromSeller/);
});
