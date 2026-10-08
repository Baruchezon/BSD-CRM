// 08.10.2026 (ברוך): portal emails — full preview before sending, a ✅/❌ result after EVERY send from a real
// status check, and «מיילים שנשלחו» in the business card (password never stored or shown).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const card = fs.readFileSync(path.join(root, 'js/portal-business-card.js'), 'utf8');
const ctx = { window: {}, console }; vm.createContext(ctx); vm.runInContext(card, ctx);
const P = ctx.window.BSDSellerPortal;
const res = { to: 'owner@example.com', bcc: 'baruch@bsd-bbi.co.il', log_id: 'L1', resend_id: 're_1' };

test('result: never silent — ✅ נשלח מייל / ❌ לא נשלח, with the delivery status in Hebrew', () => {
  assert.match(P.mailResultHtml({ phase: 'sending' }), /⏳ שולח את המייל/);
  assert.match(P.mailResultHtml({ phase: 'checking', res }), /בודק מסירה/);
  const ok = P.mailResultHtml({ phase: 'status', res, event: 'delivered', checked_at: '2026-10-08T13:30:00Z' });
  assert.ok(ok.includes('✅ נשלח מייל') && ok.includes('נמסר לתיבת הנמען') && ok.includes('owner@example.com') && ok.includes('baruch@bsd-bbi.co.il'));
  const pending = P.mailResultHtml({ phase: 'status', res, event: 'sent' });
  assert.ok(pending.includes('✅ נשלח מייל') && pending.includes('יצא מהשרת, עדיין אין אישור מסירה') && pending.includes('ממשיך לבדוק'));
  const unknown = P.mailResultHtml({ phase: 'status', res });
  assert.ok(unknown.includes('✅ נשלח מייל') && unknown.includes('לא הצלחנו לבדוק כרגע'), 'Resend accepted, lookup failed: said so');
  for (const ev of ['bounced', 'failed', 'canceled']) {
    const h = P.mailResultHtml({ phase: 'status', res, event: ev });
    assert.ok(h.includes('❌ לא נשלח') && !h.includes('✅'), ev);
  }
  const failed = P.mailResultHtml({ phase: 'failed', error: { message: 'המייל לא נשלח והסיסמה לא השתנתה', code: 'send_failed', reason: 'The bsd-bbi.co.il domain is not verified.' } });
  assert.ok(failed.includes('❌ לא נשלח') && failed.includes('הסיסמה לא השתנתה') && failed.includes('כתובת השולח לא מאומתת'));
  assert.match(P.mailResultHtml({ phase: 'failed', error: { code: 'network', message: 'x' } }), /לא התקבלה תשובה מהשרת/);
  for (const s of [{ phase: 'failed', error: { message: 'x' } }, { phase: 'status', res, event: 'delivered' }]) assert.match(P.mailResultHtml(s), /data-close[^>]*>סגירה</);
});

test('flow: result window after every send; first delivery check before returning, then follow-up checks', () => {
  assert.match(card, /await sleep\(2500\);const first=await check\(\);/);
  assert.match(card, /for\(const ms of \[4000,8000,15000\]\)/);
  assert.match(card, /api\('admin_email_status',\{business_id:businessId,log_id:res\.log_id\}\)/);
  assert.match(card, /catch\(error\)\{set\(\{phase:'failed',error\}\)/);
});

test('sent list: newest first, latest delivery status per email, masked view, older rows show what exists', () => {
  const rows = P.sentRows([
    { id: 'A', action: 'portal_access_email', occurred_at: '2026-10-08T12:43:40Z', details: { status: 'sent', to: 'a@x.com', from: 'baruch@bsd-bbi.co.il', username: '15069', resend_id: 'r1' } },
    { id: 'B', action: 'portal_access_email', occurred_at: '2026-10-08T14:00:00Z', details: { status: 'sent', to: 'b@x.com', from: 'baruch@bsd-bbi.co.il', bcc: 'baruch@bsd-bbi.co.il', username: '23456', resend_id: 'r2', subject: 'נושא <x>', body_html: '<p>שלום</p><b>•••••••• (מוסתרת)</b>', body_text: 'סיסמה: •••••••• (מוסתרת)' } },
    { id: 'C', action: 'portal_access_email', occurred_at: '2026-10-08T14:05:00Z', details: { status: 'failed', to: 'c@x.com', reason: 'network_error' } },
    { id: 's1', action: 'portal_access_email_status', occurred_at: '2026-10-08T14:00:05Z', details: { log_id: 'B', last_event: 'sent', checked_at: '2026-10-08T14:00:05Z' } },
    { id: 's2', action: 'portal_access_email_status', occurred_at: '2026-10-08T14:00:20Z', details: { log_id: 'B', last_event: 'delivered', checked_at: '2026-10-08T14:00:20Z' } },
    { id: 's3', action: 'portal_access_email_status', occurred_at: '2026-10-08T13:00:00Z', details: { log_id: 'A', last_event: 'bounced', checked_at: '2026-10-08T13:00:00Z' } },
  ]);
  assert.deepEqual(rows.map(r => r.id), ['C', 'B', 'A']);
  assert.equal(rows[1].delivery, 'delivered');
  assert.match(P.sendStatusText(rows[1]), /^✅ נשלח · ✅ נמסר לתיבת הנמען/);
  assert.match(P.sendStatusText(rows[2]), /^❌ לא נמסר/);
  assert.match(P.sendStatusText(rows[0]), /^❌ לא נשלח · אין חיבור לשירות המיילים/);
  const h = P.sentListHtml(rows);
  assert.ok(h.includes('מיילים שנשלחו (3)') && h.includes('נושא &lt;x&gt;') && h.includes('(לא נשמר)') && h.includes('baruch@bsd-bbi.co.il'));
  assert.equal((h.match(/data-mail-refresh=/g) || []).length, 2, 'refresh only where a Resend id exists');
  assert.equal((h.match(/data-mail-view=/g) || []).length, 3);
  assert.equal(P.sentListHtml([]), '', 'nothing shown when no email was sent');
  const v = P.mailViewHtml(rows[1]);
  assert.ok(v.includes('srcdoc="&lt;p&gt;שלום&lt;/p&gt;') && v.includes('sandbox=""') && v.includes('הסיסמה מוסתרת'));
  const old = P.mailViewHtml(rows[2]);
  assert.ok(old.includes('נשלח לפני העדכון') && old.includes('15069'), 'older email: what exists');
});

test('delivery labels in plain Hebrew', () => {
  assert.equal(P.deliveryText('delivered'), '✅ נמסר לתיבת הנמען');
  assert.match(P.deliveryText('bounced'), /^❌ נדחה/);
  assert.equal(P.deliveryText('weird_new'), 'מצב: weird_new');
});

test('the password never reaches the browser list: only masked copies are read', () => {
  assert.ok(!/password_hash|plaintext/.test(card.slice(card.indexOf('function sentRows'), card.indexOf('function credentialsHtml'))));
});
