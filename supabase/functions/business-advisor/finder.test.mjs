import assert from "node:assert/strict";
import { findMatches, priceBand, querySide, titleLeaksName, normalizeBusinessNumbers, parseBudget } from "./finder.mjs";
const L = [
  { business_number: "BSD-B-2607-1001", anon_display_name: "מסעדה בסגנון ים תיכוני", category: "מזון ומסעדנות", subcategory: "מסעדה", field: "מסעדה", region: "מרכז", asking_price: 1200000 },
  { business_number: "BSD-B-2607-1002", anon_display_name: "בית קפה שכונתי", category: "מזון ומסעדנות", subcategory: "בית קפה", field: "בית קפה", region: "שרון", asking_price: null },
  { business_number: "BSD-B-2607-1003", anon_display_name: "מוסך מורשה", category: "רכב", subcategory: "מוסך", field: "מוסך", region: "מרכז", asking_price: 900000 },
  { business_number: "BSD-B-2607-1004", anon_display_name: "מאפייה ותיקה", category: "מזון ומסעדנות", subcategory: "מאפייה", field: "מאפייה", region: "דרום", asking_price: 2000000 },
];
let r = findMatches(L, { category: "bakery", region: "center", budget_max: 1100000 });
assert.deepEqual(r.matches.map(m => m.listing_number).sort(), ["BSD-B-2607-1001", "BSD-B-2607-1002"]); // bakery≈restaurant/cafe, 1.2M ≤ 1.1M*1.15, 2M excluded
assert.match(r.matches.find(m => m.listing_number === "BSD-B-2607-1001").why, /מעל התקציב/);
r = findMatches(L, { category: "מאפייה", region: "דרום", budget_max: null });
assert.equal(r.matches[0].listing_number, "BSD-B-2607-1004");
assert.equal(r.matches.length, 3);
r = findMatches(L, { category: "מוסך", region: "", budget_max: 100000 });
assert.equal(r.matches.length, 0); assert.match(r.message, /כרגע אין/);
assert.equal(priceBand(1200000), "1–1.5 מיליון ₪");
assert.equal(priceBand(null), "פתוח להצעות");
assert.equal(priceBand(650000), "500–750 אלף ₪");
assert.equal(priceBand(950000), "750 אלף – 1 מיליון ₪");
assert.equal(priceBand(80000), "עד 100 אלף ₪");
assert.equal(titleLeaksName("מסעדה בסגנון ים תיכוני", ["מסעדת דג הזהב בע\"מ"]), "");
assert.equal(titleLeaksName("קפה רוטשילד", ["רוטשילד קפה בעמ"]), "רוטשילד");
assert.deepEqual(normalizeBusinessNumbers(["bsd-b-2607-1001", "x", "BSD-B-2607-1001", "BSD-B-2608-1028"]), ["BSD-B-2607-1001", "BSD-B-2608-1028"]);
assert.equal(parseBudget("1,500,000"), 1500000); assert.equal(parseBudget(null), null);
assert.equal(querySide("", "").open, true);
console.log("finder tests ok");
