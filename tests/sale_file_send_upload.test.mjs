// Sale-file send (email or WhatsApp) and manual upload. No network, no Resend.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../js/saleFileModule2.js', import.meta.url), 'utf8');

function boot(extra){
  const state = { toasts: [], inserts: [], uploads: [], invokes: [], alerts: [], opened: [], reloaded: 0, reopened: null };
  const ctx = {
    window: {
      supabaseClient: {
        functions: { invoke(name, options){ state.invokes.push({ name, options }); return Promise.resolve(ctx.__invokeResult || { data: null, error: { message: 'not stubbed' } }); } },
        from(table){
          return { insert(row){ state.inserts.push({ table, row }); return Promise.resolve({ error: ctx.__dbError || null }); } };
        },
        auth: { getSession(){ return Promise.resolve({ data: { session: null }, error: null }); } },
      },
      BSD_CONFIG: { SUPABASE_URL: 'https://example.test', SUPABASE_PUBLISHABLE_KEY: 'k' },
      open(url){ state.opened.push(url); return ctx.__popup || null; },
    },
    console,
    navigator: { onLine: true, clipboard: { writeText(text){ state.copied = text; return Promise.resolve(); } } },
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])),
    toast(msg){ state.toasts.push(String(msg)); },
    alert(msg){ state.alerts.push(String(msg)); },
    confirm(){ return true; },
    isAndroidMobile(){ return !!ctx.__android; },
    bsdSetButtonLoading(){},
    bsdUploadFile(bucket, path, file){ state.uploads.push({ bucket, path, file }); return Promise.resolve(ctx.__uploadResult || { error: null }); },
    fetch(){ return Promise.reject(new Error('offline-test')); },
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    document: {
      getElementById(id){ return (ctx.__els && ctx.__els[id]) || null; },
      querySelectorAll(){ return ctx.__checked || []; },
      createElement(){ return { style: {}, appendChild(){}, setAttribute(){} }; },
      head: { appendChild(){} },
    },
    CURRENT_PROFILE: { id: 'staff-1', role: 'admin', email: 'staff@example.test' },
    state,
  };
  Object.assign(ctx, extra || {});
  ctx.window.open = ctx.window.open.bind(ctx);
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.__realOpenCategory = ctx.openSaleFileCategory;
  ctx.__realLoadModule = ctx.loadSaleFileModule;
  ctx.loadSaleFileModule = async () => { state.reloaded++; };
  ctx.openSaleFileCategory = (id, key) => { state.reopened = [id, key]; };
  return { ctx, state };
}

function fileInput(files){
  return { files, value: 'x' };
}

test('each sale-file category round-trips into the card bucket and the portal bucket', async () => {
  const { ctx } = boot();
  const { documentBucket } = await import('../supabase/functions/seller-portal-api/latest-files.ts');
  const cases = [
    ['anonymous_summary', 'exec_summary', 'anonymous_summary', 'anonymous_summary', 1],
    ['full_summary', 'exec_summary', 'internal_full_summary', 'full_summary', 2],
    ['market_research', 'other', 'market_research', 'market_research', 2],
    ['economic_analysis', 'economic_analysis', null, 'valuation', 2],
    ['business_photo', 'business_photo', null, null, 1],
    ['other', 'other', null, null, 2],
  ];
  for (const [key, category, documentType, portalBucket, level] of cases){
    const raw = { name: key + '.pdf', type: 'application/pdf', size: 10 };
    const row = ctx.sfManualUploadFields(key, raw, raw, 'biz/sale-file/' + key + '/1.pdf', 'biz', 'staff-1');
    assert.equal(row.category, category, key);
    assert.equal(row.document_type, documentType, key);
    assert.equal(row.confidentiality_level, level, key);
    assert.equal(row.source, 'manual_upload', key);
    assert.equal(row.status, 'active', key);
    assert.equal(ctx.sfBucketKeyForFile(row), key, key);
    const portal = documentBucket({ category: row.category, document_type: row.document_type, file_name: row.file_name, file_type: row.file_type });
    assert.equal(portal, portalBucket, key);
  }
});

test('storage keys stay ASCII even when the display name is Hebrew', () => {
  const { ctx } = boot();
  const path = ctx.sfSaleFileStoragePath('biz-1', 'market_research', 'חקר שוק סופי.pdf', 1000, 'ab12');
  assert.equal(path, 'biz-1/sale-file/market_research/1000_ab12.pdf');
  assert.doesNotMatch(path, /[^\x00-\x7F]/);
});

test('photo category accepts an image with an empty MIME type and rejects a PDF', () => {
  const { ctx } = boot();
  assert.equal(ctx.sfIsImageFile({ name: 'תמונה.JPG', type: '' }), true);
  assert.equal(ctx.sfIsImageFile({ name: 'תמונה.heic', type: 'application/octet-stream' }), true);
  assert.equal(ctx.sfIsImageFile({ name: 'דוח.pdf', type: 'application/pdf' }), false);
  assert.equal(ctx.sfIsImageFile({ name: 'צילום.png', type: 'image/png' }), true);
});

test('manual upload writes the category row and refreshes the open category', async () => {
  const { ctx, state } = boot();
  const input = fileInput([{ name: 'חקר שוק.pdf', type: 'application/pdf', size: 100 }]);
  ctx.__els = { sfUploadInput: input, sfUploadStatus: { textContent: '', innerHTML: '' }, sfUploadBtn: {} };
  vm.runInContext(`SF_FILES_BY_CATEGORY = {};`, ctx);
  await ctx.uploadSaleFiles('biz-9', 'market_research');
  assert.equal(state.uploads.length, 1);
  assert.equal(state.uploads[0].bucket, 'business-files');
  assert.match(state.uploads[0].path, /^biz-9\/sale-file\/market_research\/\d+_[a-z0-9]+\.pdf$/);
  const row = state.inserts.find(i => i.table === 'business_sale_files').row;
  assert.equal(row.category, 'other');
  assert.equal(row.document_type, 'market_research');
  assert.equal(row.file_name, 'חקר שוק.pdf');
  assert.equal(state.reloaded, 1);
  assert.deepEqual(state.reopened, ['biz-9', 'market_research']);
  assert.match(state.toasts.join('\n'), /הועלו בהצלחה/);
});

test('a non-image in the photo category is reported in Hebrew and is not uploaded', async () => {
  const { ctx, state } = boot();
  ctx.__els = {
    sfUploadInput: fileInput([{ name: 'טבלה.xlsx', type: 'application/vnd.ms-excel', size: 20 }]),
    sfUploadStatus: { textContent: '', innerHTML: '' },
    sfUploadBtn: {},
  };
  vm.runInContext(`SF_FILES_BY_CATEGORY = { business_photo: [] };`, ctx);
  await ctx.uploadSaleFiles('biz-9', 'business_photo', { fromChange: true });
  assert.equal(state.uploads.length, 0);
  assert.equal(state.inserts.filter(i => i.table === 'business_sale_files').length, 0);
  assert.match(state.toasts.join('\n'), /אינו קובץ תמונה/);
  assert.match(state.alerts.join('\n'), /ההעלאה נכשלה/);
  assert.match(ctx.__els.sfUploadStatus.innerHTML, /אינו קובץ תמונה/);
});

test('Android category panel includes an upload input and does not say desktop only', () => {
  const { ctx } = boot();
  ctx.__android = true;
  const panel = { innerHTML: '' };
  ctx.__els = { saleFileCategoryPanel: panel };
  vm.runInContext(`CURRENT_PROFILE = { id: 'a', role: 'admin', can_upload_sale_files: true }; SF_FILES_BY_CATEGORY = {};`, ctx);
  ctx.__realOpenCategory('biz-1', 'economic_analysis');
  assert.match(panel.innerHTML, /id="sfUploadInput"/);
  assert.match(panel.innerHTML, /ההעלאה מתחילה מיד/);
  assert.doesNotMatch(panel.innerHTML, /מהמחשב בלבד/);
  assert.match(panel.innerHTML, /שלח לקונה \/ מתווך/);
});

test('a buyer without an email can still open the WhatsApp choice, and email send refuses in Hebrew without calling the server', async () => {
  const { ctx, state } = boot();
  const file = { value: 'file-1', dataset: { name: 'תקציר.pdf', cat: 'תקציר אנונימי', conf: '1' }, checked: true };
  ctx.__checked = [file];
  ctx.__els = {
    sfSendStatus: { innerHTML: '', textContent: '', setAttribute(){} },
    sfSendModalBody: { innerHTML: '' },
    sfSendBuyer: { value: 'buyer-1' },
    sfSendBroker: { value: '' },
  };
  ctx.ALL_BIZ = [{ id: 'biz-1', internal_name: 'שם פנימי', anonymous_name: 'עסק אנונימי' }];
  vm.runInContext(`
    SF_SEND_RECIPIENT_TYPE = 'buyer';
    SF_SEND_BUYERS_CACHE = { 'buyer-1': { email: '', phone: '0501234567', full_name: 'קונה בלי מייל', agreement_status: 'אין הסכם' } };
    SF_SEND_BROKERS_CACHE = {};
    SF_SEND_OWNER_CACHE = null;
  `, ctx);
  ctx.sfShowSendPreview('biz-1', 'שם פנימי');
  const html = ctx.__els.sfSendModalBody.innerHTML;
  assert.match(html, /שלח בWhatsApp/);
  assert.match(html, /אין כתובת אימייל/);
  const subject = html.match(/id="sfPreviewSubject" value="([^"]*)"/)[1];
  const body = html.match(/id="sfPreviewBody"[^>]*>([\s\S]*?)<\/textarea>/)[1];
  assert.equal((subject + body).includes('שם פנימי'), false);
  assert.match(body, /עסק אנונימי/);
  assert.match(html, /שם פנימי/);
  await ctx.sfConfirmSend();
  assert.equal(state.invokes.length, 0);
  assert.match(state.toasts.join('\n'), /אין כתובת אימייל שמורה/);
  assert.match(ctx.__els.sfSendStatus.innerHTML, /אין כתובת אימייל/);
});

test('email success is visible, and a non-2xx body is shown in Hebrew instead of the generic English error', async () => {
  const { ctx, state } = boot();
  ctx.__els = {
    sfSendBtn: {},
    sfSendStatus: { innerHTML: '', textContent: '', setAttribute(){} },
    sfPreviewSubject: { value: 'נושא בדיקה' },
    sfPreviewBody: { value: 'שלום' },
    sfSendOverlay: { remove(){ state.closed = true; } },
  };
  vm.runInContext(`SF_PENDING_SEND = { bizId: 'biz-1', recipientId: 'buyer-1', recipientType: 'buyer', fileIds: ['file-1'], recipient: { email: 'buyer@example.test', phone: '0501234567', full_name: 'קונה', agreement_status: 'יש הסכם חתום' } };`, ctx);
  ctx.__invokeResult = { data: { ok: true, match_action: 'created' }, error: null };
  await ctx.sfConfirmSend();
  assert.equal(state.invokes[0].name, 'send-sale-files-to-buyer');
  assert.equal(state.invokes[0].options.body.buyer_id, 'buyer-1');
  assert.equal(state.invokes[0].options.body.dry_run, undefined);
  assert.match(state.toasts.join('\n'), /נוצרה התאמה חדשה/);
  assert.equal(state.closed, true);

  state.toasts.length = 0;
  state.closed = false;
  ctx.__invokeResult = { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { error: 'לקונה הזה אין הסכם סודיות חתום.' } } };
  await ctx.sfConfirmSend();
  assert.match(state.toasts.join('\n'), /אין הסכם סודיות חתום/);
  assert.doesNotMatch(state.toasts.join('\n'), /non-2xx/);
  assert.equal(state.closed, false);
});

test('expired session and a blocked popup are explicit, and a long file link is not stuffed into wa.me', async () => {
  const { ctx, state } = boot();
  const expired = await ctx.sfDescribeInvokeFailure(null, { message: 'Edge Function returned a non-2xx status code', status: 401, context: { message: 'Invalid JWT' } });
  assert.match(expired, /ההתחברות פגה/);
  assert.match(expired, /שום דבר לא נשלח/);

  const short = ctx.sfPlanWhatsAppDelivery('972501234567', 'שלום קונה', [{ name: 'תקציר.pdf', url: 'https://files.example.test/a' }]);
  assert.equal(short.mode, 'full');
  assert.match(short.url, /^https:\/\/wa\.me\/972501234567\?text=/);
  assert.match(decodeURIComponent(short.url), /תקציר\.pdf/);
  assert.match(decodeURIComponent(short.url), /https:\/\/files\.example\.test\/a/);

  const longUrl = 'https://files.example.test/' + 'x'.repeat(2000);
  const long = ctx.sfPlanWhatsAppDelivery('972501234567', 'שלום', [{ name: 'קובץ.pdf', url: longUrl }]);
  assert.equal(long.mode, 'clipboard');
  assert.ok(long.url.length <= 1800);
  assert.match(long.copyText, /קובץ\.pdf/);
  assert.equal(long.copyText.includes(longUrl), true);
  assert.equal(long.url.includes('xxxx'), false);

  ctx.__popup = null;
  ctx.__els = {
    sfSendWaBtn: {},
    sfSendStatus: { innerHTML: '', textContent: '', setAttribute(){} },
    sfPreviewSubject: { value: 'נושא' },
    sfPreviewBody: { value: 'שלום' },
  };
  ctx.__invokeResult = { data: { ok: true, links: [{ name: 'תקציר.pdf', url: 'https://files.example.test/a' }], buyer_phone: '0501234567' }, error: null };
  vm.runInContext(`SF_PENDING_SEND = { bizId: 'biz-1', recipientId: 'buyer-1', recipientType: 'buyer', fileIds: ['file-1'], recipient: { email: '', phone: '0501234567', full_name: 'קונה', agreement_status: 'יש הסכם חתום' } };`, ctx);
  const realOpen = ctx.window.open;
  ctx.window.open = () => null;
  await ctx.sfConfirmSendWhatsApp();
  ctx.window.open = realOpen;
  assert.match(state.toasts.join('\n'), /חסם את חלון הוואטסאפ/);
  assert.match(ctx.__els.sfSendStatus.innerHTML, /פתח את WhatsApp/);
  assert.match(ctx.__els.sfSendStatus.innerHTML, /wa\.me\/972501234567/);
});
