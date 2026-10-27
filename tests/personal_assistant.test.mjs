// עוזר אישי: תכנון שאלה, תשובה רק מנתונים שחזרו, וקישורי כרטיס.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(read('js/bsd-search.js'), ctx);
vm.runInContext(read('js/personalAssistant.js'), ctx);
vm.runInContext(read('js/permissions.js'), ctx);
const A = ctx.BSDAssistant;

const BIZ = '11111111-1111-4111-8111-111111111111';
const LEAD = '22222222-2222-4222-8222-222222222222';
const BROKER = '33333333-3333-4333-8333-333333333333';
const MATCH = '44444444-4444-4444-8444-444444444444';
const OTHER = '77777777-7777-4777-8777-777777777777';
const ACTIVE = '88888888-8888-4888-8888-888888888888';

function splitOr(expr) {
  const out = [];
  let buf = '';
  let quoted = false;
  for (const ch of String(expr)) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) { if (buf) out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}
function matchClause(row, clause) {
  const ilike = clause.match(/^([a-z0-9_]+)\.ilike\.(?:"%([\s\S]+)%"|%([^%]+)%)$/i);
  if (ilike) {
    const term = (ilike[2] != null ? ilike[2] : ilike[3]).toLowerCase();
    return String(row[ilike[1]] == null ? '' : row[ilike[1]]).toLowerCase().includes(term);
  }
  const eq = clause.match(/^([a-z0-9_]+)\.eq\.(.+)$/);
  if (eq) return String(row[eq[1]] == null ? '' : row[eq[1]]) === eq[2];
  const isn = clause.match(/^([a-z0-9_]+)\.is\.null$/);
  if (isn) return row[isn[1]] == null;
  return false;
}
function applyFilters(rows, state) {
  return rows.filter(row => state.filters.every(f => {
    if (f.op === 'eq') return String(row[f.col] == null ? '' : row[f.col]) === String(f.val);
    if (f.op === 'in') return (f.vals || []).map(String).includes(String(row[f.col]));
    if (f.op === 'is') return f.val == null ? row[f.col] == null : row[f.col] === f.val;
    if (f.op === 'or') return splitOr(f.expr).some(clause => matchClause(row, clause));
    if (f.op === 'not' && f.sub === 'in') {
      const list = String(f.val).replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/"/g, '').trim());
      if (row[f.col] == null) return false;
      return !list.includes(String(row[f.col]));
    }
    return true;
  }));
}
function fakeDb(tables) {
  return {
    from(table) {
      const state = { filters: [], limit: 100, head: false };
      const api = {
        select(_c, opts) { if (opts && opts.head) state.head = true; return api; },
        eq(col, val) { state.filters.push({ op: 'eq', col, val }); return api; },
        or(expr) { state.filters.push({ op: 'or', expr }); return api; },
        in(col, vals) { state.filters.push({ op: 'in', col, vals }); return api; },
        is(col, val) { state.filters.push({ op: 'is', col, val }); return api; },
        not(col, sub, val) { state.filters.push({ op: 'not', col, sub, val }); return api; },
        order() { return api; },
        limit(n) { state.limit = n; return api; },
        then(resolve, reject) {
          try {
            const rows = applyFilters(tables[table] || [], state);
            resolve({ data: state.head ? null : rows.slice(0, state.limit), error: null, count: rows.length });
          } catch (e) { reject(e); }
        }
      };
      return api;
    }
  };
}

const tables = {
  businesses: [
    { id: BIZ, internal_name: 'ריקו', business_number: 'BSD-B-100', city: 'חיפה', field: 'מסחר', listing_status: 'removed', removal_reason: 'הבעלים עצרו', created_at: '2024-03-12T08:00:00.000Z', is_archived: true, archived_at: '2025-01-02T08:00:00.000Z', archive_reason: 'יצא מהמאגר', notes: 'סודי-לא-להציג-בחיפוש', updated_at: '2025-01-02T08:00:00.000Z' },
    { id: OTHER, internal_name: 'עסק אחר', business_number: 'BSD-B-200', city: 'עכו', listing_status: 'active', created_at: '2021-01-01T00:00:00.000Z', is_archived: true, archived_at: '2021-06-01T00:00:00.000Z', archive_reason: 'ישן', updated_at: '2021-06-01T00:00:00.000Z' },
    { id: ACTIVE, internal_name: 'פעיל בעמ', business_number: 'BSD-B-300', city: 'חיפה', listing_status: 'active', created_at: '2024-01-01T00:00:00.000Z', is_archived: false, updated_at: '2024-01-01T00:00:00.000Z' }
  ],
  leads: [
    { id: LEAD, type: 'buyer', full_name: 'דני כהן', first_name: 'דני', last_name: 'כהן', phone: '052-111-2233', city: 'תל אביב', client_number: 'BSD-C-9', status: 'פעיל', created_at: '2023-05-01T08:00:00.000Z', is_archived: false, meeting_summary: 'סיכום פגישה ייחודי 7781', notes: '', updated_at: '2023-06-01T00:00:00.000Z' }
  ],
  brokers: [
    { id: BROKER, full_name: 'יוסי מתווך', phone: '050-000-0000', city: 'ירושלים', status: 'פעיל', agreement_status: 'אין הסכם', created_at: '2022-02-02T00:00:00.000Z', is_archived: false, updated_at: '2022-02-02T00:00:00.000Z' }
  ],
  matches: [
    { id: MATCH, business_id: BIZ, buyer_id: LEAD, broker_id: null, counterparty_type: 'buyer', status: 'נחתמה סודיות', created_at: '2024-06-01T08:00:00.000Z', match_source: 'שיחה', stopped_reason: '' }
  ],
  match_status_history: [
    { match_id: MATCH, status: 'התאמה חדשה', changed_at: '2024-06-01T08:00:00.000Z' },
    { match_id: MATCH, status: 'נחתמה סודיות', changed_at: '2024-07-01T08:00:00.000Z' }
  ],
  record_notes: [
    { record_id: LEAD, table_name: 'leads', note_text: 'הערה גולמית <script>', created_at: '2024-08-01T08:00:00.000Z', author_id: null }
  ],
  match_meetings: [
    { id: '55555555-5555-4555-8555-555555555555', business_id: BIZ, buyer_id: LEAD, meeting_type: 'פגישה', meeting_date: '2024-09-01', summary_text: 'בפגישה נאמר משפט ייחודי 4412', deleted_at: null }
  ],
  phone_calls: [
    { id: '66666666-6666-4666-8666-666666666666', lead_id: LEAD, is_test: false, direction: 'inbound', started_at: '2024-04-04T08:00:00.000Z', ai_gist: 'הלקוח ביקש לחזור אליו' }
  ],
  profiles: []
};
const db = fakeDb(tables);

test('plans a business lookup, a timeline cut, a speech question and an archive slice', () => {
  const biz = A.planQuestion('מצא את העסק ריקו');
  assert.equal(biz.kind, 'lookup');
  assert.equal(biz.scope, 'business');
  assert.equal(biz.needle, 'ריקו');
  const cut = A.planQuestion('מתי העסק ריקו נכנס ומתי יצא');
  assert.equal(cut.kind, 'lookup');
  assert.equal(cut.needle, 'ריקו');
  assert.ok(cut.focus.includes('entered') && cut.focus.includes('left'));
  const speech = A.planQuestion('מה נאמר בפגישות עם דני כהן');
  assert.equal(speech.needle, 'דני כהן');
  assert.ok(speech.focus.includes('speech'));
  const slice = A.planQuestion('כמה עסקים בארכיון');
  assert.equal(slice.kind, 'slice');
  assert.equal(slice.needle, '');
  const follow = A.planQuestion('מתי הוא יצא', { cards: [{ kind: 'business', id: BIZ, title: 'ריקו' }] });
  assert.equal(follow.kind, 'followup');
  assert.equal(A.planQuestion('   ').kind, 'clarify');
});

test('finding a business returns its real dates, archive reason and card link — not a note that was not asked for', async () => {
  const res = await A.answerQuestion('מתי העסק ריקו נכנס ומתי יצא', { db });
  assert.equal(res.readOnly, true);
  assert.match(res.prose, /ריקו/);
  assert.match(res.prose, new RegExp(A.fmtDate('2024-03-12T08:00:00.000Z').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(res.prose, /יצא מהמאגר/);
  assert.match(res.prose, /עסקה לא פעילה|הבעלים עצרו/);
  assert.doesNotMatch(res.prose, /סודי-לא-להציג-בחיפוש/);
  const card = res.cards.find(c => c.kind === 'business');
  assert.equal(card.href, 'businesses.html?open=' + encodeURIComponent(BIZ));
  assert.equal(card.openLabel, 'פתח כרטיס');
  assert.equal(card.title, 'ריקו');
  assert.ok(card.lines.some(line => line.includes('יצא מהמאגר')));
  assert.ok(!card.lines.some(line => line.includes('סודי-לא-להציג-בחיפוש')));
});

test('a person, a broker and a match each get the screen the CRM already uses', async () => {
  const person = await A.answerQuestion('מצא את הקונה דני כהן', { db });
  const lead = person.cards.find(c => c.id === LEAD);
  assert.equal(lead.href, 'leads.html?open=' + encodeURIComponent(LEAD));
  assert.equal(lead.kindLabel, 'קונה');
  const broker = await A.answerQuestion('מצא מתווך יוסי מתווך', { db });
  assert.equal(broker.cards.find(c => c.kind === 'broker').href, 'brokers.html?open=' + encodeURIComponent(BROKER));
  const match = await A.answerQuestion('מתי הוצעה התאמה לריקו', { db });
  assert.match(match.prose, /נחתמה סודיות/);
  assert.match(match.prose, new RegExp(A.fmtDate('2024-06-01T08:00:00.000Z').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const matchCard = match.cards.find(c => c.kind === 'match');
  assert.equal(matchCard.href, 'match-detail.html?id=' + encodeURIComponent(MATCH));
  assert.ok(matchCard.lines.join(' ').includes('התאמה חדשה') || match.cards.some(c => (c.lines || []).join(' ').includes('התאמה חדשה')));
});

test('speech answers quote stored notes, meetings and call summaries and the renderer escapes them', async () => {
  const res = await A.answerQuestion('מה נאמר בפגישות עם דני כהן', { db });
  const blob = res.prose + ' ' + res.cards.map(c => (c.lines || []).join(' ')).join(' ');
  assert.match(blob, /7781/);
  assert.match(blob, /4412/);
  assert.match(blob, /הלקוח ביקש לחזור אליו/);
  assert.match(blob, /הערה גולמית <script>/);
  const html = A.renderAnswerHtml(res);
  assert.match(html, /הערה גולמית &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /leads\.html\?open=/);
});

test('unknown name and empty question do not invent a card', async () => {
  const missing = await A.answerQuestion('מצא את העסק שםשלאקיים', { db });
  assert.match(missing.prose, /לא מצאתי/);
  assert.equal(missing.cards.length, 0);
  const empty = await A.answerQuestion('מה קורה', { db });
  assert.equal(empty.cards.length, 0);
  assert.match(empty.prose, /אפשר לשאול/);
});

test('archive slice counts only archived businesses and links to cards', async () => {
  const res = await A.answerQuestion('כמה עסקים בארכיון', { db });
  assert.match(res.prose, /2/);
  assert.ok(res.cards.some(c => c.href === 'businesses.html' && c.openLabel === 'פתח מסך'));
  assert.ok(res.cards.some(c => c.href === 'businesses.html?open=' + encodeURIComponent(BIZ)));
  assert.ok(!res.cards.some(c => c.id === ACTIVE));
});

test('a follow-up uses the previous card and still reads the archive date from the row', async () => {
  const first = await A.answerQuestion('מצא את העסק ריקו', { db });
  const second = await A.answerQuestion('מתי הוא יצא', { db, context: { cards: first.cards } });
  assert.match(second.prose, /יצא מהמאגר/);
  assert.equal(second.cards[0].href, 'businesses.html?open=' + encodeURIComponent(BIZ));
});

test('assistant permission mirrors the AI-match flag and stays on for admin and manager', () => {
  assert.equal(ctx.canUsePersonalAssistant({ role: 'admin', status: 'active' }), true);
  assert.equal(ctx.canUsePersonalAssistant({ role: 'manager', status: 'active' }), true);
  assert.equal(ctx.canUsePersonalAssistant({ role: 'agent', status: 'active', can_use_ai_match: false }), false);
  assert.equal(ctx.canUsePersonalAssistant({ role: 'agent', status: 'active', can_use_ai_match: true }), true);
  assert.equal(ctx.canUsePersonalAssistant({ role: 'admin', status: 'blocked' }), false);
  assert.equal(ctx.canUsePersonalAssistant(null), false);
});

test('dashboard button sits beside AI matches, the old button still opens smart-matches, and the assistant only reads', () => {
  const app = read('app.html');
  const ai = app.indexOf('🧠 התאמות AI חכמות');
  const assistant = app.indexOf('>עוזר אישי<') >= 0 ? app.indexOf('>עוזר אישי<') : app.indexOf('עוזר אישי');
  assert.ok(ai > 0 && assistant > ai);
  assert.match(app, /function runAiMatchSuggestions\(\)\{\s*window\.location\.href = 'smart-matches\.html';/);
  assert.match(app, /function openPersonalAssistant\(\)\{\s*window\.location\.href = 'assistant\.html';/);
  assert.match(app, /canUsePersonalAssistant\(profile\)/);
  const page = read('assistant.html');
  const version = JSON.parse(read('version.json')).version;
  const assistantBuild = (page.match(/PAGE_BUILD = '(\d{12})'/) || [])[1];
  assert.ok(assistantBuild && assistantBuild >= '202610270450' && assistantBuild <= version, 'assistant build ' + assistantBuild);
  assert.match(page, /עוזר אישי/);
  assert.match(page, /bsd-search\.js/);
  assert.match(page, /personalAssistant\.js/);
  assert.match(page, /canUsePersonalAssistant/);
  assert.match(page, /renderAnswerHtml/);
  assert.match(read('js/personalAssistant.js'), /פתח כרטיס/);
  assert.match(page, /<textarea[^>]*id="paInput"/);
  assert.doesNotMatch(page, /id="paInput"[^>]*(disabled|readonly)/);
  assert.doesNotMatch(page, /pa-chips|paChips|placeholder=|מצא עסק לפי שם|מתי נכנס ומתי יצא|למשל:/);
  assert.doesNotMatch(page, /אפשר לשאול על שם/);
  const src = read('js/personalAssistant.js');
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/);
  assert.match(read('brokers.html'), /maybeOpenBrokerFromUrl/);
  assert.match(read('brokers.html'), /get\('open'\)/);
  assert.match(read('help.html'), /id="s-assistant"/);
});
