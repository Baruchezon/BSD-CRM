// Canonical sector and region list for the website form and alert matching.
// The JSON file is the source. Slugs are what the form sends.
import taxonomy from "./taxonomy-v1.json" with { type: "json" };
import { regionOf } from "../match-suggestions-report/engine.js";

export const TAXONOMY = taxonomy;
export const TAXONOMY_VERSION = taxonomy.version;

const categories = taxonomy.categories;
const regions = taxonomy.regions;

export function categoryBySlug(slug) {
  return categories.find(item => item.slug === slug) || null;
}

export function subcategoryBySlug(slug) {
  for (const category of categories) {
    const sub = (category.sub || []).find(item => item.slug === slug);
    if (sub) return { ...sub, category: category.slug };
  }
  return null;
}

export function regionBySlug(slug) {
  return regions.find(item => item.slug === slug) || null;
}

export function categorySlugs() {
  return categories.map(item => item.slug);
}

export function subcategorySlugs() {
  return categories.flatMap(item => (item.sub || []).map(sub => sub.slug));
}

export function regionSlugs() {
  return regions.map(item => item.slug);
}

export function flagSlugs() {
  return (taxonomy.flags || []).map(item => item.slug);
}

export function flagLabel(slug) {
  return (taxonomy.flags || []).find(item => item.slug === slug)?.label || slug || "";
}

const LEGACY_INTEREST = {
  "מזון": { categories: ["food"] },
  "תעשייה": { categories: ["construction"], subcategories: ["manufacturing"] },
  "שירותים": { categories: ["services"] },
  "קמעונאות": { categories: ["retail"] },
  "בריאות ואסתטיקה": { categories: ["beauty", "health"] },
  "הסעות ותיירות": { categories: ["services"], subcategories: ["transport_tourism"] },
  "טכנולוגיה ואונליין": { categories: ["retail", "services"], subcategories: ["ecommerce", "software_web"] },
  "פנאי וילדים": { categories: ["education_leisure"] },
  "כל התחומים": { open: true }
};

// Messy CRM phrases that are not the taxonomy label itself.
const PHRASES = [
  ["המבורגר", ["food"], ["restaurant", "fast_food"]],
  ["פיצה", ["food"], ["restaurant", "fast_food"]],
  ["שווארמה", ["food"], ["restaurant", "fast_food"]],
  ["פלאפל", ["food"], ["restaurant", "fast_food"]],
  ["מזון מהיר", ["food"], ["fast_food"]],
  ["מסעדה", ["food"], ["restaurant"]],
  ["בית קפה", ["food"], ["cafe"]],
  ["בתי קפה", ["food"], ["cafe"]],
  ["מאפייה", ["food"], ["bakery"]],
  ["מאפיה", ["food"], ["bakery"]],
  ["קייטרינג", ["food"], ["catering"]],
  ["הסעדה", ["food"], ["catering"]],
  ["פאב", ["food"], ["pub_bar"]],
  ["ייצור מזון", ["food"], ["food_production"]],
  ["מינימרקט", ["grocery"], ["minimarket"]],
  ["סופרמרקט", ["grocery"], ["supermarket"]],
  ["סופר", ["grocery"], ["supermarket"]],
  ["מכולת", ["grocery"], ["minimarket"]],
  ["ירקות", ["grocery"], ["produce"]],
  ["מעדנייה", ["grocery"], ["deli"]],
  ["מעדניה", ["grocery"], ["deli"]],
  ["אופנה", ["retail"], ["fashion"]],
  ["הלבשה", ["retail"], ["fashion"]],
  ["חנות", ["retail"], ["general_store"]],
  ["אונליין", ["retail"], ["ecommerce"]],
  ["איקומרס", ["retail"], ["ecommerce"]],
  ["ייבוא", ["wholesale"], ["import"]],
  ["יבוא", ["wholesale"], ["import"]],
  ["סיטונאות", ["wholesale"], ["wholesale"]],
  ["הפצה", ["wholesale"], ["distribution"]],
  ["מספרה", ["beauty"], ["hair_salon"]],
  ["קוסמטיקה", ["beauty"], ["cosmetics"]],
  ["ציפורניים", ["beauty"], ["nails"]],
  ["אסתטיקה", ["beauty"], ["medical_aesthetics"]],
  ["מרפאה", ["health"], ["clinic"]],
  ["קליניקה", ["health"], ["clinic"]],
  ["כושר", ["health"], ["fitness"]],
  ["סטודיו", ["health"], ["fitness"]],
  ["מוסך", ["auto"], ["garage"]],
  ["שטיפת רכב", ["auto"], ["car_wash"]],
  ["קבלנות", ["construction"], ["contracting"]],
  ["קבלן", ["construction"], ["contracting"]],
  ["מיזוג", ["construction"], ["hvac_electric"]],
  ["מפעל", ["construction"], ["manufacturing"]],
  ["תעשייה", ["construction"], ["manufacturing"]],
  ["תעשיה", ["construction"], ["manufacturing"]],
  ["ייצור", ["construction"], ["manufacturing"]],
  ["אחזקה", ["services"], ["cleaning_maintenance"]],
  ["ניקיון", ["services"], ["cleaning_maintenance"]],
  ["הסעות", ["services"], ["transport_tourism"]],
  ["תיירות", ["services"], ["transport_tourism"]],
  ["תוכנה", ["services"], ["software_web"]],
  ["אתרים", ["services"], ["software_web"]],
  ["שיווק", ["services"], ["marketing_digital"]],
  ["גן ילדים", ["education_leisure"], ["kindergarten"]],
  ["צהרון", ["education_leisure"], ["kindergarten"]],
  ["חוגים", ["education_leisure"], ["classes"]],
  ["משחקייה", ["education_leisure"], ["leisure"]],
  ["פנאי", ["education_leisure"], ["leisure"]],
  ["זכיינות", [], [], ["franchise"]]
];

export function classifyText(parts) {
  const text = [parts?.category, parts?.subcategory, parts?.field, parts?.description, parts?.region].filter(Boolean).join(" ");
  const categoriesFound = new Set();
  const subcategories = new Set();
  const flags = new Set();
  const add = (cats, subs, flagList) => {
    (cats || []).forEach(slug => categoriesFound.add(slug));
    (subs || []).forEach(slug => subcategories.add(slug));
    (flagList || []).forEach(slug => flags.add(slug));
  };
  for (const category of categories) {
    if (text.includes(category.label)) categoriesFound.add(category.slug);
    for (const sub of category.sub || []) {
      if (text.includes(sub.label)) {
        categoriesFound.add(category.slug);
        subcategories.add(sub.slug);
      }
    }
  }
  const ordered = [...PHRASES].sort((a, b) => b[0].length - a[0].length);
  const hits = ordered.filter(([phrase]) => text.includes(phrase));
  for (const [phrase, cats, subs, flagList] of hits) {
    if (hits.some(([other]) => other !== phrase && other.includes(phrase))) continue;
    add(cats, subs, flagList);
  }
  for (const slug of subcategories) {
    const found = subcategoryBySlug(slug);
    if (found) categoriesFound.add(found.category);
  }
  return {
    categories: [...categoriesFound],
    subcategories: [...subcategories],
    regions: regionsFromText(parts?.region || text),
    flags: [...flags]
  };
}

export function regionsFromText(text) {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  if (raw.includes("כל הארץ")) return ["all"];
  const found = new Set();
  for (const region of regions) {
    if (region.slug !== "all" && raw.includes(region.label)) found.add(region.slug);
  }
  if (/תל אביב/.test(raw)) found.add("tel_aviv");
  if (/גוש דן|מרכז/.test(raw)) found.add("center");
  const engine = regionOf(raw);
  if (engine?.region && engine.region !== "center") found.add(engine.region);
  if (engine?.region === "center" && !found.has("tel_aviv")) found.add("center");
  return [...found];
}

export function subscriberTaxonomy(subscriber) {
  const categoriesFound = new Set(validSlugs(subscriber.categories, categorySlugs()));
  const subcategories = new Set(validSlugs(subscriber.subcategories, subcategorySlugs()));
  const regionList = new Set(validSlugs(subscriber.regions, regionSlugs()));
  let open = false;
  if (!categoriesFound.size && !subcategories.size) {
    for (const interest of subscriber.interests || []) {
      const mapped = LEGACY_INTEREST[interest];
      if (!mapped) continue;
      if (mapped.open) open = true;
      (mapped.categories || []).forEach(slug => categoriesFound.add(slug));
      (mapped.subcategories || []).forEach(slug => subcategories.add(slug));
    }
  }
  if (!regionList.size) regionsFromText(subscriber.region || "").forEach(slug => regionList.add(slug));
  const excludedCategories = new Set();
  const excludedSubcategories = new Set();
  const notes = String(subscriber.looking_for || "");
  for (const match of notes.matchAll(/(?:לא|בלי|ללא|מלבד)\s+([^\s,.]{2,})/g)) {
    const word = match[1];
    if (word.startsWith("מזון") || word === "אוכל") excludedCategories.add("food");
    const hit = classifyText({ field: word });
    if (hit.subcategories.length) hit.subcategories.forEach(slug => excludedSubcategories.add(slug));
    else hit.categories.forEach(slug => excludedCategories.add(slug));
  }
  excludedCategories.forEach(slug => categoriesFound.delete(slug));
  excludedSubcategories.forEach(slug => subcategories.delete(slug));
  return {
    categories: [...categoriesFound],
    subcategories: [...subcategories],
    regions: [...regionList],
    open,
    excludedCategories: [...excludedCategories],
    excludedSubcategories: [...excludedSubcategories]
  };
}

export function businessTaxonomy(business) {
  const stored = business?.taxonomy;
  if (stored && (stored.categories || stored.subcategories || stored.regions)) {
    return {
      categories: stored.categories || [],
      subcategories: stored.subcategories || [],
      regions: stored.regions || [],
      flags: stored.flags || []
    };
  }
  return classifyText({
    category: business?.category,
    subcategory: business?.subcategory,
    field: business?.field,
    description: business?.short_description || business?.anon_summary,
    region: [business?.region, business?.city].filter(Boolean).join(" ")
  });
}

function validSlugs(value, allowed) {
  const ok = new Set(allowed);
  return (Array.isArray(value) ? value : []).filter(slug => ok.has(slug));
}

export function sectorRelation(subscriberSide, businessSide) {
  const bizCats = new Set(businessSide.categories || []);
  const bizSubs = new Set(businessSide.subcategories || []);
  for (const slug of subscriberSide.excludedCategories || []) {
    if (bizCats.has(slug)) return { kind: "excluded", ratio: 0 };
    if ([...bizSubs].some(sub => subcategoryBySlug(sub)?.category === slug)) return { kind: "excluded", ratio: 0 };
  }
  for (const slug of subscriberSide.excludedSubcategories || []) {
    if (bizSubs.has(slug)) return { kind: "excluded", ratio: 0 };
  }
  if (subscriberSide.open && !subscriberSide.categories.length && !subscriberSide.subcategories.length) {
    return { kind: "open", ratio: 0.44 };
  }
  if ((subscriberSide.subcategories || []).some(slug => bizSubs.has(slug))) return { kind: "subcategory", ratio: 1 };
  if ((subscriberSide.categories || []).some(slug => bizCats.has(slug))) return { kind: "category", ratio: 0.76 };
  const related = (subscriberSide.categories || []).some(slug => {
    const item = categoryBySlug(slug);
    return (item?.related || []).some(rel => bizCats.has(rel));
  });
  if (related) return { kind: "related", ratio: 0.32 };
  return { kind: "none", ratio: 0 };
}

export function locationRelation(subscriberRegions, businessRegions) {
  const wanted = new Set(subscriberRegions || []);
  const found = new Set(businessRegions || []);
  if (!wanted.size) return { kind: "unknown", ratio: 0.6 };
  if (wanted.has("all")) return { kind: "all", ratio: 1 };
  if ([...wanted].some(slug => found.has(slug))) return { kind: "same", ratio: 1 };
  const near = [...wanted].some(slug => {
    const item = regionBySlug(slug);
    return (item?.near || []).some(neighbour => found.has(neighbour));
  });
  if (near) return { kind: "near", ratio: 0.5 };
  if (!found.size) return { kind: "unknown", ratio: 0.4 };
  return { kind: "far", ratio: 0.2 };
}

export function regionLabel(slug) {
  return regionBySlug(slug)?.label || slug || "";
}
