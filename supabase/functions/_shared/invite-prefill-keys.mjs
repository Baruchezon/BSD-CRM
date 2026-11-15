// CRM free text on an invite becomes the signup form's taxonomy slugs.
// Exact taxonomy-v1 labels win, then a short list of CRM phrasings, then the
// matcher only when it finds exactly one category. Bare מזון is ambiguous;
// bare קמעונאות maps to retail (Roman, 15.11).
import taxonomy from "./taxonomy-v1.json" with { type: "json" };
import { classifyText, subcategoryBySlug } from "./taxonomy.mjs";

const SPLIT = /[,،;/—]+/;
const AMBIGUOUS = new Set(["מזון"]);

const categoryByLabel = new Map(taxonomy.categories.map(item => [item.label, item.slug]));
const regionByLabel = new Map(taxonomy.regions.map(item => [item.label, item.slug]));
const categoryLabelBySlug = new Map(taxonomy.categories.map(item => [item.slug, item.label]));
const regionLabelBySlug = new Map(taxonomy.regions.map(item => [item.slug, item.label]));
const categorySlugSet = new Set(categoryLabelBySlug.keys());
const regionSlugSet = new Set(regionLabelBySlug.keys());
const subcategoryParent = new Map();
for (const category of taxonomy.categories) {
  for (const sub of category.sub || []) subcategoryParent.set(sub.slug, category.slug);
}

const PHRASES = new Map([
  ["קמעונאות מזון", { categories: ["grocery"] }],
  ["קמנאות", { categories: ["grocery"] }],
  ["קמאונאות מזון", { categories: ["grocery"] }],
  ["סופרמרקט", { categories: ["grocery"], subcategories: ["supermarket"] }],
  ["סופמרקט", { categories: ["grocery"], subcategories: ["supermarket"] }],
  ["מסחר וקמעונאות", { categories: ["retail"] }],
  ["קמעונאות", { categories: ["retail"] }],
  ["מסעדה", { categories: ["food"], subcategories: ["restaurant"] }],
  ["בית קפה", { categories: ["food"], subcategories: ["cafe"] }],
  ["מאפיה", { categories: ["food"], subcategories: ["bakery"] }],
  ["קליניקות", { categories: ["health"], subcategories: ["clinic"] }],
  ["מרפאה", { categories: ["health"], subcategories: ["clinic"] }],
  ["גוש דן", { regions: ["center"] }],
  ["מרכז", { regions: ["center"] }],
  ["רמת גן", { regions: ["center"] }],
  ["פתח תקווה", { regions: ["center"] }],
  ["חולון", { regions: ["center"] }],
  ["תל אביב והמרכז", { regions: ["tel_aviv", "center"] }],
  ["כל הארץ", { regions: ["all"] }]
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tokensFrom(value, into) {
  if (Array.isArray(value)) {
    value.forEach(item => tokensFrom(item, into));
    return;
  }
  const text = clean(value);
  if (!text) return;
  for (const part of text.split(SPLIT)) {
    const token = clean(part);
    if (token) into.push(token);
  }
}

function exactHit(token) {
  if (categoryByLabel.has(token)) return { categories: [categoryByLabel.get(token)] };
  for (const category of taxonomy.categories) {
    const sub = (category.sub || []).find(item => item.label === token);
    if (sub) return { categories: [category.slug], subcategories: [sub.slug] };
  }
  if (regionByLabel.has(token)) return { regions: [regionByLabel.get(token)] };
  return null;
}

function slugHit(token) {
  if (categorySlugSet.has(token)) return { categories: [token] };
  if (subcategoryParent.has(token)) return { categories: [subcategoryParent.get(token)], subcategories: [token] };
  if (regionSlugSet.has(token)) return { regions: [token] };
  return null;
}

function matcherHit(token) {
  const hit = classifyText({ field: token });
  const categories = [...new Set(hit.categories || [])];
  if (categories.length !== 1) return null;
  const category = categories[0];
  const subcategories = [...new Set(hit.subcategories || [])].filter(slug => subcategoryBySlug(slug)?.category === category);
  return { categories: [category], subcategories };
}

function apply(bucket, hit) {
  for (const slug of hit.categories || []) if (!bucket.categories.includes(slug)) bucket.categories.push(slug);
  for (const slug of hit.subcategories || []) if (!bucket.subcategories.includes(slug)) bucket.subcategories.push(slug);
  for (const slug of hit.regions || []) if (!bucket.regions.includes(slug)) bucket.regions.push(slug);
}

export function invitePrefillKeys(input) {
  const tokens = [];
  tokensFrom(input?.requested_categories, tokens);
  tokensFrom(input?.requested_field, tokens);
  tokensFrom(input?.requested_area, tokens);
  tokensFrom(input?.categories, tokens);
  tokensFrom(input?.regions, tokens);
  const bucket = { categories: [], subcategories: [], regions: [] };
  for (const token of tokens) {
    if (AMBIGUOUS.has(token)) continue;
    const hit = exactHit(token) || PHRASES.get(token) || slugHit(token) || matcherHit(token);
    if (hit) apply(bucket, hit);
  }
  return {
    categories: bucket.categories,
    subcategories: bucket.subcategories,
    regions: bucket.regions,
    category_labels: bucket.categories.map(slug => categoryLabelBySlug.get(slug) || slug),
    region_labels: bucket.regions.map(slug => regionLabelBySlug.get(slug) || slug)
  };
}

export function budgetNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
