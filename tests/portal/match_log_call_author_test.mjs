// bsd_match_log_call stores performed_by = auth.uid(). Phone and email are not written.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const uid = '11111111-1111-4111-8111-111111111111';
const match = '22222222-2222-4222-8222-222222222222';
const biz = '33333333-3333-4333-8333-333333333333';
const buyer = '44444444-4444-4444-8444-444444444444';

await db.exec(`
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.profiles (id uuid primary key, full_name text, phone text, email text);
create table public.matches (
  id uuid primary key,
  buyer_id uuid,
  business_id uuid,
  counterparty_type text
);
create table public.match_activity_log (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id),
  occurred_at timestamptz not null default now(),
  action_type text,
  description text,
  buyer_response text,
  follow_up_date date,
  visible_to_client boolean not null default false,
  performed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create function public.bsd_lead_log_call(p_lead text, p_at timestamptz, p_follow date, p_extra text)
returns jsonb language sql as $$ select '{"ok":true}'::jsonb $$;
`);
await db.exec(await readFile(new URL('../../supabase/migrations/20261020120000_add_bsd_match_log_call.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20261106120000_bsd_match_log_call_performed_by.sql', import.meta.url), 'utf8'));

const created = (await db.query(`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'match_activity_log' and column_name = 'created_by'
`)).rows;
assert.equal(created.length, 1, 'created_by column exists');

await db.exec(`
insert into public.profiles(id, full_name, phone, email) values ('${uid}', 'חנן פילוסוף', '050-1234567', 'staff@secret.test');
insert into public.matches(id, buyer_id, business_id, counterparty_type) values ('${match}', '${buyer}', '${biz}', 'buyer');
select set_config('request.jwt.claim.sub', '${uid}', false);
`);
await db.exec(`set role service_role`);
const logged = (await db.query(`
  select public.bsd_match_log_call('${match}', '2026-11-06T10:00:00Z', 'שיחה על המחיר והתנאים', 'תקציר', 'מעוניין', '2026-11-20', true) as result
`)).rows[0].result;
assert.equal(logged.ok, true);
await db.exec(`reset role`);
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
await db.exec(`set role service_role`);
await db.query(`
  select public.bsd_match_log_call('${match}', '2026-11-06T11:00:00Z', 'שיחה בלי משתמש מחובר', '', '', null, false)
`);
await db.exec(`reset role`);

const rows = (await db.query(`
  select description, buyer_response, performed_by::text, visible_to_client
  from public.match_activity_log order by occurred_at
`)).rows;
assert.equal(rows.length, 2);
assert.equal(rows[0].performed_by, uid);
assert.ok(rows[0].description.includes('שיחה על המחיר והתנאים'));
assert.ok(rows[0].description.includes('מה מסרנו: תקציר'));
assert.equal(rows[0].buyer_response, 'מעוניין');
assert.equal(rows[1].performed_by, null, 'service role without a user JWT stores a null author');
const stored = JSON.stringify(rows);
assert.ok(!stored.includes('050-1234567') && !stored.includes('staff@secret.test'), 'call log does not copy phone or email');

let anonBlocked = false;
try {
  await db.exec(`set role anon`);
  await db.query(`select public.bsd_match_log_call('${match}', now(), 'נושא', '', '', null, true)`);
} catch {
  anonBlocked = true;
} finally {
  await db.exec(`reset role`);
}
assert.equal(anonBlocked, true, 'anon cannot execute bsd_match_log_call');
console.log('PASS bsd_match_log_call sets performed_by = auth.uid()');
