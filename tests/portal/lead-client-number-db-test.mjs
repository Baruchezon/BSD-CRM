// Lead -> buyer conversion keeps the client-number rule (04.10.2026).
// Runs the production leads numbering pieces (sequence, insert trigger, protect
// trigger, CHECK client_number_required_if_active - copied from the live schema)
// in PGlite, then applies the new migration and its rollback.
let PGlite;
try { ({PGlite} = await import('@electric-sql/pglite')); }
catch { console.log('SKIP lead-client-number-db-test: run `npm ci` in tests/portal to install PGlite'); process.exit(0); }
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const migration = await readFile(new URL('../../supabase/migrations/20261004115126_lead_type_change_assigns_client_number.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../../db/rollback_20261004115126_lead_type_change_assigns_client_number.sql', import.meta.url), 'utf8');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated;
create type lead_type as enum ('seller','buyer','partner');
create sequence public.client_number_seq start with 1166;
create table public.leads(
  id uuid primary key default gen_random_uuid(), type lead_type not null, full_name text, phone text,
  status text, website_intake_stage text, created_at timestamptz not null default now(),
  client_number_running integer, client_number text, is_archived boolean not null default false,
  constraint client_number_required_if_active CHECK (((type <> ALL (ARRAY['buyer'::lead_type, 'partner'::lead_type])) OR is_archived OR (client_number IS NOT NULL))),
  constraint client_number_unique unique (client_number), constraint client_number_running_unique unique (client_number_running));
CREATE OR REPLACE FUNCTION public.trg_assign_client_number() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $f$
DECLARE il_ts timestamptz; yy text; mm text;
BEGIN
  IF NEW.type NOT IN ('buyer','partner') THEN RETURN NEW; END IF;
  NEW.client_number := NULL; NEW.client_number_running := NULL;
  il_ts := COALESCE(NEW.created_at, now());
  yy := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'YY'); mm := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'MM');
  NEW.client_number_running := nextval('public.client_number_seq');
  NEW.client_number := 'BSD-C-' || yy || mm || '-' || NEW.client_number_running;
  RETURN NEW;
END; $f$;
CREATE OR REPLACE FUNCTION public.trg_protect_client_number() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $f$
BEGIN
  IF OLD.client_number IS NOT NULL AND NEW.client_number IS DISTINCT FROM OLD.client_number THEN NEW.client_number := OLD.client_number; END IF;
  IF OLD.client_number_running IS NOT NULL AND NEW.client_number_running IS DISTINCT FROM OLD.client_number_running THEN NEW.client_number_running := OLD.client_number_running; END IF;
  RETURN NEW;
END; $f$;
CREATE TRIGGER trg_leads_client_number BEFORE INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION trg_assign_client_number();
CREATE TRIGGER trg_leads_protect_client_number BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION trg_protect_client_number();
insert into leads(id,type,full_name,phone,website_intake_stage,created_at) values
 ('00000000-0000-0000-0000-000000000001','seller','Site seller lead','0500000001','contacted','2026-09-22T09:00:00Z'),
 ('00000000-0000-0000-0000-000000000002','buyer','Manual lead','0500000002','new','2026-10-04T08:29:00Z'),
 ('00000000-0000-0000-0000-000000000003','seller','Archived seller','0500000003',null,'2026-08-01T09:00:00Z'),
 ('00000000-0000-0000-0000-000000000004','seller','Partner to be','0500000004','new','2026-10-04T09:00:00Z');
update leads set is_archived=true where id='00000000-0000-0000-0000-000000000003';`);
const row = async id => (await db.query(`select type::text, client_number, client_number_running, website_intake_stage, is_archived from leads where id='${id}'`)).rows[0];
const toBuyer = id => db.exec(`update leads set type='buyer', status='הועבר לקונה', website_intake_stage=null where id='${id}'`);

// Before the fix: exactly the production failure.
await assert.rejects(toBuyer('00000000-0000-0000-0000-000000000001'), /client_number_required_if_active/);
assert.equal((await row('00000000-0000-0000-0000-000000000001')).website_intake_stage, 'contacted');
const manualBefore = await row('00000000-0000-0000-0000-000000000002');
assert.match(manualBefore.client_number, /^BSD-C-2610-1166$/); // manual leads are stored as buyers -> numbered on insert

await db.exec(migration);

// Seller-type lead -> buyer: succeeds, numbered from the same sequence with its creation month.
await toBuyer('00000000-0000-0000-0000-000000000001');
const converted = await row('00000000-0000-0000-0000-000000000001');
assert.equal(converted.type, 'buyer'); assert.equal(converted.website_intake_stage, null);
assert.equal(converted.client_number, 'BSD-C-2609-' + converted.client_number_running);
assert.ok(converted.client_number_running > 1166);
// Already-numbered buyer: number never changes, no sequence consumed.
const seqBefore = (await db.query(`select last_value from client_number_seq`)).rows[0].last_value;
await toBuyer('00000000-0000-0000-0000-000000000002');
assert.deepEqual(await row('00000000-0000-0000-0000-000000000002'), {...manualBefore, website_intake_stage:null});
// Round trip buyer -> seller -> buyer keeps the first number.
await db.exec(`update leads set type='seller' where id='00000000-0000-0000-0000-000000000001'`);
await toBuyer('00000000-0000-0000-0000-000000000001');
assert.equal((await row('00000000-0000-0000-0000-000000000001')).client_number, converted.client_number);
assert.equal((await db.query(`select last_value from client_number_seq`)).rows[0].last_value, seqBefore);
// Archived rows are not numbered (CHECK allows them); partner path works too.
await db.exec(`update leads set type='buyer' where id='00000000-0000-0000-0000-000000000003'`);
assert.equal((await row('00000000-0000-0000-0000-000000000003')).client_number, null);
await db.exec(`update leads set type='partner', website_intake_stage=null where id='00000000-0000-0000-0000-000000000004'`);
assert.match((await row('00000000-0000-0000-0000-000000000004')).client_number, /^BSD-C-2610-\d+$/);
// Updates that do not touch type are unaffected.
await db.exec(`update leads set status='x' where id='00000000-0000-0000-0000-000000000004'`);
// Insert path unchanged.
await db.exec(`insert into leads(type,full_name) values('buyer','new buyer')`);
assert.match((await db.query(`select client_number from leads where full_name='new buyer'`)).rows[0].client_number, /^BSD-C-\d{4}-\d+$/);
// Client cannot pick its own number when converting.
await db.exec(`insert into leads(id,type,full_name) values('00000000-0000-0000-0000-000000000005','seller','spoof')`);
await db.exec(`update leads set type='buyer', client_number='BSD-C-0000-1', client_number_running=1 where id='00000000-0000-0000-0000-000000000005'`);
assert.notEqual((await row('00000000-0000-0000-0000-000000000005')).client_number, 'BSD-C-0000-1');
// Trigger function is not callable by API roles.
assert.equal((await db.query(`select has_function_privilege('authenticated','public.trg_assign_client_number_on_type_change()','EXECUTE') x`)).rows[0].x, false);

// Rollback restores the previous behaviour and keeps numbers already given.
await db.exec(rollback);
await db.exec(`insert into leads(id,type,full_name) values('00000000-0000-0000-0000-000000000006','seller','after rollback')`);
await assert.rejects(toBuyer('00000000-0000-0000-0000-000000000006'), /client_number_required_if_active/);
assert.equal((await row('00000000-0000-0000-0000-000000000001')).client_number, converted.client_number);
assert.equal((await db.query(`select count(*)::int n from pg_trigger where tgname='trg_leads_client_number_on_type_change'`)).rows[0].n, 0);
// Re-applying the migration is idempotent.
await db.exec(migration); await db.exec(migration);
await toBuyer('00000000-0000-0000-0000-000000000006');
console.log('PASS lead type change assigns client number: seller->buyer/partner fixed, numbers protected, archived skipped, insert unchanged, rollback restores');
