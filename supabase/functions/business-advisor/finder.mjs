// Advisor «finder» mode: match a visitor's sector/region/budget to PUBLISHED listings only.
// 15.11.2026, Baruch approved Roman's plan (extend the existing advisor, no new agent).
// Pure functions: no network, no DB. Uses the CRM matching taxonomy (_shared/taxonomy.mjs).
import {
  TAXONOMY, businessTaxonomy, categoryBySlug, classifyText, locationRelation, regionBySlug,
  regionLabel, regionsFromText, sectorRelation, subcategoryBySlug
} from "../_shared/taxonomy.mjs";

export const BUDGET_SLACK = 1.15;
export const MAX_MATCHES = 3;

const clean = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function parseBudget(v) {
  if (v === null || v === undefined || v === "" || v === false) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// category: a taxonomy slug (category or subcategory) or free Hebrew text («מאפייה», «מסעדה»).
export function querySide(category, region) {
  const cat = clean(category, 120);
  const reg = clean(region, 120);
  const side = { categories: [], subcategories: [], regions: [], open: false, excludedCategories: [], excludedSubcategories: [] };
  if (!cat || /^(all|any|הכל|כל תחום|פתוח)$/i.test(cat)) side.open = true;
  else if (categoryBySlug(cat)) side.categories = [cat];
  else if (subcategoryBySlug(cat)) { side.subcategories = [cat]; side.categories = [subcategoryBySlug(cat).category]; }
  else {
    const hit = classifyText({ field: cat });
    side.categories = hit.categories; side.subcategories = hit.subcategories;
    if (!hit.categories.length && !hit.subcategories.length) side.unknownCategory = cat;
  }
  if (reg && !/^(all|כל הארץ)$/i.test(reg)) side.regions = regionBySlug(reg) ? [reg] : regionsFromText(reg);
  return side;
}

const fmt = n => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
function money(n) { return n >= 1_000_000 ? `${fmt(n / 1_000_000)} מיליון` : `${fmt(n / 1000)} אלף`; }
export function priceBand(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return "פתוח להצעות";
  const step = p < 500_000 ? 100_000 : p < 1_000_000 ? 250_000 : p < 5_000_000 ? 500_000 : p < 10_000_000 ? 1_000_000 : 10_000_000;
  const lo = Math.floor(p / step) * step;
  const hi = lo + step;
  if (lo === 0) return `עד ${money(hi)} ₪`;
  const sameUnit = (lo >= 1_000_000) === (hi >= 1_000_000);
  return sameUnit
    ? `${fmt(lo >= 1_000_000 ? lo / 1_000_000 : lo / 1000)}–${money(hi)} ₪`
    : `${money(lo)} – ${money(hi)} ₪`;
}

export function businessUrlFromSitemap(xml, businessNumber) {
  if (!businessNumber) return "";
  const needle = `-${String(businessNumber).toLowerCase()}/`;
  for (const m of String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)) {
    if (m[1].toLowerCase().endsWith(needle)) return m[1].trim();
  }
  return "";
}

const SECTOR_WHY = {
  subcategory: "בדיוק בתחום שחיפשת", category: "בתחום שחיפשת", related: "בתחום משיק שכדאי להכיר", open: "עסק פעיל ומעניין",
};
function whyLine(sector, budget, loc) {
  const parts = [SECTOR_WHY[sector] || "עסק שכדאי להכיר"];
  if (budget === "open_budget" || budget === "open_budget_outlier") parts.push("ומתאים לתקציב פתוח");
  else if (budget === "within") parts.push("בתוך התקציב");
  else if (budget === "slightly_over") parts.push("מעט מעל התקציב, עם מקום לשיחה");
  else if (budget === "price_open") parts.push("המחיר פתוח להצעות");
  if (loc === "same" || loc === "all") parts.push("באזור שביקשת");
  else if (loc === "near") parts.push("באזור סמוך");
  return parts.length > 2 ? `${parts.slice(0, -1).join(", ")} ו${parts.at(-1)}.` : `${parts.join(", ")}.`;
}

export function listingSectorSide(b) {
  const structured = [b?.category, b?.subcategory, b?.field].map(v => String(v || "").trim()).filter(Boolean).join(" ");
  const text = structured || String(b?.anon_display_name || "").trim();
  const hit = classifyText({ field: text });
  return { categories: hit.categories, subcategories: hit.subcategories, text, from: structured ? "sector_fields" : "title" };
}

export function reasonableBand(prices) {
  const p = prices.filter(n => n > 0).sort((a, b) => a - b);
  if (p.length < 3) return null;
  const median = p.length % 2 ? p[(p.length - 1) / 2] : (p[p.length / 2 - 1] + p[p.length / 2]) / 2;
  return { median, lo: median / 4, hi: median * 4 };
}

// listings: rows of public_business_listings (already published-only, region not city).
export function findMatches(listings, { category, region, budget_max }, { sitemapXml = "", blockedNumbers = new Set() } = {}) {
  const q = querySide(category, region);
  const budget = parseBudget(budget_max);
  const scored = [];
  for (const b of listings || []) {
    if (!b?.business_number || !b?.anon_display_name || blockedNumbers.has(b.business_number)) continue;
    // v11: sector fit comes from the listing's structured sector fields (category/subcategory/field);
    // only when those are empty, from the public listing title. Description words are a weak tiebreaker
    // and are never enough alone to count as a sector fit.
    const sectorSide = listingSectorSide(b);
    const descSide = classifyText({ description: b.short_description });
    let sector, descHint = 0;
    if (q.unknownCategory) {
      const words = q.unknownCategory.split(/\s+/).filter(w => w.length >= 3);
      const hay = sectorSide.text;
      sector = words.some(w => hay.includes(w)) ? { kind: "category", ratio: 0.76 } : { kind: "none", ratio: 0 };
      descHint = words.some(w => String(b.short_description || "").includes(w)) ? 1 : 0;
    } else {
      sector = q.open ? { kind: "open", ratio: 0.44 } : sectorRelation(q, sectorSide);
      descHint = !q.open && sectorRelation(q, descSide).ratio > 0 ? 1 : 0;
    }
    if (sector.ratio <= 0) continue;
    const biz = businessTaxonomy({ region: b.region, short_description: b.short_description });
    const price = Number(b.asking_price) > 0 ? Number(b.asking_price) : null;
    let budgetKind, budgetScore;
    if (budget === null) { budgetKind = "open_budget"; budgetScore = 1; }
    else if (price === null) { budgetKind = "price_open"; budgetScore = 0.7; }
    else if (price <= budget) { budgetKind = "within"; budgetScore = 1; }
    else if (price <= budget * BUDGET_SLACK) { budgetKind = "slightly_over"; budgetScore = 0.6; }
    else continue;
    const bizRegions = biz.regions?.length ? biz.regions : regionsFromText(b.region || "");
    const loc = locationRelation(q.regions, bizRegions);
    scored.push({
      b, sector, budgetKind, loc, bizRegions,
      price, descHint,
      key: [sector.ratio, budgetScore, loc.ratio, price && budget ? -Math.abs(budget - price) / budget : 0, descHint],
    });
  }
  // v11 open budget: prefer listings inside a reasonable price band (¼× … 4× the median asking price of
  // the sector-fit candidates); outliers (e.g. a 90M hotel among 0.5–1M businesses) rank lower.
  if (budget === null) {
    const band = reasonableBand(scored.map(x => x.price).filter(Boolean));
    for (const x of scored) {
      const inBand = x.price === null ? 0.7 : !band || (x.price >= band.lo && x.price <= band.hi) ? 1 : 0.4;
      x.key[1] = inBand;
      x.key[3] = x.price && band ? -Math.abs(Math.log(x.price / band.median)) : 0;
      if (inBand === 0.4) x.budgetKind = "open_budget_outlier";
    }
  }
  scored.sort((x, y) => { for (let i = 0; i < x.key.length; i++) if (y.key[i] !== x.key[i]) return y.key[i] - x.key[i]; return 0; });
  const top = scored.slice(0, MAX_MATCHES);
  const matches = top.map(({ b, sector, budgetKind, loc, bizRegions }) => ({
    listing_number: b.business_number,
    title: b.anon_display_name,
    category: String(b.subcategory || b.category || b.field || "").trim(),
    region: (b.region || "").trim() || (bizRegions[0] ? regionLabel(bizRegions[0]) : "") || "לא צוין",
    price_range: priceBand(b.asking_price),
    url: businessUrlFromSitemap(sitemapXml, b.business_number) || "https://www.bsd-bbi.co.il/%D7%A2%D7%A1%D7%A7%D7%99%D7%9D-%D7%9C%D7%9E%D7%9B%D7%99%D7%A8%D7%94/",
    why: whyLine(sector.kind, budgetKind, loc.kind),
  }));
  const message = matches.length
    ? `${matches.length === 1 ? "מצאנו עסק אחד שיכול" : `מצאנו ${matches.length} עסקים שיכולים`} להתאים לחיפוש. אפשר להשאיר שם וטלפון ונחזור עם פרטים נוספים.`
    : "כרגע אין עסק מפורסם שמתאים בדיוק לחיפוש. אפשר להשאיר שם וטלפון ונעדכן כשיעלה עסק מתאים.";
  return { matches, message, query: { categories: q.categories, subcategories: q.subcategories, regions: q.regions, open: q.open, budget_max: budget } };
}

// Anonymity guard: a public title must not contain a distinctive word of the real/legal name.
const GENERIC = new Set(["עסק", "בתחום", "חברת", "חברה", "בית", "מרכז", "חנות", "רשת", "בע\"מ", "בעמ", "שירותי", "ושיווק", "ייבוא", "מסחר", "קבוצת", "מסעדה", "מסעדת", "מלון", "מספרה", "סטודיו", "ישראל", "הנדסה", "מפעל", "ייצור", "ושירותים", "בניה", "בנייה", "the", "and", "ltd",
  // descriptive trade words seen in internal names (15.11 review of all 29 published titles: none leaked a real name)
  "מטבחים", "חשמל", "שווארמה", "פירות", "ירקות", "אחזקת", "מבנים", "מיבנים", "מתנות", "ומוצרי", "פופ", "כלבים", "חתולים", "מיספרת", "מספרת", "אופנה", "צנועה", "בוטיק", "לוטו", "טוטו", "מינימרקט", "קיוסק", "התקנות", "מערכות", "מוסך", "מוניות", "אסתטיקה", "מאפיית", "מאפייה", "מים", "טורס", "יזמות"]);
for (const c of TAXONOMY.categories) for (const w of [c.label, ...(c.sub || []).map(s => s.label)].join(" ").split(/[\s,/]+/)) GENERIC.add(w);
export function titleLeaksName(title, names) {
  const t = String(title || "").toLowerCase();
  for (const name of names || []) {
    for (const w of String(name || "").toLowerCase().split(/[\s,.()"'״׳\-–/]+/)) {
      if (w.length >= 3 && !GENERIC.has(w) && !GENERIC.has(w.replace(/^[והבלמש]/, "")) && t.includes(w)) return w;
    }
  }
  return "";
}

// Shown listing numbers sent back with a lead (finder or website form).
export function normalizeBusinessNumbers(v) {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : [];
  const out = [];
  for (const x of arr) {
    const m = String(x || "").toUpperCase().match(/BSD-B-\d{4}-\d{3,5}/);
    if (m && !out.includes(m[0])) out.push(m[0]);
    if (out.length >= 5) break;
  }
  return out;
}

export { regionLabel };
