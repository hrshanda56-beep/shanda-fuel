#!/usr/bin/env bash
# Rebuilds the TEI Oils demo from nothing: a fresh local database, every migration, then the TEI Oils
# seed (scripts/dev-demo-seed/tei-oils.seed.ts). Run it as often as you like; each run ends in the
# same place, with thirty days that finish yesterday.
#
# It only ever touches a database on this computer, and by default a separate one (shanda_fuel_tei),
# so the everyday development data is not lost. It refuses anything else.
#
#   bash scripts/demo/reset-demo.sh                 # rebuild shanda_fuel_tei on 127.0.0.1:54331
#   DEMO_DB_PORT=5432 bash scripts/demo/reset-demo.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST=127.0.0.1
PORT="${DEMO_DB_PORT:-54331}"
DB="${DEMO_DB_NAME:-shanda_fuel_tei}"
BASE="postgresql://postgres@${HOST}:${PORT}"

case "$DB" in
  shanda_fuel_tei*|*_demo) ;;
  *)
    echo "Refusing to rebuild '$DB'. Choose a database whose name ends in _demo or starts with shanda_fuel_tei." >&2
    exit 1
    ;;
esac

if ! psql "$BASE/postgres" -Atqc 'select 1' >/dev/null 2>&1; then
  echo "No local database is answering on ${HOST}:${PORT}. Start it, then run this again." >&2
  exit 1
fi

echo "Rebuilding ${DB} on ${HOST}:${PORT} ..."
psql "$BASE/postgres" -q -c "drop database if exists ${DB} with (force)" -c "create database ${DB}"

export DATABASE_DIRECT_URL="$BASE/$DB" DATABASE_URL="$BASE/$DB" APP_ENV=test
bash scripts/db/bootstrap-test.sh >/dev/null
pnpm db:migrate:test >/dev/null
psql "$BASE/$DB" -q -c "ALTER SCHEMA drizzle OWNER TO migration_owner" \
  -c "ALTER TABLE drizzle.__drizzle_migrations OWNER TO migration_owner"

echo "Loading TEI Oils (about 30 days for two stations, this takes a few minutes) ..."
export APP_ENV=local
export AUDIT_SIGNING_KEY_ID="${AUDIT_SIGNING_KEY_ID:-local-demo-audit}"
export AUDIT_SIGNING_KEY="${AUDIT_SIGNING_KEY:-local-demo-audit-signing-key-disposable-0123456789abcdef}"
pnpm exec vitest run --config vitest.dev-seed.config.ts tei-oils

cat <<EOF

TEI Oils is ready in ${DB}.

To look at it, start the app against this database:
  DATABASE_DIRECT_URL=$BASE/$DB DATABASE_URL=postgresql://app_runtime:local-dev-runtime@${HOST}:${PORT}/$DB APP_ENV=local DEV_AUTH_BYPASS=1 pnpm dev
(the app signs in as the limited app_runtime user, so row-level security applies exactly as in production)
and sign in as one of: Rudo Mapfumo (owner), Farai Ncube (finance), Chipo Dube or Tafara Sibanda (supervisors).
EOF
