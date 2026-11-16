import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
const mig = fs.readFileSync(new URL('../supabase/migrations/20261116110000_distribution_channel_toggles.sql', import.meta.url), 'utf8');
const rb = fs.readFileSync(new URL('../supabase/migrations/rollback_20261116110000_distribution_channel_toggles.sql', import.meta.url), 'utf8');

// Load the real helpers from the page without a DOM.
const escLine = html.slice(html.indexOf('function esc(s)'), html.indexOf('\n', html.indexOf('function esc(s)')));
const start = html.indexOf('const DISTRIBUTION_CHANNELS = [');
const end = html.indexOf('async function loadBizChannelChecks');
assert.ok(start > 0 && end > start);
const api = new Function(escLine + '\n' + html.slice(start, end) + '; return { DISTRIBUTION_CHANNELS, distributionChannelView, distributionChannelButton, distributionChannelError };')();
const ch = k => api.DISTRIBUTION_CHANNELS.find(c => c.key === k);

test('facebook / instagram / email are clickable buttons with a clear on/off state', () => {
  for (const k of ['facebook', 'instagram', 'email_alerts']) {
    const off = api.distributionChannelButton(ch(k), null);
    assert.match(off, /^<button type="button" class="dch-btn ch-[a-z_]+ off"/);
    assert.match(off, /aria-pressed="false"/);
    assert.ok(!off.includes('aria-disabled'));
    assert.ok(!/\sdisabled[\s>]/.test(off));
    assert.match(off, /כבוי - לחץ להדלקה/);
    const on = api.distributionChannelButton(ch(k), { enabled: true, enabled_by: 'ברוך', enabled_at: '2026-11-16T09:00:00Z', status: 'pending' });
    assert.match(on, /class="dch-btn ch-[a-z_]+ on"/);
    assert.match(on, /aria-pressed="true"/);
    assert.match(on, /פעיל ✓/);
    assert.match(on, /ברוך/);
  }
  assert.equal(ch('email_alerts').label, 'דיוור במייל');
});

test('VIP and WhatsApp are shown as paused, never switchable on; can still be switched off', () => {
  for (const k of ['vip', 'whatsapp']) {
    const off = api.distributionChannelButton(ch(k), {});
    assert.match(off, /paused/);
    assert.match(off, /aria-disabled="true"/);
    assert.match(off, /כבוי זמנית/);
    const on = api.distributionChannelView(ch(k), { enabled: true });
    assert.equal(on.locked, false);
  }
});

test('output is escaped and errors are readable Hebrew', () => {
  const b = api.distributionChannelButton(ch('facebook'), { enabled: true, enabled_by: '<img src=x onerror=alert(1)>' });
  assert.ok(!b.includes('<img'));
  assert.match(api.distributionChannelError({ message: 'marketing_inactive' }), /עדכון מסד הנתונים/);
  assert.match(api.distributionChannelError({ message: 'channel_paused' }), /כבוי זמנית/);
  assert.match(api.distributionChannelError({ message: 'forbidden' }), /הרשאה/);
});

test('client no longer blocks on marketing_service_active; legacy facebook request is hidden by default', () => {
  const loader = html.slice(end, html.indexOf('async function openVipSend('));
  assert.equal(loader.includes('marketing_service_active'), false);
  assert.match(loader, /rpc\('business_distribution_set'/);
  assert.match(loader, /p_actor: distributionActor\(\)/);
  assert.match(html, /<div id="bizFacebookLegacy" hidden>/);
});

test('migration drops only the marketing guard, keeps history, website rule and pauses vip/whatsapp', () => {
  assert.equal(mig.includes('marketing_inactive'), false);
  assert.equal(/marketing_service_active\s*(into|is|=)/.test(mig), false);
  assert.match(mig, /business_distribution_require_staff\(\)/);
  assert.match(mig, /website uses public_listing_active/);
  assert.match(mig, /v_channel in \('vip', 'whatsapp'\)[\s\S]*channel_paused/);
  assert.match(mig, /insert into public\.business_distribution_channel_history/);
  assert.match(mig, /else 'stopped'/);
  assert.equal(/\bdelete\b|drop table|drop trigger|update public\.businesses/i.test(mig), false);
  assert.match(rb, /raise exception 'marketing_inactive'/);
});
