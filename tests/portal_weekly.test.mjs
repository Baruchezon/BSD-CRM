// «בשבוע האחרון» and «פרסומי מדיה». Real numbers only: a 0 business-page
// line is hidden, and impressions are omitted entirely unless they are > 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const js = read('portal/portal.js');
const html = read('portal/index.html');
const handler = read('supabase/functions/seller-portal-api/handler.ts');
const sql = read('supabase/migrations/20261022190000_seller_portal_weekly_stats.sql');
const entriesSql = read('supabase/migrations/20261023040000_seller_portal_site_entries.sql');

function renderers() {
  const start = js.indexOf('function recordedImpressions');
  const end = js.indexOf("// «איפה העסק מופץ»");
  assert.ok(start > 0 && end > start);
  const ctx = {
    esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    date: v => v ? new Date(v).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '',
  };
  vm.createContext(ctx);
  vm.runInContext(js.slice(start, end), ctx);
  return ctx;
}

const weekly = { site_visitors: 52, site_entries: 105, for_sale_views: 70, business_views: 0 };
const post = (extra = {}) => ({ platform: 'facebook', group_name: 'פורום עסקים באר שבע', posted_on: '2026-10-18', status: 'active', member_count: 17200, impressions: null, ...extra });

test('weekly card hides a zero business-page line and never mentions Facebook impressions', () => {
  const { weeklyHtml } = renderers();
  const hidden = weeklyHtml(weekly);
  assert.ok(hidden.includes('בשבוע האחרון'));
  assert.ok(hidden.includes('>105<') || hidden.includes('>105 ') || hidden.includes('105'));
  assert.ok(!hidden.includes('52'), 'unique visitors are not the figure on the card');
  assert.ok(hidden.includes('כניסות לאתר') && !hidden.includes('כניסות לאתר BSD'));
  assert.ok(hidden.includes('צפיות בעמוד «עסקים למכירה»'));
  assert.ok(!hidden.includes('צפיות בעמוד העסק שלך'));
  assert.ok(!hidden.includes('חשיפות') && !hidden.includes('פייסבוק'));
  const shown = weeklyHtml({ ...weekly, business_views: 2 });
  assert.ok(shown.includes('צפיות בעמוד העסק שלך באתר BSD'));
  assert.equal(weeklyHtml(null), '');
});

test('media section is separate, counts groups, and hides impressions unless > 0', () => {
  const { mediaHtml } = renderers();
  assert.equal(mediaHtml(null), '');
  assert.equal(mediaHtml({ scope: 'week', group_posts: 0, group_members: 0, impressions: null, posts: [] }), '');
  const none = mediaHtml({
    scope: 'week', group_posts: 2, group_members: 22800, impressions: null,
    posts: [post(), post({ group_name: 'עסקים למכירה <24/7>', member_count: 5600, impressions: 0 })],
  });
  assert.ok(none.includes('פרסומי מדיה'));
  assert.ok(none.includes('פורסם ב-2 קבוצות פייסבוק עם כ-'));
  assert.ok(none.includes('22,800') || none.includes('22800'));
  assert.ok(none.includes('פייסבוק') && none.includes('פורום עסקים באר שבע') && none.includes('פורסם'));
  assert.ok(none.includes('18.10.2026') || none.includes('18/10/2026'));
  assert.ok(none.includes('עסקים למכירה &lt;24/7&gt;') && !none.includes('<24/7>'));
  assert.ok(!none.includes('חשיפות'), 'missing impressions are not shown, and not as 0');
  assert.ok(!/>\s*0\s*</.test(none), 'no zero cell');
  assert.ok(!none.includes('הפרסום האחרון'));
  const some = mediaHtml({
    scope: 'week', group_posts: 2, group_members: 100, impressions: 40,
    posts: [post({ impressions: 40 }), post({ group_name: 'שנייה', impressions: null })],
  });
  assert.ok(some.includes('חשיפות') && some.includes('40'));
  assert.ok(some.includes('פורסם ב-2 קבוצות פייסבוק עם כ-'));
  const cells = [...some.matchAll(/data-label="חשיפות">([^<]*)</g)].map(m => m[1]);
  assert.deepEqual(cells, ['40', ''], 'a post without impressions contributes an empty cell, not 0');
  assert.ok(!some.includes('>0<'));
  const zeroTotal = mediaHtml({ scope: 'week', group_posts: 1, group_members: 10, impressions: 0, posts: [post({ impressions: 0 })] });
  assert.ok(!zeroTotal.includes('חשיפות') && !zeroTotal.includes('>0<'));
});

test('no posts in the last 7 days falls back to the latest batch, without dates', () => {
  const { mediaHtml } = renderers();
  const out = mediaHtml({
    scope: 'latest', group_posts: 1, group_members: 4605, impressions: null,
    posts: [post({ posted_on: '2026-09-01', member_count: 4605 })],
  });
  assert.ok(out.includes('הפרסום האחרון'));
  assert.ok(!out.includes('7 הימים האחרונים'));
  assert.ok(!out.includes('01.09.2026') && !out.includes('1.9.2026') && !out.includes('01/09/2026'));
  assert.ok(!out.includes('<th>תאריך</th>'));
});

test('home mounts the two sections apart, and the API does not invent impressions', () => {
  assert.ok(js.includes("const PORTAL_BUILD='202610230400'"));
  assert.ok(html.includes('id="weeklyStats"') && html.includes('id="mediaPosts"'));
  assert.ok(html.indexOf('id="weeklyStats"') < html.indexOf('id="mediaPosts"') && html.indexOf('id="mediaPosts"') < html.indexOf('id="kpis"'));
  assert.ok(js.includes("weeklyHtml(data.weekly)") && js.includes("mediaHtml(data.media)"));
  assert.ok(handler.includes('site_visitors,site_entries,for_sale_views,business_views,facebook_group_posts,facebook_group_members,facebook_impressions,facebook_scope,facebook_posts'));
  assert.ok(handler.includes('site_entries:w.data.site_entries'));
  assert.ok(entriesSql.includes('site_entries integer not null default 0'));
  assert.ok(entriesSql.includes('count(distinct session_id)'));
  assert.ok(entriesSql.includes('site_entries = excluded.site_entries'));
  assert.ok(entriesSql.includes('site_visitors = excluded.site_visitors'));
  assert.ok(handler.includes('weekly,media,'));
  assert.ok(!handler.includes('business_facebook_impressions'));
  assert.ok(!/create table[^;]*business_facebook_impressions/i.test(sql));
  assert.ok(sql.includes('business_facebook_posts'));
  assert.ok(sql.includes("in ('active', 'published')"));
  assert.ok(sql.includes("'latest'"));
  assert.ok(sql.includes('seller-portal-weekly-stats'));
  assert.ok(!/net\.http_post|send-ad-report|pg_net/.test(sql), 'the cron job only recomputes');
});
