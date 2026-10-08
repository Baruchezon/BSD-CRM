// 06.10.2026 (בקשת ברוך): «🔎 חקר מקדים» - leads.pre_research + businesses.pre_research.
// Internal text field on the lead card, the buyer card and the business card; carried by
// «שמור והעבר» (buyer: same row; seller: copied to the business card); saved only when
// changed (never wipes research written meanwhile); never in website / agent / anonymous
// / AI / PDF / send code paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const hub = read('leads-hub.html');
const leads = read('leads.html');
const biz = read('businesses.html');
const lifecycle = read('js/leadLifecycle.js');

function fnSrc(src, name){
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, name + ' missing');
  let i = src.indexOf('{', src.indexOf(')', start)), depth = 0;
  for (; i < src.length; i++){ if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}

// ---------------------------------------------------------------- migration
test('migration: only two nullable text columns, IF NOT EXISTS; rollback drops exactly those', () => {
  const sql = read('migrations/2026-10-06_pre_research.sql');
  const stmts = sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
  assert.deepEqual(stmts.map(s => s.replace(/\s+/g, ' ')), [
    'ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS pre_research text',
    'ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS pre_research text',
  ]);
  const rb = read('migrations/2026-10-06_pre_research_rollback.sql').replace(/--[^\n]*/g, '').split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  assert.deepEqual(rb, ['ALTER TABLE public.leads DROP COLUMN IF EXISTS pre_research', 'ALTER TABLE public.businesses DROP COLUMN IF EXISTS pre_research']);
});

// ---------------------------------------------------------------- lead card (leads-hub.html)
const hubCode = hub.slice(hub.indexOf('function websiteLeadTransferNotes('), hub.indexOf('async function rejectWebsiteLead('));
function hubHarness({ category = 'seller', serverResearch = null, shown = null, typed = null, businesses = [], leadType = 'buyer' } = {}){
  const lead = { id:'lead-1', type:leadType, client_number:'BSD-C-1', full_name:'Test Owner', phone:'050-0000000', email:'t@example.test',
    business_name:'Test Shop', business_city:'Test City', business_field:'Retail', notes:'Original inquiry', created_by:'user-1',
    website_intake_stage:'contacted', status:'בטיפול', agreement_status:'אין הסכם', is_archived:false, pre_research: serverResearch };
  const tables = { leads:[lead], businesses: businesses.map(b => ({ ...b })), record_notes:[] };
  const writes = { leads:[], businesses:[] };
  const db = {
    rpc(){ return Promise.resolve({ data:[], error:null }); },
    from(table){ let action = 'select', values, filters = [], returning = false;
      const q = { select(){ returning = true; return q; }, eq(k,v){ filters.push(r => r[k] === v); return q; }, is(k,v){ filters.push(r => (r[k] ?? null) === v); return q; },
        in(k,l){ filters.push(r => l.includes(r[k])); return q; }, limit(){ return q; }, order(){ return q; },
        insert(v){ action = 'insert'; values = v; return q; }, update(v){ action = 'update'; values = v; return q; },
        single(){ return run(true); }, maybeSingle(){ return run(true); }, then(a,b){ return run(false).then(a,b); } };
      async function run(single){
        if (action === 'insert'){ const list = Array.isArray(values) ? values : [values]; list.forEach(v => tables[table].push({ ...v })); if (writes[table]) writes[table].push({ op:'insert', values:{ ...list[0] } }); return { data: single ? { ...list[0] } : null }; }
        const rows = tables[table].filter(r => filters.every(f => f(r)));
        if (action === 'update'){ if (writes[table]) writes[table].push({ op:'update', values:{ ...values } }); rows.forEach(r => Object.assign(r, values)); return returning ? { data: structuredClone(rows) } : { data:null }; }
        return { data: single ? structuredClone(rows[0] || null) : structuredClone(rows) };
      }
      return q; } };
  const el = (id, extra = {}) => ({ id, style:{}, disabled:false, textContent:'', children:[], appendChild(c){ this.children.push(c); return c; }, ...extra });
  const fields = { wlSaveBtn:el('wlSaveBtn'), wlSaveOnlyBtn:el('wlSaveOnlyBtn'), wlSaveError:el('wlSaveError'), wlSaveOk:el('wlSaveOk'),
    wlTransferTarget:el('wlTransferTarget', { value:category }), wlName:{ value:'Test Owner' }, wlPhone:{ value:'050-0000000' }, wlEmail:{ value:'t@example.test' }, wlCity:{ value:'' },
    wlBusinessName:{ value:'Test Shop' }, wlBusinessField:{ value:'Retail' }, wlBusinessCity:{ value:'Test City' }, wlGeneralNotes:{ value:'Original inquiry' },
    wlSummary:{ value:'' }, wlWants:{ value:'' }, wlDetails:{ value:'' }, wlNotes:{ value:'' },
    wlPreResearch:{ value: typed ?? (shown ?? ''), dataset:{ orig: shown ?? '' } } };
  const document = { getElementById:k => fields[k], createElement:() => el(null, { addEventListener(){} }) };
  const ctx = { window:{ supabaseClient:db, BSDDataCache:{ remove(){} }, open(){ return null; } }, document, location:{ href:'' }, CURRENT_PROFILE:{ id:'user-1', role:'admin' },
    canSendAgreement:() => true, loadAll:async () => {}, closeModal(){}, setTimeout:f => f(), encodeURIComponent, URLSearchParams, JSON, Object, Array, String, Error, structuredClone };
  ctx.verifyLeadWrite = async (id, expected) => { const row = tables.leads.find(r => r.id === id); const mismatches = Object.entries(expected).filter(([k,v]) => (row[k] ?? null) !== (v ?? null)).map(([k]) => k); return { ok:!mismatches.length, mismatches }; };
  vm.createContext(ctx); vm.runInContext(lifecycle, ctx); ctx.BSDLeadLifecycle = ctx.window.BSDLeadLifecycle; vm.runInContext(hubCode, ctx);
  return { ctx, lead, tables, writes, fields };
}

test('lead card markup: «🔎 חקר מקדים» textarea near the notes, auto-grow + existing full-screen expand, 16px', () => {
  const card = hub.slice(hub.indexOf('function renderWebsiteLeadConversationForm('), hub.indexOf('function leadCardTypeValue('));
  assert.match(card, /<span>🔎 חקר מקדים<\/span><button type="button" class="wl-expand-btn" data-target="wlPreResearch"/);
  assert.match(card, /<textarea id="wlPreResearch" class="wl-note[^"]*"[^>]*data-orig="\$\{esc\(r\.pre_research \|\| ''\)\}"[^>]*font-size:16px[^>]*>\$\{esc\(r\.pre_research \|\| ''\)\}<\/textarea>/);
  // right after «הערות כלליות בליד» and before «סוג הליד»
  assert.ok(card.indexOf('id="wlGeneralNotes"') < card.indexOf('id="wlPreResearch"') && card.indexOf('id="wlPreResearch"') < card.indexOf('id="wlTransferTarget"'));
  // read-only view shows it too
  assert.equal((fnSrc(hub, 'openReadOnly').match(/\['🔎 חקר מקדים', r\.pre_research\]/g) || []).length, 3);
});

test('lead card «שמור»: an edited box is saved; an untouched box never wipes research written meanwhile', async () => {
  const h = hubHarness({ category:'buyer', shown:'', typed:'חקר: עסק משפחתי' });
  await h.ctx.saveLeadOnly('lead-1');
  assert.equal(h.lead.pre_research, 'חקר: עסק משפחתי');
  // card opened with an empty box, Dana filled it through the API meanwhile, user saved other fields
  const d = hubHarness({ category:'buyer', shown:'', serverResearch:'חקר של דנה' });
  d.fields.wlGeneralNotes.value = 'שונה';
  await d.ctx.saveLeadOnly('lead-1');
  assert.equal(d.lead.notes, 'שונה');
  assert.equal(d.lead.pre_research, 'חקר של דנה');
  assert.ok(!('pre_research' in d.writes.leads[0].values));
});

test('lead card: changed on the server and on the card -> nothing saved, server text loaded into the box', async () => {
  const h = hubHarness({ category:'buyer', shown:'', typed:'שלי', serverResearch:'חקר של דנה' });
  await h.ctx.saveLeadOnly('lead-1');
  assert.equal(h.writes.leads.length, 0);
  assert.match(h.fields.wlSaveError.textContent, /חקר מקדים/);
  assert.equal(h.fields.wlPreResearch.value, 'חקר של דנה');
  assert.equal(h.lead.pre_research, 'חקר של דנה');
});

test('«שמור והעבר» buyer: research stays on the same row (now the buyer card)', async () => {
  const h = hubHarness({ category:'buyer', shown:'חקר', serverResearch:'חקר' });
  await h.ctx.saveWebsiteLeadTransfer('lead-1');
  assert.equal(h.tables.leads.length, 1); assert.equal(h.lead.type, 'buyer'); assert.equal(h.lead.website_intake_stage, null);
  assert.equal(h.lead.pre_research, 'חקר');
  const e = hubHarness({ category:'buyer', shown:'חקר', typed:'חקר מעודכן', serverResearch:'חקר' });
  await e.ctx.saveWebsiteLeadTransfer('lead-1');
  assert.equal(e.lead.pre_research, 'חקר מעודכן'); assert.equal(e.lead.type, 'buyer');
});

test('«שמור והעבר» seller: the new business card gets the research (saved or just edited); none -> column not sent', async () => {
  const h = hubHarness({ category:'seller', shown:'חקר שוק', serverResearch:'חקר שוק' });
  await h.ctx.saveWebsiteLeadTransfer('lead-1');
  assert.equal(h.tables.businesses.length, 1); assert.equal(h.tables.businesses[0].pre_research, 'חקר שוק');
  assert.ok(!h.tables.businesses[0].notes.includes('חקר שוק'), 'research is its own field, not pasted into notes');
  assert.match(h.ctx.location.href, /businesses\.html\?open=/);
  const e = hubHarness({ category:'seller', shown:'', typed:'חדש מהכרטיס' });
  await e.ctx.saveWebsiteLeadTransfer('lead-1');
  assert.equal(e.tables.businesses[0].pre_research, 'חדש מהכרטיס'); assert.equal(e.lead.pre_research, 'חדש מהכרטיס');
  const n = hubHarness({ category:'seller' });
  await n.ctx.saveWebsiteLeadTransfer('lead-1');
  assert.equal(n.tables.businesses.length, 1);
  assert.ok(n.writes.businesses.every(w => !('pre_research' in w.values)));
});

test('«שמור והעבר» seller linked to an existing card: its own research is kept and the lead research is added once (retry safe)', async () => {
  const existing = { id:'lead-1', seller_id:'lead-1', internal_name:'Shop', notes:'Original inquiry', is_archived:false, pre_research:'חקר קיים של העסק' };
  const h = hubHarness({ category:'seller', shown:'חקר הליד', serverResearch:'חקר הליד', businesses:[existing] });
  await h.ctx.saveWebsiteLeadTransfer('lead-1');
  assert.equal(h.tables.businesses[0].pre_research, 'חקר קיים של העסק\n\nחקר הליד');
  h.lead.website_intake_stage = 'contacted';
  await h.ctx.saveWebsiteLeadTransfer('lead-1');
  assert.equal(h.tables.businesses[0].pre_research, 'חקר קיים של העסק\n\nחקר הליד');
});

// ---------------------------------------------------------------- buyer card (leads.html)
test('buyer card markup: «🔎 חקר מקדים» section right after «הערות», 16px, full width', () => {
  const form = fnSrc(leads, 'openLeadForm');
  assert.match(form, /<div class="section-h">🔎 חקר מקדים<\/div>/);
  assert.match(form, /<textarea id="pre_research" rows="[^"]*" data-orig="\$\{esc\(lead\?\.pre_research \|\| ''\)\}"[^>]*font-size:16px[^>]*>\$\{esc\(lead\?\.pre_research \|\| ''\)\}<\/textarea>/);
  assert.ok(form.indexOf("textareaRow('notes'") < form.indexOf('id="pre_research"'));
  assert.ok(form.indexOf('id="pre_research"') < form.indexOf('📲 WhatsApp'));
});

function runSaveLead({ shown = '', typed, server = null, disabled = false } = {}){
  const updates = []; const toasts = [];
  const els = { first_name:{ value:'A' }, last_name:{ value:'B' }, phone:{ value:'050' }, notes:{ value:'n' }, agreement_status:{ value:'אין הסכם' },
    pre_research:{ value: typed ?? shown, disabled, dataset:{ orig: shown } } };
  const db = { from(){ const q = { _u:null, select(){ return q; }, eq(){ return q; },
      maybeSingle: async () => ({ data:{ pre_research: server }, error:null }),
      update(v){ q._u = v; updates.push(v); return q; }, then(a,b){ return Promise.resolve({ error:null }).then(a,b); } }; return q; } };
  const ctx = { document:{ getElementById:k => els[k] }, window:{ supabaseClient:db }, ALL_LEADS:[{ id:'l1' }], CURRENT_PROFILE:{ id:'u' },
    toast:m => toasts.push(m), bsdSetButtonLoading(){}, bsdLogActivity(){}, closeModal(){}, loadLeads:async () => {}, Number, String, Promise };
  vm.createContext(ctx); vm.runInContext(fnSrc(leads, 'saveLead'), ctx);
  const e = { preventDefault(){}, target:{ dataset:{ leadId:'l1', leadType:'buyer' }, querySelector:() => ({}) } };
  return ctx.saveLead(e).then(() => ({ updates, toasts, els }));
}

test('buyer card save: sent only when edited; untouched never wipes; server change -> nothing saved', async () => {
  let r = await runSaveLead({ shown:'', typed:'חקר חדש' });
  assert.equal(r.updates.length, 1); assert.equal(r.updates[0].pre_research, 'חקר חדש'); assert.equal(r.updates[0].notes, 'n');
  r = await runSaveLead({ shown:'', server:'חקר של דנה' });
  assert.equal(r.updates.length, 1); assert.ok(!('pre_research' in r.updates[0]));
  r = await runSaveLead({ shown:'', typed:'שלי', server:'חקר של דנה' });
  assert.equal(r.updates.length, 0); assert.match(r.toasts.join(' '), /חקר מקדים/); assert.equal(r.els.pre_research.value, 'חקר של דנה');
  r = await runSaveLead({ shown:'ישן', typed:'  ' , server:'ישן' });
  assert.equal(r.updates[0].pre_research, null);
  r = await runSaveLead({ shown:'', typed:'x', disabled:true });
  assert.ok(!('pre_research' in r.updates[0]), 'read-only (released) viewers never send it');
});

// ---------------------------------------------------------------- business card (businesses.html)
test('business card: secondary fold under the full-info box (not a third main box), closed if empty / open if filled, 16px, no button', () => {
  const fold = new Function('esc', fnSrc(biz, 'bsdPreResearchFoldHtml') + '; return bsdPreResearchFoldHtml;')(s => String(s).replace(/</g, '&lt;'));
  const empty = fold({ pre_research:null }), filled = fold({ pre_research:'חקר <b>' }), fresh = fold(null);
  for (const h of [empty, filled, fresh]){
    assert.match(h, /<details id="bizPreResearchFold"/); assert.match(h, /<summary[^>]*>🔎 חקר מקדים/);
    assert.match(h, /<textarea id="pre_research"[^>]*font-size:16px/); assert.ok(!/<button/.test(h));
  }
  assert.ok(!/<details id="bizPreResearchFold"[^>]*\sopen/.test(empty)); assert.ok(!/\sopen[\s>]/.test(fresh.split('>')[0]));
  assert.match(filled, /<details id="bizPreResearchFold" class="bsd-pre-research" open/); assert.match(filled, /חקר &lt;b>/);
  const field = biz.slice(biz.indexOf('<div class="field full" id="bizFullInfoField">'), biz.indexOf('<div class="section-h">סיווג ומיקום</div>'));
  assert.ok(field.indexOf('<textarea id="short_description"') < field.indexOf('${bsdPreResearchFoldHtml(biz)}'));
  assert.equal((biz.match(/<textarea id="pre_research"/g) || []).length, 1);
});

test('business card save: pre_research is a guarded text field (sent only if changed, conflict-checked, revalidated)', () => {
  assert.match(biz, /const BIZ_GUARDED_TEXT_FIELDS = \[[^\]]*'pre_research'\]/);
  const plan = new Function('bsdNormText', fnSrc(biz, 'bsdPlanGuardedTextSave') + '; return bsdPlanGuardedTextSave;')(v => v == null ? '' : String(v));
  const base = { form:{ pre_research:'' }, db:{ pre_research:'' } };
  assert.deepEqual(plan(base, { pre_research:null }, null, null).skipped, ['pre_research']);
  assert.deepEqual(plan(base, { pre_research:'חקר' }, { pre_research:'' }, null).send, { pre_research:'חקר' });
  assert.deepEqual(plan(base, { pre_research:'שלי' }, { pre_research:'של דנה' }, null).conflicts, ['pre_research']);
  const save = fnSrc(biz, 'saveBiz');
  assert.match(save, /const preResearchEl = document\.getElementById\('pre_research'\);\s*if \(preResearchEl && \(bizId \|\| preResearchEl\.value\.trim\(\)\)\) payload\.pre_research =/);
  assert.ok(save.indexOf('payload.pre_research =') < save.indexOf('bsdPlanGuardedTextSave(BIZ_FORM_BASELINE'));
});

// ---------------------------------------------------------------- privacy
test('privacy: pre_research appears only in the three internal cards, the migration and this test', () => {
  const allowed = new Set(['leads-hub.html', 'leads.html', 'businesses.html', 'migrations/2026-10-06_pre_research.sql',
    'migrations/2026-10-06_pre_research_rollback.sql', 'tests/pre_research.test.mjs', 'tests/research_in_card.test.mjs']);
  const hits = [];
  const walk = dir => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes:true })){
    const rel = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()){ if (!['.git', 'node_modules'].includes(e.name)) walk(rel); continue; }
    if (!/\.(html|js|mjs|ts|sql|json|css)$/.test(e.name)) continue;
    if (/pre_research|חקר מקדים/.test(fs.readFileSync(path.join(root, rel), 'utf8'))) hits.push(rel);
  } };
  walk('');
  assert.deepEqual(hits.filter(f => !allowed.has(f)), []);
});

test('privacy: not in website, agent, seller portal, anonymous AI input, PDFs or the anonymous send flow', () => {
  for (const f of ['listings.html', 'portal/portal.js', 'js/anonSummarySend.js', 'js/pdfPipeline.js', 'js/anonAgreementMark.js', 'js/waSendModule.js',
    'js/saleFileModule2.js', 'js/portal-business-card.js', 'anon-distributions.html', 'smart-matches.html', 'match-detail.html', 'business-report-builder.html',
    'supabase/functions/generate-anonymous-card/lib.ts', 'supabase/functions/generate-anonymous-card/index.ts', 'supabase/functions/generate-business-summary/index.ts',
    'supabase/functions/match-suggestions-report/index.ts', 'supabase/functions/match-suggestions-report/engine.js', 'supabase/functions/seller-portal-api/handler.ts',
    'supabase/functions/vip-api/index.ts', 'supabase/functions/send-sale-files-to-buyer/index.ts', 'supabase/functions/send-match-summary/index.ts'])
    assert.ok(!/pre_research/.test(read(f)), f);
  for (const name of ['bsdCollectAnonAiForm', 'bsdCollectInternalAiForm', 'bsdCollectOldTextsForMerge', 'computeAnonSourceFingerprint',
    'generateAndSaveSummaryPdf', 'maybeAutoRefreshAnonSummary', 'bsdSaveAnonSummaryOnly'])
    assert.ok(!/pre_research/.test(fnSrc(biz, name)), name);
  assert.ok(!/pre_research/.test(biz.match(/const ANON_SIGNIFICANT_FIELDS = [^\n]*/)[0]));
  // lead -> business transfer never pastes the research into notes (notes feed other summaries)
  assert.ok(!/pre_research/.test(fnSrc(hub, 'websiteLeadTransferNotes')));
  // edge-function column lists for agents are explicit (no select('*') that could pick up a new column)
  const msr = read('supabase/functions/match-suggestions-report/index.ts');
  assert.ok(!/from\('(businesses|leads)'\)\s*\.select\('\*'\)/.test(msr));
});

test('inline scripts of the three cards parse', () => {
  for (const src of [hub, leads, biz]) for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
});
