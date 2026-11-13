import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateSignup } from '../supabase/functions/business-alert-signup/logic.mjs';
import { businessTaxonomy, locationRelation, regionsFromText } from '../supabase/functions/_shared/taxonomy.mjs';
import { CONSENT_TEXT_VERSION } from '../supabase/functions/business-alert-signup/logic.mjs';
import {
  DEFAULT_MATCH_CONFIG,
  budgetWindow,
  matchAlertEmail,
  parseAlertBudget,
  publicCard,
  scoreAlert,
  sendGate
} from '../supabase/functions/_shared/alert-match.mjs';

const baseSub = {
  id: 'sub-1',
  first_name: 'דנה',
  last_name: 'לוי',
  interests: ['מזון'],
  region: 'חיפה והקריות',
  budget_min: 1000000,
  budget_max: 1000000,
  budget_open: false,
  looking_for: '',
  legacy_no_consent: false,
  consent_general: true,
  consent_email: true
};

const biz = (over = {}) => ({
  id: over.id || 'biz-1',
  internal_name: over.internal || 'מאפיית השם האמיתי',
  anon_display_name: over.anon || 'מאפייה בשרון',
  business_number: over.number || '440',
  field: over.field || 'מאפייה',
  category: over.category || '',
  city: over.city || 'חיפה',
  region: over.region || 'חיפה והקריות',
  asking_price: over.price ?? 1100000,
  short_description: over.desc || 'מאפייה שכונתית עם בית קפה קטן',
  anon_summary: over.summary || 'מאפייה שכונתית',
  anon_card_show_price: over.showPrice !== false,
  public_listing_active: true,
  anon_card_active: true
});

test('a subscriber waiting for consent is never sendable', () => {
  const scored = scoreAlert({ ...baseSub, status: 'pending_consent', consent_general: false, legacy_no_consent: true }, biz());
  assert.equal(scored.sendable, false);
  assert.equal(scored.block_reason, 'pending_consent');
  assert.equal(scored.sendable, false);
  const trial = scoreAlert({ ...baseSub, is_test: true }, biz());
  assert.equal(trial.block_reason, 'is_test');
  assert.equal(trial.sendable, false);
});

test('a million-shekel budget accepts 1.3 million and rejects 3 million', () => {
  const near = scoreAlert(baseSub, biz({ price: 1300000, id: 'near' }));
  const far = scoreAlert(baseSub, biz({ price: 3000000, id: 'far', field: 'מסעדה' }));
  assert.ok(near, 'near scored');
  assert.equal(near.sendable, true, JSON.stringify(near.breakdown));
  assert.equal(near.block_reason, null);
  assert.ok(far);
  assert.equal(far.sendable, false);
  assert.equal(far.block_reason, 'budget_out_of_range');
  assert.ok(near.sector_points >= near.budget_points || near.sector_points >= near.location_points);
  assert.ok(DEFAULT_MATCH_CONFIG.sectorWeight > DEFAULT_MATCH_CONFIG.budgetWeight);
  assert.ok(DEFAULT_MATCH_CONFIG.budgetWeight > DEFAULT_MATCH_CONFIG.locationWeight);
});

test('food covers a bakery, a restaurant and a minimarket, and an exclusion blocks food', () => {
  const bakery = scoreAlert(baseSub, biz({ field: 'מאפייה', price: 1000000 }));
  const restaurant = scoreAlert(baseSub, biz({ id: 'r', field: 'מסעדה', price: 1000000 }));
  const market = scoreAlert(baseSub, biz({ id: 'g', field: 'מינימרקט', price: 1000000 }));
  assert.equal(bakery.sendable, true);
  assert.equal(restaurant.sendable, true);
  assert.equal(market.sendable, true);
  const excluded = scoreAlert({ ...baseSub, interests: [], looking_for: 'מחפש עסק, לא מזון' }, biz({ field: 'מאפייה' }));
  assert.ok(excluded);
  assert.equal(excluded.block_reason, 'sector_excluded');
  assert.equal(excluded.sendable, false);
});

test('a neighbouring region scores below the same region and still keeps partial credit', () => {
  const same = scoreAlert(baseSub, biz({ city: 'חיפה', region: 'חיפה והקריות', price: 1000000 }));
  const neighbor = scoreAlert(baseSub, biz({ id: 'n', city: 'נהריה', region: 'צפון', field: 'מאפייה', price: 1000000 }));
  assert.ok(same.location_points > neighbor.location_points, `${same.location_points} vs ${neighbor.location_points}`);
  assert.ok(neighbor.location_points > 0);
});

test('open to offers and a missing budget do not disqualify a pricey business', () => {
  const open = scoreAlert({ ...baseSub, budget_open: true, budget_min: null, budget_max: null }, biz({ price: 3000000 }));
  const none = scoreAlert({ ...baseSub, budget_open: false, budget_min: null, budget_max: null, looking_for: '' }, biz({ price: 3000000 }));
  assert.equal(open.block_reason === 'budget_out_of_range', false);
  assert.equal(none.block_reason === 'budget_out_of_range', false);
  assert.ok(open.budget_points > 0);
  assert.ok(none.budget_points > 0);
});

test('hebrew budget phrases parse', () => {
  assert.equal(parseAlertBudget('מיליון').hi, 1000000);
  assert.equal(parseAlertBudget('1.5 מ׳').hi, 1500000);
  assert.equal(parseAlertBudget('עד 800 אלף').hi, 800000);
  const window = budgetWindow({ budget_open: false, budget_min: null, budget_max: null, looking_for: 'תקציב עד 800 אלף' });
  assert.equal(window.kind, 'range');
  assert.equal(window.low, 560000);
  assert.equal(window.high, 1040000);
});

test('messy business text maps onto taxonomy slugs', () => {
  const burger = businessTaxonomy({ category: 'מסעדה — המבורגרים', region: 'מרכז גוש דן' });
  assert.deepEqual(burger.categories, ['food']);
  assert.ok(burger.subcategories.includes('restaurant'));
  assert.ok(burger.subcategories.includes('fast_food'));
  assert.deepEqual(burger.regions, ['center']);
  assert.deepEqual(regionsFromText('חיפה והקריות'), ['haifa']);
});

test('the website form can send taxonomy slugs and the legacy fields together', () => {
  const signupBody = {
    first_name: 'דנה',
    last_name: 'לוי',
    phone: '050-1234567',
    email: 'dana@example.com',
    interests: ['מזון'],
    region: 'מרכז',
    budget: 'open',
    categories: ['food', 'not-a-slug'],
    subcategories: ['bakery', 'cafe'],
    flags: ['franchise', 'mystery'],
    regions: ['south', 'all', 'atlantis'],
    taxonomy_version: 'v1-2026-11-13',
    source: 'website-catalog',
    budget_min: 700000,
    budget_max: 1300000,
    budget_open: false,
    looking_for: 'מאפייה או בית קפה',
    signup_channel: 'website',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'catalog-nov',
    utm_content: 'banner',
    consent_general: true,
    consent_email: true,
    consent_whatsapp: false,
    consent_text: 'אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה',
    consent_version: 'v1-2026-11-13',
    source_url: 'https://www.bsd-bbi.co.il/עסקים-למכירה/'
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let result;
  try {
    result = validateSignup(signupBody);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.row.categories, ['food', 'not-a-slug']);
  assert.deepEqual(result.row.subcategories, ['bakery', 'cafe']);
  assert.deepEqual(result.row.flags, ['franchise', 'mystery']);
  assert.deepEqual(result.row.regions, ['all']);
  assert.equal(result.row.taxonomy_version, 'v1-2026-11-13');
  assert.equal(result.row.consent_version, 'v1-2026-11-13');
  const bothVersions = validateSignup({
    ...signupBody,
    categories: ['food'],
    subcategories: ['bakery'],
    flags: ['franchise'],
    regions: ['center'],
    consent_whatsapp: true,
    consent_email: false,
    consent_text_version: 'alerts-consent-2026-11-12',
    utm_term: 'ad-1'
  });
  assert.equal(bothVersions.ok, true, bothVersions.error);
  assert.equal(bothVersions.row.consent_version, 'v1-2026-11-13');
  assert.equal(bothVersions.row.consent_text_version, 'alerts-consent-2026-11-12');
  assert.equal(bothVersions.row.consent_email, false);
  assert.equal(bothVersions.row.consent_whatsapp, true);
  assert.equal(bothVersions.row.utm_term, 'ad-1');
  assert.equal(validateSignup({ ...signupBody, categories: ['food'], address_form: 'female' }).row.address_form, 'female');
  assert.equal(validateSignup({ ...signupBody, categories: ['food'], address_form: 'm' }).row.address_form, 'male');
  assert.equal(validateSignup({ ...signupBody, categories: ['food'], address_form: 'f' }).row.address_form, 'female');
  assert.equal(validateSignup({ ...signupBody, categories: ['food'], address_form: 'office' }).row.address_form, null);
  assert.equal(Object.hasOwn(result.row, 'source'), false);
  assert.equal(result.row.budget_min, 700000);
  assert.equal(result.row.budget_max, 1300000);
  assert.equal(result.row.budget_open, false);
  assert.equal(result.row.signup_channel, 'website');
  assert.equal(result.row.utm_campaign, 'catalog-nov');
  assert.equal(result.row.utm_content, 'banner');
  assert.equal(result.row.source_url, 'https://www.bsd-bbi.co.il/עסקים-למכירה/');
  assert.equal(result.row.looking_for, 'מאפייה או בית קפה');
  assert.match(warnings.join('\n'), /not-a-slug/);
  assert.match(warnings.join('\n'), /mystery/);
  assert.match(warnings.join('\n'), /atlantis/);
  assert.equal(locationRelation(['all'], ['south']).ratio, 1);
  assert.equal(locationRelation(['all'], ['north']).kind, 'all');
});

test('whatsapp signup source and a bakery phrase stay on the same form', () => {
  const result = validateSignup({
    first_name: 'יוסי',
    last_name: 'לוי',
    phone: '052-1234567',
    email: 'yossi@example.com',
    interests: ['מאפייה'],
    region: 'נהריה',
    budget: '1.5 מ׳',
    signup_channel: 'our_link',
    looking_for: 'מחפש מאפייה או בית קפה, לא מפעל',
    consent_email: true,
    consent_text_version: CONSENT_TEXT_VERSION
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.row.signup_channel, 'our_link');
  assert.equal(validateSignup({
    first_name: 'יוסי', last_name: 'לוי', phone: '052-1234567', email: 'yossi@example.com',
    consent_email: true, consent_text_version: CONSENT_TEXT_VERSION, signup_channel: 'facebook'
  }).row.signup_channel, 'website');
  assert.equal(result.row.interests.includes('מזון'), true);
  assert.equal(result.row.region, 'צפון');
  assert.equal(result.row.budget_min, 1500000);
  assert.match(result.row.looking_for, /מאפייה/);
});

test('the alert email is anonymous and uses the approved sender', () => {
  const scored = scoreAlert(baseSub, biz({ price: 1000000 }));
  const mail = matchAlertEmail({
    firstName: 'דנה',
    card: scored.public_card,
    unsubscribeUrl: 'https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/business-alert-unsubscribe?token=abc&channel=email'
  });
  assert.equal(mail.subject.startsWith('פרסומת:'), true);
  assert.equal(mail.text.startsWith('על פי הסינון שעשינו לפי הפרופיל שביקשת, העסק הזה מתאים לך'), true);
  assert.equal(mail.from, '"BSD - עסקים למכירה" <info@bsd-bbi.co.il>');
  assert.match(mail.text, /להסרה:/);
  assert.equal(mail.text.includes('מאפיית השם האמיתי'), false);
  assert.equal(mail.html.includes('מאפיית השם האמיתי'), false);
  assert.match(mail.text, /BSD - עסקים למכירה/);
  const card = publicCard(biz());
  assert.equal(card.title.includes('השם האמיתי'), false);
});

test('sending stays off in the migration until the flag is turned on', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261113143000_business_alert_matches.sql', import.meta.url), 'utf8');
  const rollback = fs.readFileSync(new URL('../supabase/migrations/rollback_20261113143000_business_alert_matches.sql', import.meta.url), 'utf8');
  assert.match(sql, /sending_enabled boolean not null default false/);
  assert.match(sql, /revoke all on public\.business_alert_matches from public, anon, authenticated/);
  assert.match(rollback, /drop table if exists public\.business_alert_matches/);
  assert.equal(DEFAULT_MATCH_CONFIG.sendingEnabled, false);
  assert.equal(sendGate({ sending_enabled: false }, { sendable: true, public_card: { url: 'https://www.bsd-bbi.co.il/x' } }), 'sending_disabled');
  assert.equal(sendGate({ sending_enabled: true }, { sendable: false, block_reason: 'budget_out_of_range', public_card: { url: 'https://www.bsd-bbi.co.il/x' } }), 'budget_out_of_range');
});
