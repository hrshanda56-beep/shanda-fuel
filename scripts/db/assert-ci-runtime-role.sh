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

app_delete_tables="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
  "select coalesce(string_agg(c.relname, ',' order by c.relname), '')
   from pg_namespace n
   join pg_class c on c.relnamespace = n.oid
   where n.nspname = 'app'
     and c.relkind in ('r', 'p')
     and has_table_privilege(current_user, c.oid, 'DELETE')")"
printf 'app_delete_tables=%s\n' "${app_delete_tables}"
# The delivery compartment and seal tables are draft replacement tables too: migration 0065 grants
# DELETE, and the delivery_detail_status_guard trigger refuses any change unless the delivery is a draft.
test "${app_delete_tables}" = \
  'fuel_delivery_compartment_seals,fuel_delivery_compartments,reconciliation_attendants,reconciliation_delivery_refs,reconciliation_dip_refs,reconciliation_expenses,reconciliation_meter_readings,reconciliation_payments,reconciliation_variance_explanations'
echo 'Measured DELETE capability: app_runtime retains only draft replacement tables (reconciliation and delivery compartments)'

rate_limit_public_execute="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
  "select coalesce(bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), false)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl on true
   where p.oid = 'platform.consume_rate_limit(text,text,integer,integer)'::regprocedure")"
rate_limit_function_owner="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
   "select (pg_get_userbyid(p.proowner) = current_user)
   from pg_proc p
   where p.oid = 'platform.consume_rate_limit(text,text,integer,integer)'::regprocedure")"
rate_limit_table_owner="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
  "select (c.relowner = (select oid from pg_roles where rolname = current_user))
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'platform' and c.relname = 'rate_limit_windows'")"
printf 'rate_limit_public_execute=%s\nrate_limit_function_owner_is_runtime=%s\nrate_limit_table_owner_is_runtime=%s\n' \
  "${rate_limit_public_execute}" "${rate_limit_function_owner}" "${rate_limit_table_owner}"
test "${rate_limit_public_execute}" = f
test "${rate_limit_function_owner}" = f
test "${rate_limit_table_owner}" = f

runtime_process_id="${BASHPID:-$$}"
rate_limit_scope="ci-runtime-proof-${GITHUB_RUN_ID:-local}-${runtime_process_id}-${RANDOM}-$(date +%s%N)"
rate_limit_key="$(printf '%s' "${rate_limit_scope}" | sha256sum | awk '{print $1}')"
rate_limit_first="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
  "select allowed from platform.consume_rate_limit('${rate_limit_scope}', '${rate_limit_key}', 1, 60)")"
rate_limit_second="$(psql "${DATABASE_URL}" --tuples-only --no-align --command \
  "select allowed from platform.consume_rate_limit('${rate_limit_scope}', '${rate_limit_key}', 1, 60)")"
printf 'rate_limit_first=%s\nrate_limit_second=%s\n' "${rate_limit_first}" "${rate_limit_second}"
test "${rate_limit_first}" = t
test "${rate_limit_second}" = f

if psql "${DATABASE_URL}" --set ON_ERROR_STOP=1 --command \
  'select count(*) from platform.rate_limit_windows'; then
  echo 'ERROR: app_runtime unexpectedly read the rate-limit backing table'
  exit 1
else
  echo 'Rate-limit table denial: app_runtime uses the named function only'
fi

echo 'Runtime-role database proof passed.'
