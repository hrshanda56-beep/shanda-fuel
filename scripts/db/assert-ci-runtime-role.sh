#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required for CI runtime-role proof}"
proof_file="${RUNTIME_PROOF_FILE:-runtime-role-proof.txt}"

exec > >(tee "${proof_file}") 2>&1

current_user="$(psql "${DATABASE_URL}" --tuples-only --no-align --command 'select current_user')"
session_user="$(psql "${DATABASE_URL}" --tuples-only --no-align --command 'select session_user')"
printf 'current_user=%s\nsession_user=%s\n' "${current_user}" "${session_user}"
test "${current_user}" = app_runtime
test "${session_user}" = app_runtime

role_flags="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
  "select (case when rolsuper then 't' else 'f' end) || '|' ||
    (case when rolbypassrls then 't' else 'f' end) || '|' ||
    (case when rolcreatedb then 't' else 'f' end) || '|' ||
    (case when rolcreaterole then 't' else 'f' end)
   from pg_roles where rolname = current_user")"
printf 'role_flags=%s\n' "${role_flags}"
test "${role_flags}" = 'f|f|f|f'

app_create="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
  "select has_schema_privilege(current_user, 'app', 'CREATE')")"
drizzle_usage="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
  "select has_schema_privilege(current_user, 'drizzle', 'USAGE')")"
tenants_owner="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
  "select (tableowner = current_user) from pg_tables where schemaname = 'app' and tablename = 'tenants'")"
printf 'app_schema_create=%s\ndrizzle_schema_usage=%s\ntenants_owner=%s\n' \
  "${app_create}" "${drizzle_usage}" "${tenants_owner}"
test "${app_create}" = f
test "${drizzle_usage}" = f
test "${tenants_owner}" = f

tenant_row_count="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
  'select count(*) from app.tenants')"
printf 'app_tenants_select_count=%s\n' "${tenant_row_count}"
test "${tenant_row_count}" -ge 0
echo 'Positive SELECT capability: app_runtime executed SELECT count(*) FROM app.tenants'

if psql "${DATABASE_URL}" --set ON_ERROR_STOP=1 --command \
  'create table app.ci_runtime_role_must_not_create (id integer)'; then
  echo 'ERROR: app_runtime unexpectedly created an application table'
  exit 1
else
  echo 'DDL denial: app_runtime cannot create application tables'
fi

if psql "${DATABASE_URL}" --set ON_ERROR_STOP=1 --command \
  'select 1 from drizzle.__drizzle_migrations limit 1'; then
  echo 'ERROR: app_runtime unexpectedly read migration metadata'
  exit 1
else
  echo 'Migration metadata denial: app_runtime cannot read drizzle.__drizzle_migrations'
fi

echo 'Runtime-role database proof passed.'
