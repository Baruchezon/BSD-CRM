// 11.10.2026 (בקשת ברוך): «מוכר עסק» / «קונה עסק» / «לא ידוע» על כל ליד ב«לידים»
// (ידניים ומהאתר) ובכרטיס הליד. מקור האמת leads.lead_side; תיקון בלחיצה אחת על התגית.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const hub = read('leads-hub.html');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const helpers = hub.slice(hub.indexOf('function leadCardTypeValue('), hub.indexOf('function updateLeadTransferHint('));
function load(extra = {}){ const c = { esc, ...extra }; vm.createContext(c); vm.runInContext(helpers, c); return c; }
const WEB = 'אתר BSD החדש';

test('side: stored lead_side wins; website leads only from the form purpose; never free text', () => {
  const c = load();
  assert.equal(c.leadSide({ lead_side:'seller', type:'buyer', source:WEB }), 'seller');
  assert.equal(c.leadSide({ lead_side:'buyer', type:'seller', source:'הזנה ידנית' }), 'buyer');
  assert.equal(c.leadSide({ source:WEB, type:'seller', website_purpose_guess:'מעוניין למכור עסק' }), 'seller');
  assert.equal(c.leadSide({ source:WEB, type:'buyer', website_purpose_guess:'מחפש לקנות עסק' }), 'buyer');
  assert.equal(c.leadSide({ source:'SITE123 / אתר BSD', type:'buyer', website_purpose_guess:'מחפש לקנות עסק (ניחוש)' }), 'buyer');
  assert.equal(c.leadSide({ source:'SITE123 / אתר BSD', type:'seller', website_purpose_guess:'מעוניין למכור עסק (ניחוש)' }), 'seller');
  // type='buyer' is only the NOT NULL fallback when the form gave nothing -> unknown
  assert.equal(c.leadSide({ source:WEB, type:'buyer', website_purpose_guess:'דורש בדיקה' }), null);
  assert.equal(c.leadSide({ source:'SITE123 / אתר BSD', type:'buyer', website_purpose_guess:'דורש בדיקה - לא ניתן היה לזהות תחום התעניינות בוודאות' }), null);
  assert.equal(c.leadSide({ source:WEB, type:'partner', website_purpose_guess:'מעוניין בשותפות או השקעה' }), null);
  assert.equal(c.leadSide({ source:'אתר', type:'buyer', notes:'אני רוצה למכור את העסק שלי' }), null, 'free text is never read');
  assert.equal(c.leadSide(null), null);
});

test('side: leads typed in by a person use their type; old manual «קונה» (was the default) is unknown', () => {
  const c = load();
  assert.equal(c.leadSide({ source:'פנייה ישירה לברוך', type:'seller' }), 'seller');
  assert.equal(c.leadSide({ source:'לידים 2026', type:'buyer' }), 'buyer');
  assert.equal(c.leadSide({ source:'הזנה ידנית', type:'seller' }), 'seller');
  assert.equal(c.leadSide({ source:'הזנה ידנית', type:'buyer' }), null);
  assert.equal(c.leadSide({ source:'פנייה ישירה לברוך', type:'partner' }), null);
});

test('badge: Hebrew labels and colors; read-only is a span; editable is a one-click dropdown with no extra buttons', () => {
  const c = load();
  assert.equal(c.leadSideLabel('seller'), 'מוכר עסק'); assert.equal(c.leadSideLabel('buyer'), 'קונה עסק'); assert.equal(c.leadSideLabel(null), 'לא ידוע');
  const ro = c.leadSideBadge({ id:'1', lead_side:'seller' }, { editable:false });
  assert.match(ro, /^<span class="side-badge side-seller"[^>]*>מוכר עסק<\/span>$/);
  assert.match(c.leadSideBadge({ id:'1', lead_side:'buyer' }), /side-buyer[^>]*>קונה עסק</);
  assert.match(c.leadSideBadge({ id:'1', source:WEB, type:'buyer', website_purpose_guess:'דורש בדיקה' }), /side-unknown[^>]*>לא ידוע</);
  const ed = c.leadSideBadge({ id:"a'b", source:WEB, type:'buyer', website_purpose_guess:'דורש בדיקה' }, { editable:true });
  assert.match(ed, /^<select class="side-badge side-unknown"/);
  assert.match(ed, /<option value="" selected disabled>לא ידוע<\/option>/);
  assert.match(ed, /<option value="seller" >מוכר עסק<\/option>/); assert.match(ed, /<option value="buyer" >קונה עסק<\/option>/);
  assert.match(ed, /onclick="event\.stopPropagation\(\)"/, 'clicking the badge does not open the row');
  assert.match(ed, /quickSetLeadSide\('a&#39;b'/, 'id escaped');
  assert.ok(!/<button/.test(ed));
  const known = c.leadSideBadge({ id:'2', lead_side:'seller' }, { editable:true });
  assert.ok(!known.includes('disabled'), 'a known side can be corrected too');
  assert.match(known, /<option value="seller" selected>מוכר עסק<\/option>/);
  assert.match(hub, /\.side-seller\{background-color:#F26B1D;color:#fff;\}/);
  assert.match(hub, /\.side-buyer\{background-color:#0B1B3A;color:#fff;\}/);
  assert.match(hub, /\.side-unknown\{background-color:#dcdcdc;color:#444;\}/);
});

test('one click saves lead_side only (not type), verifies the row came back, updates the list', async () => {
  const calls = []; const row = { id:'L1', source:WEB, type:'buyer', website_intake_stage:'new' };
  let returned = [{ id:'L1', lead_side:'seller' }];
  const db = { from(t){ const q = { update(v){ calls.push([t, v]); return q; }, eq(k, v){ calls.push(['eq', k, v]); return q; }, select(){ return Promise.resolve({ data:returned, error:null }); } }; return q; } };
  const toasts = []; let rendered = 0;
  const c = load({ window:{ supabaseClient:db }, ALL_MANUAL:[], ALL_SELLERS:[row], ALL_LEADS_2026:[row], toast:m => toasts.push(m), renderTable:() => rendered++ });
  const el = { disabled:false };
  await c.quickSetLeadSide('L1', 'seller', el);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['leads', { lead_side:'seller', lead_side_source:'badge' }]));
  assert.equal(JSON.stringify(calls[1]), JSON.stringify(['eq', 'id', 'L1']));
  assert.equal(row.lead_side, 'seller'); assert.equal(row.type, 'buyer', 'type untouched (no client-number trigger)');
  assert.match(toasts.pop(), /נשמר: מוכר עסק/); assert.equal(rendered, 1);
  // RLS refused silently (0 rows) -> error, nothing changed locally
  returned = []; row.lead_side = 'seller';
  await c.quickSetLeadSide('L1', 'buyer', el);
  assert.match(toasts.pop(), /שגיאה בעדכון מוכר\/קונה/); assert.equal(row.lead_side, 'seller');
  // invalid value -> nothing sent
  const before = calls.length; await c.quickSetLeadSide('L1', '', el); assert.equal(calls.length, before);
});

test('lead card «סוג הליד»: preselects the known side; an unknown website lead is not preselected', () => {
  const c = load();
  assert.equal(c.leadCardTypeValue({ lead_side:'seller', type:'buyer', source:WEB }), 'seller');
  assert.equal(c.leadCardTypeValue({ source:WEB, type:'buyer', website_purpose_guess:'דורש בדיקה' }), '');
  assert.equal(c.leadCardTypeValue({ source:WEB, type:'buyer', website_purpose_guess:'מחפש לקנות עסק' }), 'buyer');
  assert.equal(c.leadCardTypeValue({ type:'partner' }), 'buyer');
});

test('wiring: badge on every lead row (manual, site, 2026), in the card header and the read-only view', () => {
  const name = hub.slice(hub.indexOf('function rowNameCell('), hub.indexOf('function rowCityCell('));
  assert.match(name, /leadSideBadge\(r, \{ editable: canEditRecord\(r\.created_by\) \}\)/);
  for (const branch of ["CURRENT_TAB === 'y2026'", "CURRENT_TAB === 'seller' && r.website_intake_stage", "CURRENT_TAB === 'seller' && r.business_name"]){
    const at = name.indexOf(branch); assert.ok(at > 0, branch);
    const ret = name.indexOf('return', at);
    assert.ok(name.slice(ret, name.indexOf('\n', ret)).includes('${side}'), branch);
  }
  assert.match(name, /return `<div class="primary-name">\$\{esc\(personName\)\}<\/div>\$\{side\}\$\{badge \?/);
  const card = hub.slice(hub.indexOf('function renderWebsiteLeadConversationForm('), hub.indexOf('function leadCardTypeValue('));
  assert.match(card, /<h3>כרטיס ליד — \$\{esc\(personName\)\} \$\{leadSideBadge\(r, \{ editable:false \}\)\}<\/h3>/);
  const ro = hub.slice(hub.indexOf('function openReadOnly('), hub.indexOf('function openAddChoice('));
  assert.equal((ro.match(/\['מוכר או קונה', leadSideLabel\(leadSide\(r\)\)\]/g) || []).length, 3);
});

test('card saves keep lead_side in step with the chosen «סוג הליד»', () => {
  const only = hub.slice(hub.indexOf('async function saveLeadOnly('), hub.indexOf('// Same agreement form'));
  assert.match(only, /if \(\(chosenType === 'seller' \|\| chosenType === 'buyer'\) && source\.data\.lead_side !== chosenType\)\{ payload\.lead_side = chosenType; payload\.lead_side_source = 'lead_card'; \}/);
  const tr = hub.slice(hub.indexOf('async function saveWebsiteLeadTransfer('), hub.indexOf('async function rejectWebsiteLead('));
  assert.match(tr, /payload\.type = 'seller';\s*if \(source\.data\.lead_side !== 'seller'\)\{ payload\.lead_side = 'seller'; payload\.lead_side_source = 'lead_card'; \}/);
  assert.match(tr, /payload\.type = 'buyer';\s*if \(source\.data\.lead_side !== 'buyer'\)\{ payload\.lead_side = 'buyer'; payload\.lead_side_source = 'lead_card'; \}/);
});

test('website-lead edge function: side only from the explicit purpose; both/neither/training -> null; written on insert', () => {
  const src = read('supabase/functions/website-lead/index.ts');
  const fn = src.slice(src.indexOf('export function websiteLeadSide('), src.indexOf('function escapeHtml('))
    .replace('export function', 'function').replace(/\(purposes: string\[\], isTraining: boolean\): 'seller' \| 'buyer' \| null/, '(purposes, isTraining)');
  const c = {}; vm.createContext(c); vm.runInContext(fn, c);
  assert.equal(c.websiteLeadSide(['למכור עסק'], false), 'seller');
  assert.equal(c.websiteLeadSide(['לקנות עסק'], false), 'buyer');
  assert.equal(c.websiteLeadSide(['Sell a business'], false), 'seller');
  assert.equal(c.websiteLeadSide(['Buy a business'], false), 'buyer');
  assert.equal(c.websiteLeadSide(['למכור עסק', 'לקנות עסק'], false), null);
  assert.equal(c.websiteLeadSide(['שותפות'], false), null);
  assert.equal(c.websiteLeadSide([], false), null);
  assert.equal(c.websiteLeadSide(['לקנות עסק'], true), null);
  assert.match(src, /lead_side: leadSide,\s*lead_side_source: leadSide \? 'website_form' : null,/);
  assert.ok(!/websiteLeadSide\([^)]*message/.test(src), 'free-text message never used');
});

test('migration: additive nullable columns + CHECK, logged backfill from reliable signals only; rollback removes only that', () => {
  const sql = read('supabase/migrations/20261011155351_leads_lead_side.sql');
  assert.match(sql, /add column if not exists lead_side text;/);
  assert.match(sql, /add column if not exists lead_side_source text;/);
  assert.match(sql, /check \(lead_side is null or lead_side in \('seller','buyer'\)\)/);
  const leadsDdl = sql.split(';').filter(st => /alter table public\.leads/.test(st)).join(';');
  assert.ok(!/not null|default|drop column|alter column|rename/i.test(leadsDdl), leadsDdl);
  assert.ok(!/\bdelete from\b|\btruncate\b|drop table|on public\.leads\s+for|create trigger/i.test(sql));
  assert.match(sql, /insert into public\.lead_side_backfill_log/);
  assert.match(sql, /where not l\.is_archived and l\.lead_side is null/);
  assert.match(sql, /l\.source = 'הזנה ידנית' and l\.type = 'seller' then 'seller'/);
  assert.ok(!/notes|message/.test(sql.slice(sql.indexOf('with cand as'))), 'backfill never reads free text');
  const rb = read('docs/lead-side-rollback.sql');
  assert.match(rb, /drop column if exists lead_side;/); assert.match(rb, /drop table if exists public\.lead_side_backfill_log;/);
  assert.match(rb, /website-lead-v16\.ts/);
  assert.ok(fs.existsSync(new URL('../docs/edge-backups/website-lead-v16.ts', import.meta.url)));
});

test('leads hub page build stays 202610111900', () => {
  assert.match(hub, /var PAGE_BUILD = '202610111900';/);
});
