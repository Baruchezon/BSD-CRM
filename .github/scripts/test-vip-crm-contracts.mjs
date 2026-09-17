import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function inlineScripts(file) {
  const html = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
}

test('VIP admin and leads hub inline scripts parse', async () => {
  for (const file of ['vip-admin.html', 'leads-hub.html', 'vip-test.html']) {
    for (const source of await inlineScripts(file)) assert.doesNotThrow(() => new Function(source), file);
  }
});

test('VIP publications use anonymous files and include business images', async () => {
  const api = await readFile(new URL('../../supabase/functions/vip-api/index.ts', import.meta.url), 'utf8');
  const saleFiles = await readFile(new URL('../../js/saleFileModule2.js', import.meta.url), 'utf8');
  const portal = await readFile(new URL('../../vip-test.html', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../../migrations/2026-09-17_vip_anonymous_files.sql', import.meta.url), 'utf8');
  assert.match(api, /document_type.*anonymous_summary/s);
  assert.match(api, /business_file_meta/);
  assert.match(api, /imagesByBusiness/);
  assert.match(saleFiles, /documentType === 'anonymous_summary' \? 1 : 2/);
  assert.match(portal, /bizimages/);
  assert.match(migration, /document_type = 'anonymous_summary'/);
  assert.match(migration, /confidentiality_level = 1/);
});

test('business list shows the current VIP publication status', async () => {
  const businesses = await readFile(new URL('../../businesses.html', import.meta.url), 'utf8');
  const integration = await readFile(new URL('../../js/vip-crm-integration.js', import.meta.url), 'utf8');
  const api = await readFile(new URL('../../supabase/functions/vip-api/index.ts', import.meta.url), 'utf8');
  assert.match(businesses, /מופץ ללקוחות VIP/);
  assert.match(businesses, /לא מופץ ללקוחות VIP/);
  assert.match(businesses, /vipPublicationBadge\(b\)/);
  assert.match(integration, /bsd:vip-publication-changed/);
  assert.match(api, /admin_business_publications/);
});

test('business and buyer identity columns use fixed aligned slots', async () => {
  const businesses = await readFile(new URL('../../businesses.html', import.meta.url), 'utf8');
  const leads = await readFile(new URL('../../leads.html', import.meta.url), 'utf8');
  for (const page of [businesses, leads]) {
    assert.match(page, /class="record-identity"/);
    assert.match(page, /class="record-title-line"/);
    assert.match(page, /class="record-number-slot"/);
    assert.match(page, /record-status-grid/);
  }
  assert.match(businesses, /businessIdentityCell/);
  assert.match(leads, /leadIdentityCell/);
});

test('VIP admin return link preserves the originating record', async () => {
  const integration = await readFile(new URL('../../js/vip-crm-integration.js', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../../vip-admin.html', import.meta.url), 'utf8');
  assert.match(integration, /businesses\.html\?open=/);
  assert.match(integration, /leads\.html\?open=/);
  assert.match(admin, /vipBackLink/);
  assert.doesNotMatch(admin, /href="leads\.html">חזרה לקונים/);
});

test('VIP leads remain linked to existing buyer and business cards', async () => {
  const hub = await readFile(new URL('../../leads-hub.html', import.meta.url), 'utf8');
  const api = await readFile(new URL('../../supabase/functions/vip-api/index.ts', import.meta.url), 'utf8');
  assert.match(hub, /לידים לקוחות VIP/);
  assert.match(hub, /leads\.html\?open=/);
  assert.match(hub, /businesses\.html\?open=/);
  assert.match(hub, /admin_inquiry_action/);
  assert.match(api, /handleAdminInquiries/);
  assert.match(api, /internal_name,business_number/);
});

test('VIP favorites are personal bookmarks and do not create workflow records', async () => {
  const api = await readFile(new URL('../../supabase/functions/vip-api/index.ts', import.meta.url), 'utf8');
  const portal = await readFile(new URL('../../vip-test.html', import.meta.url), 'utf8');
  const start = api.indexOf('async function handleInterest');
  const end = api.indexOf('async function handleInquiry', start);
  const handler = api.slice(start, end);
  assert.match(handler, /vip_interests/);
  assert.doesNotMatch(handler, /from\("matches"\)|from\("tasks"\)/);
  assert.match(portal, /המועדפים שלי/);
  assert.match(portal, /שמור במועדפים/);
  assert.match(portal, /נשמר במועדפים/);
});
