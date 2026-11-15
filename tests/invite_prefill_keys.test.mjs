import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { invitePrefillKeys } from "../supabase/functions/_shared/invite-prefill-keys.mjs";
import { publicPrefill } from "../supabase/functions/_shared/business-alert-invite.mjs";

function keys(text, area = "") {
  return invitePrefillKeys({ requested_categories: text, requested_area: area });
}

test("CRM phrases become signup slugs, and ambiguous food words are dropped", () => {
  const grocery = keys("קמעונאות מזון, קמנאות; קמאונאות מזון");
  assert.deepEqual(grocery.categories, ["grocery"]);
  assert.deepEqual(grocery.subcategories, []);
  assert.deepEqual(grocery.category_labels, ["קמעונאות מזון"]);

  const shop = keys("סופרמרקט/סופמרקט");
  assert.deepEqual(shop.categories, ["grocery"]);
  assert.deepEqual(shop.subcategories, ["supermarket"]);

  assert.deepEqual(keys("מסחר וקמעונאות").categories, ["retail"]);
  assert.deepEqual(keys("מסעדה").categories, ["food"]);
  assert.deepEqual(keys("מסעדה").subcategories, ["restaurant"]);
  assert.deepEqual(keys("בית קפה").subcategories, ["cafe"]);
  assert.deepEqual(keys("מאפיה").subcategories, ["bakery"]);
  assert.deepEqual(keys("קליניקות/מרפאה"), {
    categories: ["health"],
    subcategories: ["clinic"],
    regions: [],
    category_labels: ["בריאות וטיפול"],
    region_labels: []
  });

  const dropped = keys("מזון، קמעונאות");
  assert.deepEqual(dropped.categories, []);
  assert.deepEqual(dropped.subcategories, []);
});

test("area phrases map to region slugs, and a mixed token is omitted", () => {
  for (const area of ["גוש דן", "מרכז", "רמת גן", "פתח תקווה", "חולון"]) {
    const hit = keys("", area);
    assert.deepEqual(hit.regions, ["center"], area);
    assert.deepEqual(hit.region_labels, ["מרכז וגוש דן"], area);
  }
  assert.deepEqual(keys("", "תל אביב והמרכז").regions, ["tel_aviv", "center"]);
  assert.deepEqual(keys("", "כל הארץ").regions, ["all"]);
  assert.deepEqual(keys("", "תל אביב").regions, ["tel_aviv"]);
  assert.deepEqual(keys("מסעדה וסופרמרקט").categories, []);
  assert.deepEqual(keys("מספרה").categories, ["beauty"]);
  assert.deepEqual(keys("מספרה").subcategories, ["hair_salon"]);
});

test("the public prefill is taxonomy keys and a number budget, with no internal id", () => {
  const shown = publicPrefill({
    id: "secret",
    prefill: {
      first_name: "דנה",
      last_name: "לוי",
      phone: "050-1234567",
      email: "dana@example.com",
      requested_categories: "מסעדה / בית קפה",
      requested_field: "מאפיה",
      requested_area: "תל אביב והמרכז — כל הארץ",
      budget: "500000"
    }
  });
  assert.deepEqual(shown.categories, ["food"]);
  assert.deepEqual(shown.subcategories, ["restaurant", "cafe", "bakery"]);
  assert.deepEqual(shown.regions, ["tel_aviv", "center", "all"]);
  assert.equal(shown.budget, 500000);
  assert.equal(Object.hasOwn(shown, "id"), false);
  assert.equal(publicPrefill({ prefill: { budget: "" } }).budget, null);
  assert.equal(publicPrefill({ prefill: { budget: "לא מספר" } }).budget, null);
});

test("resolve looks up a short code and the preview origin is removed again", () => {
  const resolve = readFileSync("supabase/functions/business-alert-invite-resolve/index.ts", "utf8");
  const signup = readFileSync("supabase/functions/business-alert-signup/index.ts", "utf8");
  const origin = "https://cursor-invite-link-prefill-f01e-lively-wood-e2c6.baruch-ezon.workers.dev";
  assert.equal(resolve.includes(origin), false);
  assert.equal(signup.includes(origin), false);
  assert.match(resolve, /isShortCode\(token\) && token\.length === 7/);
  assert.match(resolve, /\.eq\("short_code", token\)/);
});
