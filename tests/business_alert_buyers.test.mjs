import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { consentWritePayload, validateSignup, usesNewConsentContract, CONSENT_TEXT_VERSION } from '../supabase/functions/business-alert-signup/logic.mjs';
import { thankYouEmailHtml } from '../supabase/functions/business-alert-signup/email.mjs';
import {
  SUBSCRIBER_FROM,
  SUBSCRIBER_FROM_ADDRESS,
  SUBSCRIBER_FROM_NAME,
  listUnsubscribeHeaders,
  signOffHtml,
  signOffText,
  subscriberFromHeader,
  whatsappMessage,
  subscriberSubject
} from '../supabase/functions/_shared/business-alert-mail.mjs';
import {
  gateDecision,
  isStopText,
  mergeUnsubscribe,
  normalizeListingPath,
  summarizeSubscribers,
  unsubscribePage,
  filterSubscribers
} from '../supabase/functions/_shared/business-alert-rules.mjs';

const legacyBody = {
  first_name: 'דנה',
  last_name: 'לוי',
  phone: '050-1234567',
  email: 'dana@example.com',
  consent_email: true,
  consent_text_version: CONSENT_TEXT_VERSION,
  interests: ['מזון'],
  region: 'מרכז',
  budget: 'open'
};

test('the live form still validates and is stored as not consented for marketing', () => {
  assert.equal(usesNewConsentContract(legacyBody), false);
  const result = validateSignup(legacyBody);
  assert.equal(result.ok, true);
  assert.equal(result.contract, 'legacy');
  assert.equal(result.row.legacy_no_consent, true);
  assert.equal(result.row.consent_general, null);
  assert.equal(result.row.consent_text, null);
  assert.equal(result.row.consent_version, null);
  assert.equal(result.row.source_url, null);
  assert.equal(result.row.consent_email, true);
});

test('the new form requires general consent and at least one channel', () => {
  const base = {
    ...legacyBody,
    consent_general: true,
    consent_text: 'אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה',
    consent_version: 'v1-2026-11-13',
    source_url: 'https://www.bsd-bbi.co.il/עסקים-למכירה/'
  };
  assert.equal(validateSignup({ ...base, consent_general: false }).error, 'consent_required');
  assert.equal(validateSignup({ ...base, consent_email: false, consent_whatsapp: false }).error, 'no_channel');
  const ok = validateSignup({ ...base, consent_email: false, consent_whatsapp: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.contract, 'current');
  assert.equal(ok.row.legacy_no_consent, false);
  assert.equal(ok.row.consent_general, true);
  assert.equal(ok.row.consent_whatsapp, true);
  assert.equal(ok.row.consent_email, false);
  assert.equal(ok.row.source_url, base.source_url);
});

test('a repeat signup stays unsubscribed until the form brings fresh consent', () => {
  const now = '2026-11-13T10:00:00.000Z';
  const previous = {
    status: 'unsubscribed',
    unsubscribed_at: '2026-11-01T08:00:00.000Z',
    unsubscribed_by: 'self_link',
    unsubscribe_reason: null,
    email_unsubscribed_at: '2026-11-01T08:00:00.000Z',
    whatsapp_unsubscribed_at: '2026-11-01T08:00:00.000Z',
    resubscribed_at: null,
    status_history: [{ status: 'active', at: '2026-10-01T08:00:00.000Z' }],
    consent_text: 'נוסח ישן',
    consent_version: 'v0'
  };
  const legacy = validateSignup(legacyBody);
  const kept = consentWritePayload(legacy.row, previous, now);
  assert.equal(kept.status, 'unsubscribed');
  assert.equal(kept.unsubscribed_at, previous.unsubscribed_at);
  assert.equal(kept.consent_text, undefined);
  assert.equal(kept.consent_at, undefined);
  assert.equal(kept.resubscribed_at, undefined);
  assert.equal(kept.status_history.length, 1);
  assert.equal(kept.status_history[0].status, 'active');

  const fresh = validateSignup({
    ...legacyBody,
    consent_general: true,
    consent_email: true,
    consent_whatsapp: true,
    consent_text: 'אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה',
    consent_version: 'v1-2026-11-13',
    source_url: 'https://www.bsd-bbi.co.il/עסקים-למכירה/'
  });
  const back = consentWritePayload(fresh.row, previous, now);
  assert.equal(back.status, 'active');
  assert.equal(back.unsubscribed_at, null);
  assert.equal(back.email_unsubscribed_at, null);
  assert.equal(back.whatsapp_unsubscribed_at, null);
  assert.equal(back.consent_at, now);
  assert.equal(back.consent_text, fresh.row.consent_text);
  assert.equal(back.consent_version, 'v1-2026-11-13');
  assert.equal(back.resubscribed_at, now);
  assert.equal(back.status_history.length, 2);
  assert.equal(back.status_history[0].status, 'active');
  assert.equal(back.status_history[1].status, 'unsubscribed');

  const emailOnly = validateSignup({
    ...legacyBody,
    consent_general: true,
    consent_email: true,
    consent_whatsapp: false,
    consent_text: 'אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה',
    consent_version: 'v1-2026-11-13'
  });
  const partial = consentWritePayload(emailOnly.row, previous, now);
  assert.equal(partial.status, 'unsubscribed_whatsapp');
  assert.equal(partial.email_unsubscribed_at, null);
  assert.equal(partial.whatsapp_unsubscribed_at, previous.whatsapp_unsubscribed_at);
  assert.equal(partial.resubscribed_at, now);
  assert.equal(partial.status_history.length, 2);

  const clash = consentWritePayload(
    { ...fresh.row, first_name: 'ברוך', last_name: 'איזון', email: 'baruch@example.com' },
    { ...previous, first_name: 'אדם', last_name: 'בדיקה', email: 'adam@example.com', phone: '050-0000000', phone9: '500000000' },
    now
  );
  assert.equal(clash.identity_kept, true);
  assert.equal(clash.status, 'unsubscribed');
  assert.equal(clash.identity_audit.previous.first_name, 'אדם');
  assert.equal(clash.identity_audit.previous.email, 'adam@example.com');
  assert.equal(clash.identity_audit.incoming.first_name, 'ברוך');
  assert.equal(clash.identity_audit.incoming.email, 'baruch@example.com');
  assert.equal(clash.first_name, undefined);
});

test('legacy rows are blocked and a fresh consent can pass the gate', () => {
  const legacy = { legacy_no_consent: true, consent_general: null, consent_email: true, status: 'active' };
  assert.equal(gateDecision(legacy, 'email').reason, 'legacy_no_consent');
  const ready = {
    legacy_no_consent: false,
    consent_general: true,
    consent_email: true,
    consent_whatsapp: true,
    status: 'active'
  };
  assert.equal(gateDecision(ready, 'email').allowed, true);
  assert.equal(gateDecision({ ...ready, status: 'unsubscribed_email' }, 'email').reason, 'unsubscribed_email');
  assert.equal(gateDecision({ ...ready, status: 'unsubscribed_email' }, 'whatsapp').allowed, true);
  assert.equal(gateDecision({ ...ready, status: 'unsubscribed_whatsapp' }, 'email').allowed, true);
  assert.equal(gateDecision(ready, 'sms').reason, 'invalid_channel');
});

test('unsubscribe channels merge and stop words stay exact', () => {
  assert.equal(mergeUnsubscribe('active', 'email'), 'unsubscribed_email');
  assert.equal(mergeUnsubscribe('unsubscribed_email', 'whatsapp'), 'unsubscribed_all');
  assert.equal(mergeUnsubscribe('unsubscribed_all', 'email'), 'unsubscribed_all');
  assert.equal(mergeUnsubscribe('unsubscribed', 'whatsapp'), 'unsubscribed_all');
  assert.equal(isStopText(' הסר '), true);
  assert.equal(isStopText('STOP'), true);
  assert.equal(isStopText('הסירו'), true);
  assert.equal(isStopText('הפסק'), false);
  assert.equal(isStopText('הסר אותי'), false);
});

test('listing paths drop the query string and reject off-site urls', () => {
  assert.equal(normalizeListingPath('/עסקים-למכירה/abc?bat=secret'), '/עסקים-למכירה/abc');
  assert.equal(normalizeListingPath('https://www.bsd-bbi.co.il/עסקים-למכירה/'), '/עסקים-למכירה/');
  assert.equal(normalizeListingPath('https://evil.example/x'), '');
  assert.equal(normalizeListingPath('//evil'), '');
});

test('subscriber mail uses one quoted sender and never the team name', () => {
  assert.equal(SUBSCRIBER_FROM_NAME, 'BSD - עסקים למכירה');
  assert.equal(SUBSCRIBER_FROM, '"BSD - עסקים למכירה" <info@bsd-bbi.co.il>');
  assert.equal(subscriberFromHeader(), SUBSCRIBER_FROM);
  assert.equal(signOffText().split('\n')[0], SUBSCRIBER_FROM_NAME);
  assert.match(signOffText(), /077-444-6707/);
  assert.match(signOffText(), /054-2424999/);
  assert.match(signOffHtml(), /href="tel:\+972774446707"/);
  assert.match(signOffHtml(), /href="tel:\+972542424999"/);
  const thanks = thankYouEmailHtml({ firstName: 'דנה', unsubscribeLink: 'https://example.com/unsub' });
  assert.match(thanks, /href="tel:\+972774446707"/);
  assert.match(thanks, /href="tel:\+972542424999"/);
  assert.match(thanks, /טלפון BSD/);
  assert.match(thanks, /נייד/);
  assert.match(thanks, /בלי הצפות ובלי ספאם/);
  assert.match(thanks, /תודה שנרשמת/);
  assert.match(thanks, /אפשר להסיר את עצמך/);
  const feminine = thankYouEmailHtml({ firstName: 'דנה', unsubscribeLink: 'https://example.com/unsub', addressForm: 'female' });
  assert.match(feminine, /תוכלי להסיר/);
  assert.equal(signOffText().includes('צוות BSD'), false);
  const headers = listUnsubscribeHeaders('https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/business-alert-unsubscribe?token=abc&channel=all');
  assert.match(headers['List-Unsubscribe'], new RegExp(`<mailto:${SUBSCRIBER_FROM_ADDRESS}\\?subject=unsubscribe>`));
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const wa = whatsappMessage('דנה');
  assert.equal(wa.startsWith('פרסומת\n'), true);
  assert.equal(wa.endsWith('להסרה אפשר להשיב הסר'), true);
  assert.equal(whatsappMessage('דנה', 'male').endsWith('להסרה השב הסר'), true);
  assert.equal(whatsappMessage('דנה', 'm').endsWith('להסרה השב הסר'), true);
  assert.equal(whatsappMessage('דנה', 'female').endsWith('להסרה השיבי הסר'), true);
  assert.equal(wa.includes('צוות BSD'), false);
  assert.equal(wa.includes('שם העסק'), false);
  assert.equal(subscriberSubject('עדכון').startsWith('פרסומת:'), true);
});

test('the unsubscribe page is Hebrew and says the removal succeeded', () => {
  const page = unsubscribePage({ ok: true, channel: 'email' });
  assert.match(page, /lang="he"/);
  assert.match(page, /dir="rtl"/);
  assert.match(page, /הוסרת מעדכוני האימייל/);
  assert.match(page, /תמיד אפשר לחזור/);
  assert.match(unsubscribePage({ ok: true, channel: 'all' }), /הוסרת מכל העדכונים/);
  assert.match(unsubscribePage({ ok: true, channel: 'all', addressForm: 'female' }), /תוכלי לחזור/);
  assert.match(unsubscribePage({ ok: true, channel: 'all', addressForm: 'male' }), /תוכל לחזור/);
  assert.match(page, /אימייל/);
  assert.match(page, /BSD - עסקים למכירה/);
  assert.match(page, /href="tel:\+972774446707"/);
  assert.match(page, /href="tel:\+972542424999"/);
  assert.match(unsubscribePage({ ok: false, channel: 'all' }), /הקישור אינו תקין/);
});

test('screen stats and search follow the same consent split as the gate', () => {
  const now = new Date('2026-11-13T10:00:00+02:00');
  const rows = [
    { first_name: 'דנה', last_name: 'לדוגמה', phone: '050-0000001', email: 'a@example.com', region: 'מרכז', interests: ['מזון'], status: 'active', created_at: '2026-11-13T08:00:00+02:00', legacy_no_consent: false, consent_general: true, consent_email: true, consent_whatsapp: true, do_not_call: false },
    { first_name: 'יוסי', last_name: 'לדוגמה', phone: '050-0000002', email: 'b@example.com', region: 'צפון', interests: ['תעשייה'], status: 'active', created_at: '2026-10-01T08:00:00+02:00', legacy_no_consent: true, consent_general: null, consent_email: true, consent_whatsapp: false, do_not_call: true }
  ];
  const summary = summarizeSubscribers(rows, now);
  assert.equal(summary.total, 2);
  assert.equal(summary.newThisWeek, 1);
  assert.equal(summary.emailConsent, 1);
  assert.equal(summary.awaitingConsent, 1);
  assert.equal(summary.doNotCall, 1);
  assert.deepEqual(filterSubscribers(rows, 'תעשייה').map(row => row.first_name), ['יוסי']);

  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/site-buyers.js', import.meta.url), 'utf8'), ctx);
  const screen = ctx.BSDSiteBuyers.summarize(rows, now);
  assert.equal(screen.emailConsent, summary.emailConsent);
  assert.equal(screen.awaitingConsent, summary.awaitingConsent);
  assert.equal(ctx.BSDSiteBuyers.sampleAllowed(), false);
  assert.equal(ctx.BSDSiteBuyers.sampleRows(now)[0].last_name, 'לדוגמה');
});

test('the tools menu points at the new screen and mail files use the sender constant', () => {
  const app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const config = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
  const signup = fs.readFileSync(new URL('../supabase/functions/business-alert-signup/index.ts', import.meta.url), 'utf8');
  const email = fs.readFileSync(new URL('../supabase/functions/business-alert-signup/email.mjs', import.meta.url), 'utf8');
  const admin = fs.readFileSync(new URL('../supabase/functions/business-alert-admin/index.ts', import.meta.url), 'utf8');
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261113120000_business_alert_compliance.sql', import.meta.url), 'utf8');
  assert.match(config, /קונים פוטנציאליים מהאתר/);
  assert.match(config, /site-buyers\.html/);
  assert.equal(signup.includes('צוות BSD'), false);
  assert.equal(email.includes('צוות BSD'), false);
  assert.equal(admin.includes('צוות BSD'), false);
  assert.match(signup, /MAIL_FROM/);
  assert.match(sql, /legacy_no_consent/);
  assert.match(sql, /revoke all on function public\.business_alert_crm_list\(\) from public, anon, authenticated/);
  assert.equal(sql.includes('grant select on public.business_alert_subscribers to anon'), false);
  assert.match(app, /navToolsWrap/);
  const leads = fs.readFileSync(new URL('../leads-hub.html', import.meta.url), 'utf8');
  assert.match(leads, /נרשמים לעדכונים/);
  const copy = JSON.parse(fs.readFileSync(new URL('../copy/he.json', import.meta.url), 'utf8'));
  assert.equal(copy.email.headline.neutral, 'על פי הסינון שעשינו לפי הפרופיל שביקשת, העסק הזה מתאים לך');
  assert.equal(copy.email.subject.neutral, 'מצאנו עסק שמתאים לפרופיל שביקשת');
  assert.equal(copy.email.signupThanks.neutral, 'תודה שנרשמת');
  assert.match(copy.whatsapp.prefill.neutral, /להסרה אפשר להשיב הסר/);
  assert.equal(JSON.stringify(copy).includes('/'), false);
  assert.equal(copy.unsubscribe.successTitle.neutral, 'הוסרת בהצלחה');
  assert.match(copy.email.warm.neutral, /לא רוצים להעמיס/);
  const screenSql = fs.readFileSync(new URL('../supabase/migrations/20261113170000_business_alert_screen.sql', import.meta.url), 'utf8');
  assert.match(screenSql, /business_alert_screen_list/);
  assert.match(screenSql, /business_alert_manual_add/);
  assert.match(screenSql, /business_alert_set_do_not_call/);
  assert.match(screenSql, /opened_at/);
  assert.match(screenSql, /revoke all on function public\.business_alert_screen_list/);
  assert.equal(/grant execute on function public\.business_alert_screen_list[\s\S]*to anon/.test(screenSql), false);
});

test('subscriber rows show a source badge and honor the screen filters', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/site-buyers.js', import.meta.url), 'utf8'), ctx);
  const rows = ctx.BSDSiteBuyers.sampleRows(new Date('2026-11-13T10:00:00+02:00'));
  assert.equal(ctx.BSDSiteBuyers.sourceBadge(rows[0]), 'נרשם דרך האתר');
  assert.equal(ctx.BSDSiteBuyers.sourceBadge({ source: 'website-catalog' }), 'נרשם דרך האתר');
  assert.equal(ctx.BSDSiteBuyers.sourceBadge({ signup_channel: 'vip' }), 'VIP');
  assert.equal(ctx.BSDSiteBuyers.sourceBadge(rows.find(row => row.manual_source === 'call')), 'יזום שלנו');
  assert.equal(ctx.BSDSiteBuyers.sourceBadge(rows.find(row => row.manual_source === 'manual')), 'יזום שלנו');
  const dana = ctx.BSDSiteBuyers.contactStats(rows[0]);
  assert.equal(dana.calls, 2);
  assert.equal(dana.answered, 1);
  assert.equal(dana.answerRate, 50);
  assert.equal(dana.unknown, 1);
  assert.equal(dana.sends, 1);
  const pending = ctx.BSDSiteBuyers.manualAdd({ name: 'נועה לוי', phone: '050-1111111', email: '' });
  assert.equal(pending.ok, true);
  assert.equal(pending.row.status, 'pending_consent');
  assert.equal(pending.row.consent_email, false);
  assert.equal(pending.row.consent_whatsapp, false);
  assert.equal(pending.row.consent_general, false);
  assert.equal(pending.row.consent_method, null);
  assert.equal(pending.row.consent_text, null);
  const emailed = ctx.BSDSiteBuyers.manualAdd({
    name: 'נועה לוי', phone: '050-1111111', consent_email: true, consent_email_method: 'verbal_call', consent_email_note: 'אמרה כן בשיחה'
  });
  assert.equal(emailed.row.status, 'active');
  assert.equal(emailed.row.consent_email, true);
  assert.equal(emailed.row.consent_whatsapp, false);
  assert.equal(emailed.row.consent_email_method, 'verbal_call');
  assert.equal(emailed.row.consent_whatsapp_method, null);
  assert.equal(ctx.BSDSiteBuyers.manualAdd({ name: 'נועה', phone: '050-1111111', consent_email: true }).error, 'consent_method');
  assert.equal(gateDecision({ status: 'pending_consent', consent_general: false, legacy_no_consent: true, consent_email: false }, 'email').reason, 'pending_consent');
  assert.equal(gateDecision({ is_test: true, status: 'active', consent_general: true, legacy_no_consent: false, consent_email: true }, 'email').reason, 'is_test');
  assert.match(ctx.BSDSiteBuyers.waHref('050-0000001', 'שלום'), /https:\/\/wa\.me\/972500000001\?text=/);
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261113200000_business_alert_interactions.sql', import.meta.url), 'utf8');
  assert.match(sql, /business_alert_interactions/);
  assert.match(sql, /deleted_at/);
  assert.match(sql, /business_alert_add_verbal/);
  assert.equal(/grant delete on public\.business_alert_interactions/.test(sql), false);
  const summary = ctx.BSDSiteBuyers.summarize(rows, new Date('2026-11-13T10:00:00+02:00'));
  assert.equal(summary.calls, 2);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.answerRate, 50);
  assert.match(ctx.BSDSiteBuyers.lookingLine(rows[0]), /מזון/);
  assert.match(ctx.BSDSiteBuyers.sendSummary(rows[0]), /1 עסקים/);
  const called = rows.filter(row => ctx.BSDSiteBuyers.passesFilters(row, { source: 'call', status: '' }));
  assert.equal(called.length, 2);
  const quiet = rows.filter(row => ctx.BSDSiteBuyers.passesFilters(row, { source: 'all', status: 'do_not_call' }));
  assert.equal(quiet.length, 1);
  const food = rows.filter(row => ctx.BSDSiteBuyers.passesFilters(row, { source: 'all', sector: 'מזון ומסעדנות' }));
  assert.equal(ctx.BSDSiteBuyers.subLabels(rows[0]).join(', '), 'מאפייה');
  assert.equal(ctx.BSDSiteBuyers.flagLabels(rows[0]).join(','), 'זכיינות');
  assert.equal(food.length, 1);
  assert.equal(ctx.BSDSiteBuyers.summarize(rows, new Date('2026-11-13T10:00:00+02:00')).sends, 1);
});
