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
  for (const file of ['vip-admin.html', 'leads-hub.html']) {
    for (const source of await inlineScripts(file)) assert.doesNotThrow(() => new Function(source), file);
  }
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
