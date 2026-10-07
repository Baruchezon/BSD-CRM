// 07.10.2026 (אושר ע"י ברוך): התחברות שפגה בזמן עבודה.
// js/sessionExpired.js - זיהוי (401 / PGRST301 / JWT expired / invalid JWT / refresh / «לא מחובר»),
// רענון שקט אחד + ניסיון אחד, הודעה «ההתחברות פגה, התחבר מחדש» עם קישור כניסה, טיוטה במכשיר.
// tasks.html שמירת משימה: החלון נשאר פתוח, הטקסט במקומו, טיוטה נשמרת/משוחזרת/נמחקת.
// businesses.html כפתורי AI: ההודעה מוצגת בשורת הסטטוס, הטקסט בכרטיס נשמר כטיוטה.
// בלי שינוי בהתנתקות, בלי כפתורים חדשים, בלי שינוי נתונים.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const helperSrc = read('js/sessionExpired.js');
const tasksHtml = read('tasks.html');
const bizHtml = read('businesses.html');
const mwHtml = read('matches-workspace.html');
const quickHtml = read('task-quick.html');
const MESSAGE = 'ההתחברות פגה, התחבר מחדש';

function fnSrc(src, name){
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, name + ' missing');
  let i = src.indexOf('{', src.indexOf(')', start)), depth = 0;
  for (; i < src.length; i++){ if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
function declSrc(src, name){
  const m = src.match(new RegExp(`(?:const|let) ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, name + ' missing');
  return m[0].replace(/^(const|let) /, 'var ');
}

// ---------------------------------------------------------------- tiny DOM + browser sandbox
class El {
  constructor(tag = 'div', id = ''){ this.tagName = tag.toUpperCase(); this.id = id; this.style = {}; this.dataset = {}; this.attrs = {}; this.children = []; this.listeners = {}; this.value = ''; this.textContent = ''; this._html = ''; this.open = false; this.disabled = false; this.lastChild = null; }
  setAttribute(k, v){ this.attrs[k] = String(v); }
  getAttribute(k){ return this.attrs[k]; }
  addEventListener(t, f){ (this.listeners[t] ||= []).push(f); }
  appendChild(c){ this.children.push(c); if (this.doc && c.id) this.doc.els[c.id] = c; return c; }
  set innerHTML(h){ this._html = h; this.lastChild = new El('button'); }
  get innerHTML(){ return this._html; }
  get innerText(){ return this._html.replace(/<[^>]+>/g, ''); }
  querySelector(sel){ return this.q ? this.q[sel] || null : null; }
  dispatchEvent(){ return true; }
}
function makeStorage(){
  const m = new Map();
  return { get length(){ return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), _m: m };
}
// auth: { token } current session token (null = no session). refreshOk: refresh issues a new token.
function makeSandbox({ token = 'tok-1', refreshOk = false } = {}){
  const doc = { els: {}, getElementById(id){ return this.els[id] || null; }, createElement: t => new El(t), visibilityState: 'visible', addEventListener(){}, };
  doc.body = new El('body'); doc.body.doc = doc; doc.documentElement = doc.body;
  const winListeners = {};
  const authListeners = [];
  const auth = { token, refreshOk, refreshCalls: 0,
    getSession: async () => ({ data: { session: auth.token ? { access_token: auth.token } : null }, error: null }),
    refreshSession: async () => { auth.refreshCalls++; if (auth.refreshOk){ auth.token = 'tok-refreshed'; return { data: { session: { access_token: auth.token } }, error: null }; }
      auth.token = null; return { data: { session: null }, error: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' } }; },
    onAuthStateChange(cb){ authListeners.push(cb); return { data: { subscription: { unsubscribe(){} } } }; } };
  const ctx = { document: doc, localStorage: makeStorage(), console: { warn(){}, log(){}, error(){} }, setTimeout: (f, ms) => { const t = setTimeout(f, ms); if (ms > 50) t.unref(); return t; }, clearTimeout, Date, JSON, Promise, Error, Object, Array, String, Number, Math, RegExp, Event: class { constructor(t){ this.type = t; } },
    addEventListener(t, f){ (winListeners[t] ||= []).push(f); }, _fire(t, e = {}){ (winListeners[t] || []).forEach(f => f(e)); },
    supabaseClient: { auth, functions: {}, from(){ throw new Error('from() not mocked'); } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(helperSrc, ctx);
  const add = (id, tag = 'input', value = '') => { const e = new El(tag, id); e.value = value; doc.els[id] = e; return e; };
  return { ctx, doc, auth, add, authListeners, S: ctx.BSDSession, banner: () => doc.els.bsdSessionBanner || null };
}
const tick = () => new Promise(r => setTimeout(r, 5));

// ---------------------------------------------------------------- detection
test('bsdIsAuthExpiredError: detects 401 / PGRST301 / JWT expired / invalid JWT / refresh failure / edge 401', () => {
  const { ctx } = makeSandbox();
  const is = ctx.bsdIsAuthExpiredError;
  assert.equal(ctx.BSDSession.isAuthExpiredError, is);
  const yes = [
    { status: 401 },                                                            // supabase result / PostgREST 401 (anon insert after refresh failed, 06.10)
    { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "tasks"' }, status: 401 },
    { code: 'PGRST301', message: 'JWSError JWSInvalidSignature' },
    { code: 'PGRST303', message: 'JWT expired' },
    { message: 'JWT expired' },
    { message: 'invalid JWT: unable to parse or verify signature, token is expired' },
    { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' },
    { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
    { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 401 } }, // edge 401 «לא מחובר»
    { code: 'UNAUTHORIZED_INVALID_JWT_FORMAT', message: 'Invalid JWT' },          // edge gateway
    { error: 'לא מחובר' },
    { error: { message: 'JWT expired' } },
    'JWT expired',
  ];
  yes.forEach(x => assert.equal(is(x), true, JSON.stringify(x)));
  const no = [
    null, undefined, '', { status: 403, code: '42501', message: 'permission denied' }, { status: 500 }, { code: '23505', message: 'duplicate key' },
    { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }, { message: 'Failed to fetch' },
    { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 422 } },
    { data: [], error: null, status: 200 },
  ];
  no.forEach(x => assert.equal(is(x), false, JSON.stringify(x)));
});

// ---------------------------------------------------------------- run(): refresh + one retry + banner
test('run: 401 -> one silent refresh -> one retry succeeds, no message', async () => {
  const { S, auth, banner } = makeSandbox({ refreshOk: true });
  let calls = 0;
  const r = await S.run(async () => (++calls === 1 ? { data: null, error: { message: 'JWT expired' }, status: 401 } : { data: { ok: 1 }, error: null, status: 201 }));
  assert.equal(calls, 2); assert.equal(auth.refreshCalls, 1);
  assert.deepEqual({ ...r.data }, { ok: 1 }); assert.equal(r.error, null);
  assert.equal(banner(), null);
});

test('run: refresh fails -> message with login link, op not retried, onExpired called once', async () => {
  const { S, auth, banner } = makeSandbox({ refreshOk: false });
  let calls = 0, expiredCalls = 0;
  const r = await S.run(async () => { calls++; return { data: null, error: { code: '42501', message: 'rls' }, status: 401 }; }, { onExpired: () => expiredCalls++ });
  assert.equal(calls, 1, 'no retry with the same rejected token'); assert.equal(auth.refreshCalls, 1); assert.equal(expiredCalls, 1);
  assert.equal(r.authExpired, true); assert.equal(r.error.message, MESSAGE); assert.equal(r.error.bsdAuthExpired, true);
  const b = banner();
  assert.ok(b && b.style.display === 'block' && b.dataset.kind === 'expired');
  assert.equal(b.attrs.role, 'alert');
  assert.match(b.innerHTML, /ההתחברות פגה, <a href="login\.html" target="_blank"[^>]*>התחבר מחדש<\/a>/);
  assert.match(b.style.cssText, /position:fixed/); assert.match(b.style.cssText, /z-index:2147483000/);
});

test('run: no session before the write -> nothing is sent (no silent anon write), message shown', async () => {
  const { S, auth, banner } = makeSandbox({ token: null, refreshOk: false });
  let calls = 0;
  const r = await S.run(async () => { calls++; return { data: null, error: null, status: 204 }; });
  assert.equal(calls, 0); assert.equal(r.authExpired, true); assert.ok(banner()); assert.equal(auth.refreshCalls, 1);
});

test('run: re-login in another tab -> session picked up from storage, write goes through without reload', async () => {
  const { S, auth, banner } = makeSandbox({ token: null, refreshOk: false });
  await S.run(async () => ({ data: null, error: null }));
  assert.equal(banner().dataset.kind, 'expired');
  auth.token = 'tok-other-tab'; auth.refreshSession = async () => { auth.refreshCalls++; return { data: { session: null }, error: { message: 'x' } }; };
  // banner flips to "logged in again" on focus/storage/auth events
  const r = await S.run(async () => ({ data: { id: 't1' }, error: null, status: 201 }));
  assert.equal(r.error, null); assert.equal(r.data.id, 't1');
});

test('banner: login regained (focus / storage / SIGNED_IN) -> green "התחברת מחדש" notice', async () => {
  const sb = makeSandbox({ token: null });
  await sb.S.run(async () => ({ data: null, error: null }));
  assert.equal(sb.banner().dataset.kind, 'expired');
  sb.auth.token = 'tok-new';
  sb.ctx._fire('storage', { key: 'sb-zcdlegcvfirwzitfxjcs-auth-token', newValue: '{}' });
  await tick(); await tick();
  assert.equal(sb.banner().dataset.kind, 'ok');
  assert.match(sb.banner().innerHTML, /התחברת מחדש/);
  // SIGNED_IN through supabase-js BroadcastChannel also works
  const sb2 = makeSandbox({ token: null });
  await sb2.S.run(async () => ({ data: null, error: null }));
  sb2.authListeners.forEach(cb => cb('SIGNED_IN', { access_token: 'x' }));
  await tick();
  assert.equal(sb2.banner().dataset.kind, 'ok');
});

test('run: other errors are passed through untouched (no expiry message)', async () => {
  const { S, banner } = makeSandbox();
  const err = { code: '23514', message: 'violates check constraint' };
  const r = await S.run(async () => ({ data: null, error: err, status: 400 }));
  assert.equal(r.error, err); assert.equal(r.authExpired, undefined); assert.equal(banner(), null);
});

test('run: network trouble is never reported as expired', async () => {
  const { S, auth, banner } = makeSandbox();
  auth.getSession = async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } });
  const err = { message: 'TypeError: Failed to fetch' };
  const r = await S.run(async () => ({ data: null, error: err }));
  assert.equal(r.error, err); assert.equal(banner(), null);
});

// ---------------------------------------------------------------- drafts
test('drafts: saved per screen+record+user, empty not saved, other user never sees it, 7-day TTL, cleared', () => {
  const { S, ctx } = makeSandbox();
  assert.equal(S.saveDraft('tasks:new', { title: '  ', description: '' }, 'u1'), false);
  assert.equal(S.saveDraft('tasks:new', { title: 'להתקשר', description: 'פרטים' }, 'u1'), true);
  assert.equal(S.readDraft('tasks:new', 'u1').fields.title, 'להתקשר');
  assert.equal(S.readDraft('tasks:new', 'u2'), null);
  assert.equal(S.readDraft('tasks:t-9', 'u1'), null);
  assert.deepEqual([...S.listDrafts('tasks:', 'u1').map(d => d.key)], ['tasks:new']);
  const raw = JSON.parse(ctx.localStorage.getItem('bsd-draft:v1:tasks:new'));
  raw.savedAt = Date.now() - 8 * 24 * 3600 * 1000; ctx.localStorage.setItem('bsd-draft:v1:tasks:new', JSON.stringify(raw));
  assert.equal(S.readDraft('tasks:new', 'u1'), null);
  assert.equal(ctx.localStorage.getItem('bsd-draft:v1:tasks:new'), null, 'expired draft removed');
  S.saveDraft('tasks:new', { title: 'x' }, 'u1'); S.clearDraft('tasks:new');
  assert.equal(S.readDraft('tasks:new', 'u1'), null);
});

// ---------------------------------------------------------------- tasks.html: save task
function tasksSandbox(opts){
  const sb = makeSandbox(opts);
  const { add, ctx, doc } = sb;
  const form = add('taskForm', 'form'); const submit = new El('button'); form.q = { 'button[type="submit"]': submit };
  add('title', 'input', 'להתקשר לאלעד שוחט לגבי עסק בנתניה'); add('description', 'textarea', 'לשאול על תקציב ותחום.');
  add('due_date'); add('due_time'); add('priority', 'select', 'רגילה'); add('assigned_to', 'select', 'u1'); add('related_type', 'select', '');
  add('taskFormMsg', 'div');
  const calls = { toast: [], closeModal: 0, loadTasks: 0, writes: [] };
  sb.respond = () => ({ data: null, error: null, status: 201 });
  ctx.supabaseClient.from = table => {
    const rec = { table }; const q = {
      insert(v){ rec.op = 'insert'; rec.values = v; return q; }, update(v){ rec.op = 'update'; rec.values = v; return q; }, eq(){ return q; },
      then(a, b){ calls.writes.push(rec); return Promise.resolve(sb.respond(rec)).then(a, b); } };
    return q; };
  Object.assign(ctx, { CURRENT_PROFILE: { id: 'u1' }, ALL_MATCHES: [], ALL_TASKS: [], bsdSetButtonLoading(){}, toast: m => calls.toast.push(m), closeModal: () => calls.closeModal++,
    loadTasks: async () => calls.loadTasks++, onTaskRelatedTypeChange(){}, onTaskRelatedRecordChange(){} });
  vm.runInContext([declSrc(tasksHtml, 'TASK_DRAFT_FIELDS'), ...['taskDraftKey', 'setTaskFormMsg', 'saveTaskDraft', 'restoreTaskDraft', 'cancelTaskForm', 'saveTask'].map(n => fnSrc(tasksHtml, n))].join('\n'), ctx);
  sb.calls = calls; sb.form = form;
  sb.save = () => ctx.saveTask({ preventDefault(){}, target: form });
  return sb;
}

test('tasks.html: save on 401 keeps the dialog open + text in place, shows «ההתחברות פגה, התחבר מחדש», saves a draft', async () => {
  const sb = tasksSandbox({ refreshOk: false });
  sb.respond = () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "tasks"' }, status: 401 });
  await sb.save();
  assert.equal(sb.calls.closeModal, 0, 'dialog stays open');
  assert.equal(sb.doc.els.title.value, 'להתקשר לאלעד שוחט לגבי עסק בנתניה');
  assert.equal(sb.doc.els.description.value, 'לשאול על תקציב ותחום.');
  const msg = sb.doc.els.taskFormMsg;
  assert.equal(msg.style.display, 'block'); assert.ok(msg.textContent.includes(MESSAGE), msg.textContent);
  assert.ok(sb.banner() && sb.banner().innerHTML.includes('התחבר מחדש'));
  assert.ok(!sb.calls.toast.some(t => /נשמר בהצלחה/.test(t)));
  const d = sb.S.readDraft('tasks:new', 'u1');
  assert.equal(d.fields.title, 'להתקשר לאלעד שוחט לגבי עסק בנתניה'); assert.equal(d.fields.description, 'לשאול על תקציב ותחום.');

  // re-login (other tab) -> pressing «שמירה» again works without reload; draft cleared
  sb.auth.token = 'tok-relogin';
  sb.respond = () => ({ data: null, error: null, status: 201 });
  await sb.save();
  assert.equal(sb.calls.closeModal, 1); assert.ok(sb.calls.toast.includes('נשמר בהצלחה'));
  assert.equal(sb.S.readDraft('tasks:new', 'u1'), null, 'draft cleared after a successful save');
  const ok = sb.calls.writes.at(-1); assert.equal(ok.op, 'insert'); assert.equal(ok.values.title, 'להתקשר לאלעד שוחט לגבי עסק בנתניה');
});

test('tasks.html: editing a task with no session sends no UPDATE (no silent 0-row "save")', async () => {
  const sb = tasksSandbox({ token: null, refreshOk: false });
  sb.form.dataset.taskId = 'task-7';
  await sb.save();
  assert.equal(sb.calls.writes.length, 0); assert.equal(sb.calls.closeModal, 0);
  assert.ok(sb.doc.els.taskFormMsg.textContent.includes(MESSAGE));
  assert.equal(sb.S.readDraft('tasks:task-7', 'u1').fields.title, 'להתקשר לאלעד שוחט לגבי עסק בנתניה');
});

test('tasks.html: other save errors are shown in Hebrew inside the dialog (not swallowed)', async () => {
  const sb = tasksSandbox();
  sb.respond = () => ({ data: null, error: { code: '23514', message: 'violates check constraint' }, status: 400 });
  await sb.save();
  assert.equal(sb.calls.closeModal, 0);
  assert.match(sb.doc.els.taskFormMsg.textContent, /^שגיאה בשמירה — המשימה לא נשמרה \(violates check constraint\)/);
  assert.equal(sb.banner(), null, 'no expiry message for a non-auth error');
});

test('tasks.html: draft restored into the same fields after re-login; cancel while logged in discards it', async () => {
  const sb = tasksSandbox();
  sb.S.saveDraft('tasks:new', { title: 'משימה שהוקלדה', description: 'תוכן', priority: 'דחופה', related_type: '' }, 'u1');
  sb.doc.els.title.value = ''; sb.doc.els.description.value = ''; sb.doc.els.priority.value = 'רגילה';
  assert.equal(sb.ctx.restoreTaskDraft(''), true);
  assert.equal(sb.doc.els.title.value, 'משימה שהוקלדה'); assert.equal(sb.doc.els.description.value, 'תוכן'); assert.equal(sb.doc.els.priority.value, 'דחופה');
  assert.match(sb.doc.els.taskFormMsg.textContent, /שוחזר הטקסט/);
  // another user on the same device never gets it
  sb.ctx.CURRENT_PROFILE = { id: 'u2' }; sb.doc.els.title.value = '';
  assert.equal(sb.ctx.restoreTaskDraft(''), false); assert.equal(sb.doc.els.title.value, '');
  sb.ctx.CURRENT_PROFILE = { id: 'u1' };
  await sb.ctx.cancelTaskForm();
  assert.equal(sb.S.readDraft('tasks:new', 'u1'), null);
  // cancel while logged out keeps the draft
  const sb2 = tasksSandbox({ token: null });
  sb2.S.saveDraft('tasks:new', { title: 'x' }, 'u1');
  await sb2.ctx.cancelTaskForm();
  assert.ok(sb2.S.readDraft('tasks:new', 'u1'));
});

// ---------------------------------------------------------------- businesses.html: AI buttons
function bizSandbox(opts){
  const sb = makeSandbox(opts);
  const { add, ctx } = sb;
  const form = add('bizForm', 'form'); form.dataset.bizId = 'biz-1';
  vm.runInContext(declSrc(bizHtml, 'BIZ_GUARDED_TEXT_FIELDS'), ctx);
  const server = { id: 'biz-1', short_description: 'מידע מהשרת', notes: 'הערה ישנה' };
  ctx.BIZ_GUARDED_TEXT_FIELDS.forEach(f => { if (!(f in server)) server[f] = ''; add(f, 'textarea', server[f]); });
  add('aiStatus_notes', 'div'); add('aiImprove_notes', 'button');
  const calls = { toast: [], invoke: [] };
  sb.fnRespond = () => ({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError', context: { status: 401, json: async () => ({ error: 'לא מחובר' }) } }) });
  ctx.supabaseClient.functions.invoke = async (name, o) => { calls.invoke.push(name); return sb.fnRespond(name, o); };
  Object.assign(ctx, { CURRENT_PROFILE: { id: 'u1' }, bsdSetButtonLoading(){}, toast: m => calls.toast.push(m), openAiTextPreview: (...a) => (calls.preview = a), bsdCollectOldTextsForMerge: () => [] });
  vm.runInContext([declSrc(bizHtml, 'BIZ_GUARDED_FIELD_LABELS'), 'var BIZ_FORM_BASELINE = null;',
    ...['bsdNormText', 'bsdCaptureBizFormBaseline', 'anonFunctionErrorMessage', 'bsdInvokeAiFn', 'bsdBizDraftKey', 'bsdSaveBizCardDraft', 'bsdRestoreBizCardDraft',
      'invokeAnonCardFn', 'invokeBusinessSummaryFn', 'invokeImproveTextFn', 'runAiImprove'].map(n => fnSrc(bizHtml, n))].join('\n'), ctx);
  ctx.bsdCaptureBizFormBaseline(server);
  sb.server = server; sb.calls = calls;
  return sb;
}

test('businesses.html AI button: edge 401 «לא מחובר» -> status line «❌ ההתחברות פגה, התחבר מחדש», text kept, draft saved', async () => {
  const sb = bizSandbox({ refreshOk: false });
  sb.doc.els.notes.value = 'הערה ישנה + טקסט חדש שהקלדתי';
  await sb.ctx.runAiImprove('notes');
  assert.equal(sb.doc.els.aiStatus_notes.textContent, '❌ ' + MESSAGE);
  assert.ok(sb.calls.toast.includes('❌ ' + MESSAGE));
  assert.ok(!/non-2xx|לא מחובר/.test(sb.doc.els.aiStatus_notes.textContent));
  assert.equal(sb.doc.els.notes.value, 'הערה ישנה + טקסט חדש שהקלדתי');
  assert.ok(sb.banner() && sb.banner().innerHTML.includes('href="login.html"'));
  const d = sb.S.readDraft('businesses:biz-1', 'u1');
  assert.deepEqual(Object.keys(d.fields), ['notes'], 'only edited, unsaved fields');
  assert.equal(d.fields.notes, 'הערה ישנה + טקסט חדש שהקלדתי'); assert.equal(d.meta.dbBase.notes, 'הערה ישנה');
});

test('businesses.html AI helpers: all three go through the shared helper; silent refresh + retry succeeds', async () => {
  for (const [fn, name] of [['invokeImproveTextFn', 'improve-business-text'], ['invokeAnonCardFn', 'generate-anonymous-card'], ['invokeBusinessSummaryFn', 'generate-business-summary']]){
    const sb = bizSandbox({ refreshOk: true });
    let n = 0;
    const deny = sb.fnRespond;
    sb.fnRespond = (...a) => (++n === 1 ? deny(...a) : { data: { ok: true, improved_text: 't' }, error: null });
    const args = fn === 'invokeImproveTextFn' ? ['notes', 'x', false, []] : [{ business_id: 'biz-1' }];
    const data = await sb.ctx[fn](...args);
    assert.equal(data.ok, true, fn); assert.deepEqual(sb.calls.invoke, [name, name], fn); assert.equal(sb.banner(), null, fn);
    // still expired after refresh -> throws the Hebrew message
    const sb2 = bizSandbox({ refreshOk: false });
    await assert.rejects(sb2.ctx[fn](...args), e => e.message === MESSAGE, fn);
  }
  // non-auth edge errors keep their own message
  const sb3 = bizSandbox();
  sb3.fnRespond = () => ({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: { status: 422, json: async () => ({ error: 'אין מספיק מידע' }) } }) });
  await assert.rejects(sb3.ctx.invokeImproveTextFn('notes', 'x', false, []), e => e.message === 'אין מספיק מידע');
  assert.equal(sb3.banner(), null);
});

test('businesses.html: card draft restored after re-login only where the server text did not change', () => {
  const sb = bizSandbox();
  sb.S.saveDraft('businesses:biz-1', { notes: 'טקסט שלא נשמר', short_description: 'עריכה שלי' }, 'u1', { dbBase: { notes: 'הערה ישנה', short_description: 'ישן' } });
  // card reopened: notes unchanged on the server -> restored; short_description changed since -> not overwritten
  const restored = sb.ctx.bsdRestoreBizCardDraft(sb.server);
  assert.deepEqual([...restored], ['הערות']);
  assert.equal(sb.doc.els.notes.value, 'טקסט שלא נשמר');
  assert.equal(sb.doc.els.short_description.value, 'מידע מהשרת');
  assert.equal(sb.banner().dataset.kind, 'info'); assert.match(sb.banner().innerHTML, /שוחזר טקסט שלא נשמר/);
});

// ---------------------------------------------------------------- wiring / scope guards
test('wiring: helper loaded on the changed pages; task dialogs + AI helpers use it; drafts cleared on success', () => {
  for (const [name, html] of [['tasks.html', tasksHtml], ['businesses.html', bizHtml], ['matches-workspace.html', mwHtml], ['task-quick.html', quickHtml]]){
    assert.match(html, /<script src="js\/sessionExpired\.js\?v=202610071530"><\/script>/, name);
    assert.ok(html.indexOf('js/sessionExpired.js') > html.indexOf('js/auth.js'), name + ': after auth.js');
  }
  assert.match(fnSrc(tasksHtml, 'saveTask'), /BSDSession\.run\(writeTask/);
  assert.match(fnSrc(mwHtml, 'saveQuickTask'), /BSDSession\.run\(/);
  assert.match(fnSrc(quickHtml, 'saveTask'), /BSDSession\.run\(/);
  assert.doesNotMatch(fnSrc(quickHtml, 'saveTask'), /renderNoAuth\(/, 'no longer throws away the confirm screen');
  for (const f of ['invokeImproveTextFn', 'invokeAnonCardFn', 'invokeBusinessSummaryFn']){
    assert.match(fnSrc(bizHtml, f), /bsdInvokeAiFn\(/, f); assert.doesNotMatch(fnSrc(bizHtml, f), /supabaseClient\.functions\.invoke/, f);
  }
  assert.match(fnSrc(bizHtml, 'saveBiz'), /BSDSession\.clearDraft\(bsdBizDraftKey\(bizId\)\)/);
  assert.match(fnSrc(bizHtml, 'openBizForm'), /bsdCaptureBizFormBaseline\(biz\);\s*bsdRestoreBizCardDraft\(biz\);/);
  const ver = JSON.parse(read('version.json')).version;
  assert.equal(ver, '202610071530');
  for (const html of [tasksHtml, bizHtml, mwHtml]) assert.match(html, new RegExp(`PAGE_BUILD = '${ver}'`));
});

test('scope: no logout change, no data write in the helper, no new buttons', () => {
  const code = helperSrc.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /signOut|bsdLogout|bsdFullLogout|from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(code, /location\.(href|replace|assign)\s*=?/, 'never navigates away from the open dialog');
  const auth = read('js/auth.js');
  assert.match(auth, /function bsdFullLogout|bsdFullLogout/); // untouched file still has its logout
  // the only <button> the helper creates is the banner's × close control
  assert.equal((helperSrc.match(/<button/g) || []).length, 1);
  assert.match(helperSrc, /aria-label="סגירת ההודעה"/);
});
