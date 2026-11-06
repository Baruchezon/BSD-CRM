// Seller portal: each match note shows who wrote it, and a buyer-name / very short
// update is replaced with a fuller sentence. Buyer and staff phone/email are not rendered.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const js = read('portal/portal.js');
const handler = read('supabase/functions/seller-portal-api/handler.ts');
const migration = read('supabase/migrations/20261106120000_bsd_match_log_call_performed_by.sql');
const FALLBACK = 'התנהלה שיחה עם הלקוח, קיבל פרטים ראשונים. ממתינים לתגובות, ניצור איתו קשר בעוד כמה ימים.';

function renderers() {
  const start = js.indexOf("const BSD_TEAM=");
  const end = js.indexOf('function summaryHtml');
  assert.ok(start > 0 && end > start);
  const ctx = {
    esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    date: () => '19.10.2026',
  };
  vm.createContext(ctx);
  vm.runInContext(js.slice(start, end) + ';this.notesHtml=notesHtml;this.ourActivityHtml=ourActivityHtml;this.contactHtml=contactHtml;this.FALLBACK=NOTE_FALLBACK;', ctx);
  return ctx;
}

test('notes, activity and contacts show the author in parentheses', () => {
  const { notesHtml, ourActivityHtml, contactHtml } = renderers();
  const note = notesHtml([{ text: 'הערה לבעל העסק על השיחה שהתקיימה', author: 'חנן פילוסוף' }]);
  assert.ok(note.includes('הערה לבעל העסק על השיחה שהתקיימה (חנן פילוסוף)'));
  const missing = notesHtml([{ text: 'הערה לבעל העסק בלי שם כותב' }]);
  assert.ok(missing.includes('(צוות BSD)'));
  const activity = ourActivityHtml([{ buyer: 'דנה כהן', action: 'הצגנו לקונה את התקציר המלא', response: 'הקונה ביקש לחשוב', author: 'חנן פילוסוף', date: '2026-10-19' }]);
  assert.ok(activity.includes('הצגנו לקונה את התקציר המלא (חנן פילוסוף)'));
  assert.ok(activity.includes('הקונה ביקש לחשוב (חנן פילוסוף)'));
  const call = contactHtml({ date: '2026-10-19', type: 'שיחה', topic: 'שיחה על מצב העסק והמספרים', shared: 'תקציר אנונימי', response: 'מעוניין', author: 'חנן פילוסוף' }, 'דנה כהן');
  assert.ok(call.includes('שיחה על מצב העסק והמספרים (חנן פילוסוף)'));
  assert.ok(call.includes('תקציר אנונימי (חנן פילוסוף)'));
  assert.ok(call.includes('מעוניין (חנן פילוסוף)'));
});

test('a buyer name or a very short note becomes the fuller sentence, without a phone or email', () => {
  const { notesHtml, ourActivityHtml, contactHtml, FALLBACK: fb } = renderers();
  assert.equal(fb, FALLBACK);
  const short = notesHtml([{ text: 'דנה', author: 'חנן פילוסוף' }]);
  assert.ok(short.includes(`${FALLBACK} (חנן פילוסוף)`));
  assert.ok(!short.includes('דנה'));
  const phone = notesHtml([{ text: '052-1234567', author: 'חנן פילוסוף' }]);
  assert.ok(phone.includes(FALLBACK) && !phone.includes('052-1234567'));
  const email = notesHtml([{ text: 'buyer@secret.test', author: 'חנן <b>x</b>' }]);
  assert.ok(email.includes(FALLBACK) && !email.includes('buyer@secret.test') && !email.includes('<b>'));
  assert.ok(email.includes('חנן &lt;b&gt;x&lt;/b&gt;'));
  const named = ourActivityHtml([{ buyer: 'אלכסנדרה כהן-לוי', action: 'אלכסנדרה כהן-לוי', author: 'חנן פילוסוף', date: '2026-10-19' }]);
  assert.ok(named.includes(`מה עשינו:</b> ${FALLBACK} (חנן פילוסוף)`));
  assert.ok(named.includes('oa-buyer">אלכסנדרה כהן-לוי<'), 'the buyer label stays; only the note text is replaced');
  const topic = contactHtml({ date: '2026-10-19', type: 'שיחה', topic: '052-9999999', shared: '', response: '', author: 'צוות BSD' }, 'דנה כהן');
  assert.ok(topic.includes(FALLBACK) && !topic.includes('052-9999999'));
});

test('the match query joins profiles.full_name only, and the call RPC stores auth.uid()', () => {
  assert.ok(handler.includes('performed_by,created_by,performer:profiles!performed_by(full_name),creator:profiles!created_by(full_name)'));
  assert.ok(handler.includes(".from('profiles').select('id,full_name')"));
  const noteSelect = handler.slice(handler.indexOf('const noteSelect'), handler.indexOf('const [buyers'));
  assert.ok(!noteSelect.includes('phone') && !noteSelect.includes('email'));
  assert.ok(migration.includes('performed_by') && migration.includes('auth.uid()'));
  assert.ok(!/phone|email/i.test(migration));
});
