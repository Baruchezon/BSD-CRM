import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const app = read('app.html');
const js = read('js/globalSearch.js');
const sql = read('supabase/migrations/20261115160000_crm_global_search.sql');
const rb = read('supabase/migrations/rollback_20261115160000_crm_global_search.sql');

test('dashboard: one search box right under the greeting block', () => {
  const welcomeEnd = app.indexOf('id="surveyBtn"');
  const box = app.indexOf('<div id="globalSearch"></div>');
  const kpis = app.indexOf('תמונת מצב כללית');
  assert.ok(welcomeEnd > 0 && box > welcomeEnd && box < kpis);
  assert.match(app, /<script src="js\/globalSearch\.js\?v=\d{12}"><\/script>/);
  const version = JSON.parse(read('version.json')).version;
  assert.match(app, new RegExp("var PAGE_BUILD = '" + version + "';"));
});

test('search ui: min 2 chars, debounced, rpc only, safe links, archive badge', () => {
  assert.match(js, /const MIN = 2;/);
  assert.match(js, /DEBOUNCE_MS = \d{3}/);
  assert.match(js, /rpc\('crm_global_search', \{ p_q: q \}\)/);
  assert.ok(!/from\('/.test(js), 'no direct table reads');
  assert.match(js, /בארכיון/);
  assert.match(js, /\^\[a-z-\]\+\\\.html\\\?open=\[0-9a-f-\]\{36\}\$/);
  for (const b of ['קונה', 'בעל עסק', 'משקיע', 'עסק', 'מתווך', 'נרשם לעדכונים']) assert.ok(js.includes(`'${b}'`), b);
});

test('rpc: invoker for CRM tables (own RLS), definer only for subscribers behind admin/manager', () => {
  const main = sql.slice(sql.indexOf('create or replace function public.crm_global_search('));
  assert.match(main, /security invoker/);
  assert.match(main, /raise exception 'forbidden' using errcode = '42501'/);
  for (const t of ['public.leads', 'public.businesses', 'public.brokers', 'public.training_leads', 'crm_global_search_subscribers']) assert.ok(main.includes(t), t);
  const sub = sql.slice(sql.indexOf('create or replace function public.crm_global_search_subscribers'), sql.indexOf('create or replace function public.crm_global_search('));
  assert.match(sub, /security definer/);
  assert.match(sub, /role in \('admin', 'manager'\)/);
  assert.match(sql, /revoke all on function public\.crm_global_search\(text, integer\) from public, anon;/);
  assert.match(sql, /business_number ilike pat/);
  assert.match(sql, /char_length\(d\) < 5/);
  assert.ok(!/\b(insert|update|delete)\b/i.test(sql.replace(/--.*$/gm, '')), 'read-only');
  assert.match(rb, /drop function if exists public\.crm_global_search\(text, integer\);/);
});
