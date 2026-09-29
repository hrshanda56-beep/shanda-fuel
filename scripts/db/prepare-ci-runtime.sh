#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_DIRECT_URL:?DATABASE_DIRECT_URL is required for CI runtime-role setup}"
: "${GITHUB_ENV:?GITHUB_ENV is required for CI runtime-role setup}"

runtime_password="$(openssl rand -hex 32)"
echo "::add-mask::${runtime_password}"

psql "${DATABASE_DIRECT_URL}" \
  --set ON_ERROR_STOP=1 \
  --variable=runtime_password="${runtime_password}" <<'SQL'
ALTER ROLE app_runtime LOGIN PASSWORD :'runtime_password';
ALTER ROLE app_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
SELECT format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database()) \gexec
SQL

runtime_url="postgresql://app_runtime:${runtime_password}@127.0.0.1:5432/shanda_fuel_test"
echo "::add-mask::${runtime_url}"
printf 'DATABASE_URL=%s\n' "${runtime_url}" >> "${GITHUB_ENV}"
