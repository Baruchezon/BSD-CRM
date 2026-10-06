// 06.10.2026 - «📤 שליחת תקצירים אנונימיים»: the old «שלח מצגות לקונה» button.
// All businesses with an anonymous summary, anonymous content only (latest saved
// PDF or PDF from the current anonymous text), WhatsApp file share, and the match
// in «מרכז ההתאמות» is created/updated automatically (never duplicated).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../js/anonSummarySend.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
const help = fs.readFileSync(new URL('../help.html', import.meta.url), 'utf8');
const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'); // without comment lines
const arr = x => JSON.parse(JSON.stringify(x)); // vm arrays come from another realm

function load(extra){
  const ctx = Object.assign({ window: {}, console }, extra || {});
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { api: ctx.window.BSDAnonSend, ctx };
}
const { api } = load();

const biz = {
  id: 'b1', business_number: 'BSD-B-2607-1002', internal_name: 'סטאר לנד', owner_name: 'יוסי כהן', owner_phone: '052-1234567',
  owner_email: 'yossi@example.com', city: 'כפר קאסם', region: 'אזור המרכז', address: 'הרצל 12', website: 'starland.co.il',
  net_profit: 280000, operating_profit: 350000, anon_display_name: 'משחקייה ומתחם אטרקציות', anon_summary: 'משחקייה פעילה באזור המרכז.',
};

test('button: same toolbar button, renamed, opens the new modal; no new buttons', () => {
  assert.match(html, /<button class="btn btn-ghost" id="sendPresoToolbarBtn" onclick="openAnonSummarySendModal\(\)">📤 שליחת תקצירים אנונימיים<\/button>/);
  assert.equal((html.match(/id="sendPresoToolbarBtn"/g) || []).length, 1, 'still exactly one toolbar button');
  assert.doesNotMatch(html, /שלח מצגות לקונה<\/button>/);
  assert.match(html, /<script src="js\/anonSummarySend\.js\?v=\d+"><\/script>/);
  assert.ok(html.indexOf('js/anonSummarySend.js') > html.indexOf('js/pdfPipeline.js'));
  // existing permission hiding still targets the same button id
  assert.match(html, /if \(!canSendPresentations\(\)\)\{ const presoBtn = document\.getElementById\('sendPresoToolbarBtn'\)/);
  assert.match(help, /שליחת תקצירים אנונימיים/);
});

test('list: every active business with an anonymous summary (no legacy-file filter, no count limit)', () => {
  const list = [
    { id: '1', business_number: 'A1', anon_summary: 'יש', anon_presentation_path: null },
    { id: '2', business_number: 'A2', anon_summary: '  ' },
    { id: '3', business_number: 'A3', anon_summary: 'יש', is_archived: true },
    { id: '4', business_number: 'A4', anon_summary: 'יש', anon_presentation_path: 'x.pdf' },
  ];
  for (let i = 0; i < 60; i++) list.push({ id: 'n' + i, business_number: 'N' + String(i).padStart(2, '0'), anon_summary: 'טקסט' });
  const out = api.eligibleBusinesses(list).map(b => b.id);
  assert.equal(out.length, 62);
  assert.ok(out.includes('1') && out.includes('4'));
  assert.ok(!out.includes('2') && !out.includes('3'));
  assert.doesNotMatch(code, /anon_presentation_path/, 'never limited to / never sends the legacy July presentation files');
  assert.doesNotMatch(code, /\.slice\(0,\s*\d+\)/, 'no hidden count limit');
});

test('search box filters businesses by number / anonymous name / field / region', () => {
  const b = { business_number: 'BSD-B-2607-1013', anon_display_name: 'מאפייה ותיקה', field: 'מזון', region: 'אזור השרון' };
  assert.ok(api.bizMatchesQuery(b, '1013'));
  assert.ok(api.bizMatchesQuery(b, 'מאפייה'));
  assert.ok(api.bizMatchesQuery(b, 'השרון'));
  assert.ok(!api.bizMatchesQuery(b, 'גלידה'));
  assert.ok(api.bizMatchesQuery(b, ''));
  assert.match(src, /id="anonSendBizSearch"/);
  assert.match(src, /searchSelectHTML\(\{ boxId: 'anonSendBuyerSelect'/, 'buyer search box is a always-visible typing box');
});

test('privacy scan: blocks city, address, profit, phone, email, link, real name; allows region + turnover', () => {
  assert.deepEqual(arr(api.scanAnonText('משחקייה פעילה באזור המרכז, מחזור שנתי של כ-1.2 מיליון ₪.', biz)), []);
  const has = (t, re) => assert.ok(api.scanAnonText(t, biz).some(h => re.test(h)), t);
  has('העסק נמצא בכפר קאסם', /העיר/);
  has('ממוקם ברחוב הרצל 12', /כתובת|הרצל/);
  has('רווח נקי של 280 אלף', /רווח/);
  has('העסק רווחי מאוד', /רווח/);
  has('הכנסה פנויה 280,000 ₪', /רווח/);
  has('לפרטים 052-1234567', /טלפון/);
  has('yossi@example.com', /אימייל|מייל/);
  has('www.starland.co.il', /קישור|אתר/);
  has('סטאר לנד היא משחקייה', /שם העסק/);
  assert.ok(!api.PROFIT_WORD_RE.test('מרווח גדול לחניה'), '"מרווח" (space) is not profit');
  assert.deepEqual(arr(api.scanAnonText('', biz)), ['אין תקציר אנונימי']);
  // city inside the business region is allowed (region is allowed)
  assert.deepEqual(arr(api.scanAnonText('עסק באזור ירושלים', { city: 'ירושלים', region: 'אזור ירושלים' })), []);
});

test('source: latest saved PDF only when it is fresh and anonymous level 1, otherwise build from current text', () => {
  const f = { id: 'f', confidentiality_level: 1 };
  assert.equal(api.chooseSource(f, true), 'saved');
  assert.equal(api.chooseSource(f, false), 'generate');
  assert.equal(api.chooseSource(f, null), 'generate', 'unknown freshness never counts as fresh');
  assert.equal(api.chooseSource({ id: 'f', confidentiality_level: 2 }, true), 'generate');
  assert.equal(api.chooseSource(null, true), 'generate');
  // latest = first row ordered by created_at desc; only active anonymous-summary rows
  assert.match(src, /\.eq\('status', 'active'\)\.in\('business_id'/);
  assert.match(src, /\.or\('document_type\.eq\.anonymous_summary,category\.eq\.anon_presentation'\)/);
  assert.match(src, /\.order\('created_at', \{ ascending: false \}\)/);
  assert.match(src, /if \(!latestBy\[f\.business_id\]\) latestBy\[f\.business_id\] = f;/);
});

test('content sent = anonymous text only (never description / notes / internal summary / profit fields)', () => {
  const prep = src.slice(src.indexOf('async function buildPdfFromText'), src.indexOf('async function shareFiles'));
  assert.match(prep, /bodyEl\.textContent = normText\(biz\.anon_summary\)\.trim\(\)/);
  assert.match(prep, /const hits = scanAnonText\(bizAnonText\(biz\), biz\);\n\s+if \(hits\.length\) throw/, 'fresh row is re-scanned before every send');
  for (const field of ['short_description', 'notes', 'internal_business_summary', 'sale_reason', 'asking_price']) {
    assert.ok(!new RegExp('biz\\.' + field).test(prep), field + ' must never be used in the sent file');
  }
  assert.doesNotMatch(prep, /saveAutoGeneratedSummaryPdf|bsdSyncLatestAnonPdf|admin_publish_business|\.upload\(/, 'sending never saves or publishes');
});

test('file name and WhatsApp greeting carry no business details', () => {
  assert.equal(api.pdfFileName(biz), 'תקציר אנונימי BSD-B-2607-1002.pdf');
  assert.equal(api.pdfFileName({}), 'תקציר אנונימי.pdf');
  const g = api.waGreeting({ full_name: 'יובל כהן' });
  assert.match(g, /^שלום יובל,/);
  assert.doesNotMatch(g, /סטאר|כפר|רווח/);
});

test('phone normalisation for wa.me', () => {
  assert.deepEqual({ ...api.normalizePhone('052-566-8003') }, { valid: true, reason: null, e164: '972525668003' });
  assert.deepEqual({ ...api.normalizePhone('+972 52 566 8003') }, { valid: true, reason: null, e164: '972525668003' });
  assert.equal(api.normalizePhone('').reason, 'missing');
  assert.equal(api.normalizePhone('12345').valid, false);
});

test('WhatsApp: device share sheet with the PDF file; desktop fallback = download + open the buyer chat', () => {
  assert.match(src, /navigator\.canShare\(\{ files \}\)/);
  assert.match(src, /await navigator\.share\(\{ files, title: /);
  assert.doesNotMatch(src, /navigator\.share\(\{[^}]*text:/, 'no text next to files (iOS WhatsApp drops files when text is added)');
  assert.match(src, /e\.name === 'AbortError'\)\{ setStatus\('השליחה בוטלה\. לא סומן כלום בהתאמות\.'/);
  assert.match(src, /a\.download = p\.file\.name/);
  assert.match(src, /https:\/\/wa\.me\/\$\{phone\.e164\}\?text=/);
  assert.doesNotMatch(src, /functions\.invoke|createSignedUrl|api\.resend|graph\.facebook/, 'free: no paid API, no edge function, no links');
});

test('match plan: never duplicates, new = «תקציר נשלח», early stages move forward, later stages kept', () => {
  const ctx = { nowIso: '2026-10-06T13:00:00.000Z', actionText: 'x', bizId: 'b1', buyerId: 'l1', userId: 'u1' };
  const ins = api.planMatchWrite(null, ctx);
  assert.equal(ins.op, 'insert');
  assert.equal(ins.payload.status, 'תקציר נשלח');
  assert.equal(ins.payload.counterparty_type, 'buyer');
  assert.equal(ins.payload.material_type, 'תקציר אנונימי');
  assert.equal(ins.payload.material_sent_at, ctx.nowIso);
  for (const st of ['התאמה חדשה', 'מידע ראשוני נשלח', 'נחתמה סודיות']) {
    const u = api.planMatchWrite({ id: 'm1', status: st }, ctx);
    assert.equal(u.op, 'update'); assert.equal(u.payload.status, 'תקציר נשלח');
  }
  for (const st of ['במשא ומתן', 'נקבעה פגישה', 'חומרים מלאים נשלחו', 'הקונה לא מעוניין', 'נדרש עדכון', 'תקציר נשלח']) {
    const u = api.planMatchWrite({ id: 'm1', status: st }, ctx);
    assert.equal(u.op, 'update'); assert.ok(!('status' in u.payload), st + ' must not be changed');
    assert.equal(u.payload.material_type, 'תקציר אנונימי');
  }
});

function fakeDb(initialMatches, opts = {}){
  const ops = [];
  const db = { matches: initialMatches.slice() };
  function from(table){
    const q = { table, filters: {}, op: 'select', payload: null };
    const b = {
      select(){ return b; }, eq(k, v){ q.filters[k] = v; return b; }, single(){ return b; }, maybeSingle(){ return b; },
      insert(p){ q.op = 'insert'; q.payload = p; return b; }, update(p){ q.op = 'update'; q.payload = p; return b; },
      then(res, rej){
        ops.push({ table, op: q.op, payload: q.payload, filters: { ...q.filters } });
        let out = { data: null, error: null };
        if (table === 'matches' && q.op === 'select') out.data = db.matches.find(m => m.business_id === q.filters.business_id && m.buyer_id === q.filters.buyer_id) || null;
        if (table === 'matches' && q.op === 'insert'){
          if (opts.raceOnInsert){ db.matches.push({ id: 'race', status: 'התאמה חדשה', business_id: q.payload.business_id, buyer_id: q.payload.buyer_id }); opts.raceOnInsert = false; out.error = { code: '23505', message: 'duplicate' }; }
          else { const m = { id: 'new1', ...q.payload }; db.matches.push(m); out.data = { id: 'new1' }; }
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  }
  return { ops, client: { from } };
}

const prepared = (savedFile) => ({ biz: { id: 'b1', business_number: 'BSD-B-2607-1002' }, source: savedFile ? 'saved' : 'generate', savedFile, file: { name: 'תקציר אנונימי BSD-B-2607-1002.pdf' }, text: 'טקסט אנונימי' });

test('after send: new match + activity log + anon distribution (generated PDF => primary + snapshot)', async () => {
  const { ops, client } = fakeDb([]);
  const logged = [];
  const { api: a } = load({ window: { supabaseClient: client, bsdLogActivity: (...x) => logged.push(x) } });
  const action = await a._recordOne(prepared(null), { id: 'l1' }, { id: 'u1' }, 'share');
  assert.equal(action, 'created');
  const ins = ops.find(o => o.table === 'matches' && o.op === 'insert');
  assert.equal(ins.payload.status, 'תקציר נשלח');
  assert.equal(ins.payload.buyer_id, 'l1');
  const mal = ops.find(o => o.table === 'match_activity_log');
  assert.equal(mal.payload.match_id, 'new1'); assert.equal(mal.payload.attached_file_id, null);
  const dist = ops.find(o => o.table === 'anon_distributions');
  assert.equal(dist.payload.distribution_type, 'primary');
  assert.equal(dist.payload.summary_snapshot, 'טקסט אנונימי');
  assert.equal(dist.payload.channel, 'whatsapp');
  assert.equal(dist.payload.match_id, 'new1');
  assert.equal(logged[0][0], 'anon_summary_sent_whatsapp');
});

test('after send: existing match is updated, not duplicated (saved PDF => extended + file id)', async () => {
  const { ops, client } = fakeDb([{ id: 'm9', status: 'במשא ומתן', business_id: 'b1', buyer_id: 'l1' }]);
  const { api: a } = load({ window: { supabaseClient: client } });
  const action = await a._recordOne(prepared({ id: 'f7', version_number: 3 }), { id: 'l1' }, { id: 'u1' }, 'download');
  assert.equal(action, 'updated');
  assert.ok(!ops.some(o => o.table === 'matches' && o.op === 'insert'));
  const upd = ops.find(o => o.table === 'matches' && o.op === 'update');
  assert.equal(upd.filters.id, 'm9'); assert.ok(!('status' in upd.payload));
  const dist = ops.find(o => o.table === 'anon_distributions');
  assert.equal(dist.payload.distribution_type, 'extended');
  assert.equal(dist.payload.anon_file_id, 'f7'); assert.equal(dist.payload.anon_file_source, 'sale_file');
  assert.equal(ops.find(o => o.table === 'match_activity_log').payload.attached_file_id, 'f7');
});

test('after send: a concurrent insert (unique buyer+business) falls back to update', async () => {
  const { ops, client } = fakeDb([], { raceOnInsert: true });
  const { api: a } = load({ window: { supabaseClient: client } });
  const action = await a._recordOne(prepared(null), { id: 'l1' }, { id: 'u1' }, 'share');
  assert.equal(action, 'updated');
  const upd = ops.find(o => o.table === 'matches' && o.op === 'update');
  assert.equal(upd.filters.id, 'race'); assert.equal(upd.payload.status, 'תקציר נשלח');
});

test('buyer without agreement is blocked (same rule as before)', () => {
  assert.match(src, /if \(!b\.agreement_status \|\| b\.agreement_status === 'אין הסכם'\) return/);
});
