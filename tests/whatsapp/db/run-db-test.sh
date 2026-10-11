#!/usr/bin/env bash
# Local-only DB test for the WhatsApp migration: throwaway Postgres (PG >= 15), stub schema mirroring production,
# apply -> assertions -> rollback -> re-apply (idempotency). Never connects to Supabase.
# Usage: PGHOST=/tmp/wasock PGPORT=55491 PGUSER=postgres tests/whatsapp/db/run-db-test.sh
set -eo pipefail
cd "$(dirname "$0")/../../.."
DB=wa_mig_test_$$
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
run -f tests/whatsapp/db/stub_schema.sql >/dev/null
run -f supabase/migrations/20261011120000_whatsapp_cloud_api.sql >/dev/null
echo "migration applied"
PGOPTIONS='-c client_min_messages=notice' run -f tests/whatsapp/db/assertions.sql 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  //' -e '/^ *$/d' -e '/^ wa_|^---|^(1 row)|^ok *$|^ *t *$/d'; [ "${PIPESTATUS[0]}" = 0 ] || exit 1
run -f docs/whatsapp/rollback_20261011120000.sql >/dev/null
left=$(run -Atc "select count(*) from pg_proc where proname like 'wa\_%' or proname like 'bsd_wa%' or proname like 'bsd_whatsapp%'")
cols=$(run -Atc "select count(*) from information_schema.columns where table_schema='public' and (column_name like 'whatsapp\_%' or (table_name='whatsapp_messages' and column_name in ('conversation_id','storage_path')))")
tabs=$(run -Atc "select count(*) from pg_tables where tablename in ('whatsapp_conversations','whatsapp_short_links','whatsapp_opt_outs')")
[ "$left$cols$tabs" = "000" ] || { echo "FAIL: rollback left functions=$left columns=$cols tables=$tabs"; exit 1; }
echo "ok - rollback removes every object"
run -f supabase/migrations/20261011120000_whatsapp_cloud_api.sql >/dev/null
run -f supabase/migrations/20261011120000_whatsapp_cloud_api.sql >/dev/null
echo "ok - migration re-applies cleanly after rollback and twice in a row"
