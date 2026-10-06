#!/usr/bin/env bash
set -euo pipefail

if [[ "${APP_ENV:-}" == 'demo' ]]; then
  : "${DATABASE_URL:?Set DATABASE_URL through the approved hidden environment}"
  : "${BETTER_AUTH_SECRET:?Set the demo Better Auth secret through the approved secret store}"
  : "${AUDIT_SIGNING_KEY_ID:?Set the demo audit key id through the approved secret store}"
  : "${AUDIT_SIGNING_KEY:?Set the demo audit signing key through the approved secret store}"
  DEMO_RESET=1 bash scripts/demo/setup-owner-demo.sh
  exit 0
fi

if [[ "${APP_ENV:-}" != 'local' && "${APP_ENV:-}" != 'test' ]]; then
  printf '%s\n' 'Refusing reset unless APP_ENV=local or APP_ENV=test.' >&2
  exit 2
fi

: "${DEMO_DB_NAME:?Set DEMO_DB_NAME to the disposable local database name}"
: "${PG_BIN:?Set PG_BIN to the local PostgreSQL bin directory}"
: "${PGHOST:?Set PGHOST to the local PostgreSQL host}"
: "${PGPORT:?Set PGPORT to the local PostgreSQL port}"
: "${PGUSER:?Set PGUSER to the local PostgreSQL user}"

case "$PGHOST" in
  localhost|127.0.0.1|::1) ;;
  *) printf '%s\n' 'Refusing reset for a non-loopback PostgreSQL host.' >&2; exit 2 ;;
esac
if [[ "$DEMO_DB_NAME" != shanda_fuel_first_user_test ]]; then
  printf '%s\n' 'Refusing reset outside the named disposable demo database.' >&2
  exit 2
fi

"$PG_BIN/psql" -d template1 -v ON_ERROR_STOP=1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DEMO_DB_NAME' and pid <> pg_backend_pid();" >/dev/null
PG_BIN="$PG_BIN" bash tests/integration/fixtures/first-user-provisioning-setup.sh
"$PG_BIN/psql" -d "$DEMO_DB_NAME" -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres LOGIN SUPERUSER; END IF; END \$\$;"
