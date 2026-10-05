#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
pg_bin="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
pg_host="${PGHOST:-127.0.0.1}"
pg_port="${PGPORT:-55433}"
pg_user="${PGUSER:-$(id -un)}"
test_db="${PGDATABASE:-shanda_fuel_access_fix_test}"

if [[ "$pg_host" != '127.0.0.1' || "$pg_port" != '55433' ]]; then
  printf '%s\n' 'Refusing a non-local or non-PostgreSQL-18 endpoint; this fixture is local-only.' >&2
  exit 1
fi

for binary in pg_isready psql; do
  if [[ ! -x "$pg_bin/$binary" ]]; then
    printf 'Missing PostgreSQL 18 binary: %s\n' "$pg_bin/$binary" >&2
    exit 1
  fi
done

if ! "$pg_bin/pg_isready" --host "$pg_host" --port "$pg_port" --username "$pg_user" >/dev/null; then
  printf 'Disposable PostgreSQL 18 is not ready at %s:%s.\n' "$pg_host" "$pg_port" >&2
  exit 1
fi

version="$($pg_bin/psql --no-password -X -At --host "$pg_host" --port "$pg_port" --username "$pg_user" --dbname "$test_db" -c 'select version()')"
case "$version" in
  'PostgreSQL 18.'*) ;;
  *) printf 'Expected PostgreSQL 18, got: %s\n' "$version" >&2; exit 1 ;;
esac

export APP_ENV=local
export FIRST_USER_PROVISIONING_PG18_TEST_DATABASE=true
export FIRST_USER_PROVISIONING_PG18_TEST_DATABASE_URL="postgresql://first_user_provisioner@${pg_host}:${pg_port}/${test_db}"
export FIRST_USER_PROVISIONING_PG18_TEST_ADMIN_DATABASE_URL="postgresql://${pg_user}@${pg_host}:${pg_port}/${test_db}"

cd "$repo_root"
exec pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/first-user-role-preflight-pg18.test.ts --reporter verbose
