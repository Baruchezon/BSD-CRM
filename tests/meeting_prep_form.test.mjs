// Meeting-prep form: blank empty cells, business name as the heading,
// call summary from where it is actually stored, and web research that is
// not a CRM status line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(read('js/meetingPrepContent.js'), sandbox);
const api = sandbox.BSDMeetingPrepContent;

const antal = {
  id: 'biz-antal',
  internal_name: 'אנטל (ANTAL)',
  owner_name: 'בוריס',
  owner_phone: '0505984800',
  website: 'https://antalcosmetology.com/',
  field: 'קליניקה לטיפולים קוסמטיים ואסתטיים',
  category: '',
  short_description: '',
  business_number: 'BSD-B-100',
  notes: '08.11.2026 — שיחה נכנסת לברוך (לפי ברוך). לטענתו: קליניקה גדולה לטיפולים קוסמטיים ואסתטיים בקריית אתא, פועלת 7 שנים, הושקעו בה כ־500,000 ₪ ויש בה ציוד בשווי כ־450,000 ₪ — לפי דבריו, לא מאומת.',
  pre_research: `★ נקבעה פגישה: יום שלישי 10.11.2026, 12:00, אצל בוריס בקליניקה. טלפון בוריס: 0505984800. אתר: https://antalcosmetology.com/

═══ א. דיווח בוריס (שיחה נכנסת לברוך — לא מאומת) ═══
- קליניקה גדולה לטיפולים קוסמטיים, פועלת 7 שנים.

═══ ב. טענות העסק באתר ═══
- שירותים: טיפולי פנים, פיגמנטציה, אקנה, אנטי־אייג'ינג.
- ציוד מוצג: Lumenis M22, Geneo, InMode Lumecca.

═══ ג. ביקורות ═══
- גוגל 4.7 מ־27. ביקורות חיוביות מדגישות יחס אישי, ניקיון ומעקב.
- ביקורת שלילית אחת בלי פירוט: לא מומלץ.`
};
const antalLead = {
  business_name: 'אנטל (ANTAL)',
  notes: antal.notes,
  meeting_summary: 'נקבעה פגישה עם בוריס מאנטל: יום שלישי 10.11.2026 בשעה 12:00.'
};

test('אנטל: heading is the business name, not the owner or a generic title', () => {
  const names = api.businessNames(antal, antalLead);
  assert.equal(names.businessName, 'אנטל (ANTAL)');
  assert.equal(names.heading, 'אנטל (ANTAL)');
  const html = api.renderPaper(antal, { biz: antal, lead: antalLead, meetings: [], calls: [], recordNotes: [], activity: [] }, {});
  assert.match(html, /<h1>אנטל \(ANTAL\)<\/h1>/);
  assert.doesNotMatch(html, /<h1>[^<]*בוריס/);
  assert.doesNotMatch(html, /לא ידוע|לא תועד|לא נמצא סיכום/);
});

test('אנטל: what the business does comes from the field shown on the card', () => {
  assert.equal(api.whatBusinessDoes(antal), 'קליניקה לטיפולים קוסמטיים ואסתטיים');
});

test('אנטל: phone-call row is what the owner said, not the appointment line', () => {
  const call = api.callEssence({ biz: antal, lead: antalLead, meetings: [], calls: [], recordNotes: [], activity: [] });
  assert.match(call, /פועלת 7 שנים/);
  assert.match(call, /ציוד/);
  assert.doesNotMatch(call, /נקבעה פגישה/);
});

test('אנטל: market research skips the CRM appointment and keeps the public findings', () => {
  const found = api.researchBlocks(antal);
  assert.match(found.research, /טיפולי פנים/);
  assert.match(found.research, /Lumenis/);
  assert.doesNotMatch(found.research, /נקבעה פגישה/);
  assert.doesNotMatch(found.research, /דיווח בוריס/);
  assert.match(found.reviews, /גוגל 4\.7/);
  assert.match(found.reviews, /לא מומלץ/);
});

test('stored web research replaces the pre_research extract', () => {
  const biz = { ...antal, market_research_brief: 'אתר הקליניקה מציג טיפולי פנים וציוד IPL.', market_reviews: 'גוגל 4.7, 27 ביקורות.' };
  const found = api.researchBlocks(biz);
  assert.equal(found.research, biz.market_research_brief);
  assert.equal(found.reviews, biz.market_reviews);
});

test('a description on the card is used as what the business does', () => {
  const biz = {
    internal_name: 'הנחלה חנות פירות וירקות',
    owner_name: 'אסף דהן',
    short_description: 'חנות ירקות ופירות ברמה גבוהה באזור גליל ים.',
    field: 'מסחר',
    category: 'חנות ירקות ופירות',
    notes: '[פנייה ישירה מאתר BSD] מטרת הפנייה: למכור עסק הודעה: מעוניין למכור. [הערת ברוך 04.10.2026] שכירות: כרגע 6% מהמחזור. בהמשך תשולם שכירות של 250 ש"ח למ"ר.',
    pre_research: 'הערת דנה המזכירה (06.10.2026) ❌ בעלים לא מאומת מול הטלפון. הנחלה פירות וירקות הרצליה. גוגל 5.0 מ־14. המייל בלי תוצאות.'
  };
  assert.match(api.whatBusinessDoes(biz), /חנות ירקות ופירות/);
  const call = api.callEssence({ biz, lead: null, meetings: [], calls: [], recordNotes: [], activity: [] });
  assert.match(call, /שכירות/);
  assert.doesNotMatch(call, /מטרת הפנייה/);
  const found = api.researchBlocks(biz);
  assert.match(found.reviews, /גוגל 5\.0/);
  assert.doesNotMatch(found.research + found.reviews, /לא מאומת מול/);
});

test('call summary is taken from the seller lead and from phone_calls when the business notes are empty', () => {
  const biz = { internal_name: 'עופרים הנדסה ובניה בע"מ', owner_name: 'עומר בן אבו', notes: '', short_description: 'מפעל לבתים מוכנים.', field: 'בנייה' };
  const lead = { intake_conversation_summary: 'המתקשר הוא הבעלים. העסק מייצר בתים מוכנים ביציקה ומביא אותם לבית הלקוח. מפעל ביקיר.' };
  const call = api.callEssence({
    biz,
    lead,
    meetings: [{ meeting_type: 'פגישה', summary_text: 'נקבעה פגישה במפעל.' }],
    calls: [{ ai_gist: 'הבעלים תיאר מפעל ליציקת בתים ומסירה אצל הלקוח.' }],
    recordNotes: [],
    activity: [{ description: 'עודכן סטטוס להתאמה', note: '' }]
  });
  assert.match(call, /בתים מוכנים/);
  assert.match(call, /יציקת בתים/);
  assert.doesNotMatch(call, /נקבעה פגישה/);
  assert.doesNotMatch(call, /עודכן סטטוס/);
});

test('owner name is the heading only when no business name exists', () => {
  assert.equal(api.businessNames({ internal_name: '', owner_name: 'דני' }, null).heading, 'דני');
  assert.equal(api.businessNames({ internal_name: '', owner_name: 'דני' }, null).businessName, '');
  const named = api.businessNames({ internal_name: 'דני', owner_name: 'דני' }, { business_name: 'מאפיית דני', company: '' });
  assert.equal(named.heading, 'מאפיית דני');
  assert.equal(named.businessName, 'מאפיית דני');
});

test('empty fields stay blank, phone is kept, and a web answer of "not found" is dropped', () => {
  const biz = { internal_name: 'עסק לדוגמה', owner_name: '', owner_phone: '050-0000000', field: '', short_description: '', asking_price: null, pre_research: 'נקבעה פגישה ביום ראשון.' };
  const html = api.renderPaper(biz, { biz, meetings: [] }, {});
  assert.match(html, /050-0000000/);
  assert.doesNotMatch(html, /לא ידוע|לא תועד/);
  const found = api.researchBlocks(biz);
  assert.equal(found.research, '');
  assert.equal(found.reviews, '');
  const parsed = api.parseWebResearch('## חקר\nלא נמצא מידע זמין\n\n## ביקורות\nלא ידוע\n');
  assert.equal(parsed.research, '');
  assert.equal(parsed.reviews, '');
  const kept = api.parseWebResearch('## חקר\n- מוכרים ציוד חימום תת-רצפתי.\nלא נמצא עמוד פייסבוק\n\n## ביקורות\nגוגל 4.2 מ־10. הלקוחות מציינים שירות מהיר.\n');
  assert.match(kept.research, /ציוד חימום/);
  assert.doesNotMatch(kept.research, /לא נמצא/);
  assert.match(kept.reviews, /גוגל 4\.2/);
});

test('form file keeps print, save and back, and the research button is screen-only', () => {
  const form = read('js/meetingPrepForm.js');
  assert.match(form, /bsdPrepPrint/);
  assert.match(form, /bsdPrepSave/);
  assert.match(form, /popstate/);
  assert.match(form, /history\.back\(\)/);
  assert.match(form, /id="bsdPrepResearch"/);
  assert.match(form, /class="screenonly"/);
  assert.match(form, /meeting-prep-research/);
  assert.match(form, /market_research_brief/);
  assert.doesNotMatch(form, /לא ידוע|לא תועד/);
  assert.match(read('businesses.html'), /meetingPrepContent\.js/);
  assert.match(read('businesses-preview.html'), /meetingPrepContent\.js/);
});

test('migration is additive and the edge function does not email or read CRM notes', () => {
  const sql = read('migrations/2026-11-09_meeting_prep_research.sql').replace(/--[^\n]*/g, '');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS market_research_brief text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS market_reviews text/);
  assert.doesNotMatch(sql, /DROP COLUMN|DELETE FROM|TRUNCATE/i);
  const fn = read('supabase/functions/meeting-prep-research/index.ts');
  assert.match(fn, /ANTHROPIC_API_KEY/);
  assert.match(fn, /web_search_20250305/);
  assert.match(fn, /has_full_business_access/);
  assert.match(fn, /internal_name, field, category, subcategory, city, region, address, website, owner_phone/);
  assert.doesNotMatch(fn, /resend|send_email|pre_research|\.notes\b|note_text/i);
});
