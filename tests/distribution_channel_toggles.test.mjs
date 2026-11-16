import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
const mig = fs.readFileSync(new URL('../supabase/migrations/20261116113000_distribution_channel_marks.sql', import.meta.url), 'utf8');
const rb = fs.readFileSync(new URL('../supabase/migrations/rollback_20261116113000_distribution_channel_marks.sql', import.meta.url), 'utf8');

const escLine = html.slice(html.indexOf('function esc(s)'), html.indexOf('\n', html.indexOf('function esc(s)')));
const start = html.indexOf('const DISTRIBUTION_CHANNELS = [');
const end = html.indexOf('async function loadBizChannelChecks');
assert.ok(start > 0 && end > start);
const api = new Function(escLine + '\n' + html.slice(start, end) + '; return { DISTRIBUTION_CHANNELS, distributionChannelCheckbox, distributionChannelError };')();

test('five plain checkboxes, all clickable, Hebrew labels', () => {
  assert.deepEqual(api.DISTRIBUTION_CHANNELS.map(c => c.label), ['פייסבוק', 'אינסטגרם', 'דיוור במייל', 'לקוחות VIP', 'וואטסאפ']);
  for (const c of api.DISTRIBUTION_CHANNELS) {
    const off = api.distributionChannelCheckbox(c, null);
    assert.match(off, new RegExp(`<input type="checkbox" data-channel="${c.key}" >`));
    assert.equal(/disabled|aria-disabled|paused/.test(off), false);
    const on = api.distributionChannelCheckbox(c, { enabled: true, enabled_by: 'ברוך', enabled_at: '2026-11-16T09:00:00Z' });
    assert.match(on, /checked>/);
    assert.match(on, /class="dch-item ch-[a-z_]+ on"/);
    assert.match(on, /ברוך/);
  }
});

test('escaped output and readable errors', () => {
  const b = api.distributionChannelCheckbox(api.DISTRIBUTION_CHANNELS[0], { enabled: true, enabled_by: '<img src=x onerror=alert(1)>' });
  assert.ok(!b.includes('<img'));
  assert.match(api.distributionChannelError({ message: 'forbidden' }), /הרשאה/);
  assert.match(api.distributionChannelError({ message: 'channel_paused' }), /מסד הנתונים/);
});

test('old «פרסום ללקוחות VIP» box is no longer mounted; save goes through the RPC', () => {
  assert.equal(html.includes('<div id="bizVipDistribution"></div>'), false);
  const loader = html.slice(end, html.indexOf('async function openVipSend('));
  assert.match(loader, /rpc\('business_distribution_set'/);
  assert.match(loader, /p_actor: distributionActor\(\)/);
  assert.equal(loader.includes('marketing_service_active'), false);
  assert.match(html, /שום הודעה לא נשלחת ללקוחות/);
});

test('migration lets vip/whatsapp be marked, keeps staff check, website rule and history', () => {
  assert.equal(mig.includes("raise exception 'channel_paused'"), false);
  assert.equal(mig.includes('marketing_inactive'), false);
  assert.match(mig, /business_distribution_require_staff\(\)/);
  assert.match(mig, /website uses public_listing_active/);
  assert.match(mig, /insert into public\.business_distribution_channel_history/);
  assert.equal(/\bdelete\b|drop table|drop trigger|update public\.businesses|vip_send_enabled\s*=|sending_enabled\s*=/i.test(mig.replace(/^--.*$/gm, '')), false);
  assert.match(rb, /raise exception 'channel_paused'/);
});
